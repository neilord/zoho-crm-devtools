import { CRM_HOSTS, NATIVE_DEFAULTS, RESERVED, SERVICE_HOSTS, TASKS } from './registry';
import { decodeLiteral, readStructure, type Token } from './structure';
import type {
  AnalysisLimits,
  AnalyzeOptions,
  Confidence,
  EffectBase,
  EffectContext,
  FieldFact,
  FunctionCall,
  FunctionEffects,
  NameFact,
  RecordTarget,
  SourceSpan,
  TriggerPolicy,
  WriteEffect,
} from './types';
import { clone, text, unknown, type Value, value } from './values';

const DEFAULT_LIMITS: AnalysisLimits = {
  sourceLength: 262_144,
  tokens: 65_536,
  bindings: 2_048,
  keys: 128,
  listElements: 64,
  alternatives: 4,
  evidence: 8,
  structuralDepth: 32,
  payloadDepth: 4,
  visits: 2_000_000,
  effects: 2_048,
  warnings: 256,
  outputBytes: 1_048_576,
};
const IDENTIFIER = /^[A-Za-z_][A-Za-z_0-9]*$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const CONTROL_KEYS = new Set(['$append_values', '$process_flow', '_delete']);
const BLOCK_KEYS = new Set([
  'url',
  'path',
  'service',
  'type',
  'body',
  'parameters',
  'connection',
  'headers',
  'files',
  'detailed',
  'response-format',
  'from',
  'to',
  'cc',
  'bcc',
  'subject',
  'message',
  'content type',
]);
const READONLY = new Set([
  'get',
  'keys',
  'size',
  'isEmpty',
  'contains',
  'containsKey',
  'toString',
  'toLong',
]);

class BudgetStop extends Error {}

function digest(source: string): string {
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return `${source.length.toString(16)}-${(hash >>> 0).toString(16)}`;
}

/** One function, one abstract heap, no DOM, clock, network, or runtime evaluation. */
export class Analyzer {
  private tokens: Token[] = [];
  private pairs = new Map<number, number>();
  private env = new Map<string, Value>();
  private contexts: EffectContext[] = [];
  private readonly limits: AnalysisLimits;
  private readonly out: FunctionEffects;
  private visits = 0;
  private objects = 0;
  private effectCount = 0;
  private outputBytes = 0;
  private cursor = 0;
  private readonly diagnosticSites = new Set<string>();
  private readonly catalogue = new Map<string, Set<string>>();
  private readonly categories = new Set(['standalone', 'automation']);

  constructor(
    private readonly source: string,
    private readonly options: AnalyzeOptions,
    version: number,
  ) {
    this.limits = { ...DEFAULT_LIMITS };
    for (const key of Object.keys(DEFAULT_LIMITS) as (keyof AnalysisLimits)[]) {
      const n = options.limits?.[key];
      if (n !== undefined && Number.isFinite(n))
        this.limits[key] = Math.max(1, Math.min(10_000_000, Math.floor(n)));
    }
    this.out = {
      schemaVersion: 1,
      analyzerVersion: version,
      functionId: options.functionId ?? '',
      sourceRevision: options.sourceRevision ?? digest(source),
      certainty: 'possible',
      analysis: {
        status: 'analyzed',
        freshness: options.freshness ?? 'unknown',
        sourceLength: source.length,
        tokenCount: 0,
        analyzedSpans: [],
        unscanned: [],
        limitReasons: [],
      },
      writes: [],
      calls: [],
      services: [],
      external: [],
      connections: [],
      reads: [],
      warnings: [],
    };
    for (const entry of options.catalogue ?? []) {
      const ids = this.catalogue.get(entry.apiName) ?? new Set<string>();
      ids.add(entry.id);
      this.catalogue.set(entry.apiName, ids);
      if (entry.category) this.categories.add(entry.category);
    }
  }

  run(): FunctionEffects {
    const full = { start: 0, end: this.source.length };
    if (this.options.language && !['deluge', 'Deluge'].includes(this.options.language)) {
      this.out.analysis.status = 'unsupported';
      this.out.analysis.unscanned = [full];
      this.warn('unsupported-language', full);
      return this.out;
    }
    if (this.source.length > this.limits.sourceLength) {
      this.limit('source-length', full);
      return this.out;
    }
    try {
      const structure = readStructure(this.source);
      this.tokens = structure.tokens;
      this.pairs = structure.pairs;
      this.out.analysis.tokenCount = structure.tokenCount;
      if (structure.tokenCount > this.limits.tokens) {
        this.limit('tokens', full);
        return this.out;
      }
      if (structure.depth > this.limits.structuralDepth) {
        this.limit('structural-depth', full);
        return this.out;
      }
      if (structure.malformed.length) {
        const first = Math.min(...structure.malformed.map((s) => s.start));
        this.limit('malformed-source', { start: first, end: full.end });
        for (const span of structure.malformed.slice(0, this.limits.warnings))
          this.warn(
            ['"', "'", '/'].includes(this.source[span.start])
              ? 'malformed-literal'
              : 'malformed-structure',
            span,
          );
        // A prefix is safe only through its last complete statement. Unmatched blocks
        // cannot be treated as independent, definitely closed expressions.
        let end = this.tokens.findIndex((t) => t.start >= first);
        if (end < 0) end = this.tokens.length;
        while (end > 0 && this.tokens[end - 1].text !== ';') end--;
        this.scan(0, end);
        this.out.analysis.analyzedSpans = end ? [this.span(0, end)] : [];
        this.out.analysis.unscanned = [
          { start: end ? this.tokens[end - 1].end : 0, end: full.end },
        ];
      } else {
        for (const parameter of this.options.parameters ?? []) this.bindParameter(parameter, full);
        this.scan(0, this.tokens.length);
        this.out.analysis.analyzedSpans = [full];
      }
    } catch (error) {
      const start = Math.min(this.source.length, this.tokens[this.cursor]?.start ?? 0);
      if (error instanceof BudgetStop) this.limit('work-visits', { start, end: full.end });
      else {
        this.out.analysis.status = 'failed';
        this.out.analysis.unscanned.push({ start, end: full.end });
        this.warn('analysis-failed', { start, end: full.end });
      }
      this.out.analysis.analyzedSpans = start ? [{ start: 0, end: start }] : [];
    }
    if (this.options.freshness === 'cached-stale') this.warn('source-stale');
    return this.out;
  }

  private copy(v: Value, memo = new Map<Value, Value>()): Value {
    return clone(
      v,
      memo,
      this.limits.payloadDepth,
      () => this.tick(),
      () => this.limit('summary-depth'),
    );
  }
  private forkEnv(env: Map<string, Value>): Map<string, Value> {
    const memo = new Map<Value, Value>();
    return new Map([...env].map(([k, v]) => [k, this.copy(v, memo)]));
  }
  private tick(index = this.cursor): void {
    this.cursor = index;
    if (++this.visits > this.limits.visits) throw new BudgetStop();
  }
  private span(a: number, b: number): SourceSpan {
    return {
      start: this.tokens[a]?.start ?? this.source.length,
      end: this.tokens[b - 1]?.end ?? this.tokens[a]?.start ?? this.source.length,
    };
  }
  private warn(code: string, span?: SourceSpan, effectIds: string[] = []): void {
    const key = `${code}:${span?.start ?? -1}`;
    if (this.diagnosticSites.has(key)) return;
    this.diagnosticSites.add(key);
    if (this.out.warnings.length >= this.limits.warnings) {
      this.markLimited('warnings');
      return;
    }
    this.out.warnings.push({
      code,
      severity: code === 'path-union' ? 'info' : 'coverage-gap',
      messageKey: `automationMap.analyzer.${code}`,
      ...(span ? { span } : {}),
      effectIds,
    });
  }
  private markLimited(reason: string): void {
    this.out.analysis.status = 'limited';
    if (!this.out.analysis.limitReasons.includes(reason))
      this.out.analysis.limitReasons.push(reason);
  }
  private limit(reason: string, span?: SourceSpan): void {
    this.markLimited(reason);
    if (span) this.out.analysis.unscanned.push(span);
    this.warn('budget-exceeded', span);
  }
  private evidence(spans: SourceSpan[]): SourceSpan[] {
    const unique = spans.filter(
      (s, i) => spans.findIndex((t) => t.start === s.start && t.end === s.end) === i,
    );
    if (unique.length > this.limits.evidence) this.limit('evidence');
    return unique.slice(0, this.limits.evidence).map((s) => ({ ...s }));
  }
  private reasons(...groups: string[][]): string[] {
    return [...new Set(groups.flat())];
  }
  private add<T extends EffectBase>(array: T[], effect: T): void {
    const bytes = JSON.stringify(effect).length * 2;
    if (
      this.effectCount >= this.limits.effects ||
      this.outputBytes + bytes > this.limits.outputBytes
    ) {
      this.limit(this.effectCount >= this.limits.effects ? 'effects' : 'output-bytes', effect.span);
      this.warn('output-truncated', effect.span);
      return;
    }
    this.effectCount++;
    this.outputBytes += bytes;
    array.push(effect);
    for (const reason of effect.reasons) this.warn(reason, effect.span, [effect.id]);
  }
  private base(
    span: SourceSpan,
    calleeSpan = span,
    recognition: EffectBase['recognition'] = 'registered',
  ): EffectBase {
    return {
      id: `e${span.start}:${this.effectCount}`,
      certainty: 'possible',
      confidence: 'exact',
      recognition,
      span,
      calleeSpan,
      contexts: this.contexts.map((c) => ({ kind: c.kind, span: { ...c.span } })),
      reasons: [],
    };
  }
  private name(v: Value, span = v.span): NameFact {
    const candidates = v.kind === 'text' ? [...v.texts] : [];
    const confidence: Confidence =
      candidates.length === 1 && !v.unknown ? 'exact' : candidates.length ? 'partial' : 'unknown';
    return {
      value: confidence === 'exact' ? candidates[0] : null,
      candidates,
      confidence,
      origin: v.origin,
      span,
      evidence: this.evidence(v.evidence),
    };
  }
  private bind(name: string, v: Value): void {
    if (!this.env.has(name) && this.env.size >= this.limits.bindings) {
      this.limit('bindings', v.span);
      return;
    }
    this.env.set(name, v);
  }
  private bindParameter(name: string, span: SourceSpan): void {
    const v = unknown(span);
    v.parameter = name;
    v.directParameter = true;
    this.bind(name, v);
  }
  private rangeParts(a: number, b: number, separator = ','): [number, number][] {
    const parts: [number, number][] = [];
    let start = a;
    for (let i = a; i < b; i++) {
      this.tick(i);
      if (this.tokens[i].text === separator && !this.tokens[i].literal) {
        parts.push([start, i]);
        start = i + 1;
      } else if (['(', '{', '['].includes(this.tokens[i].text) && !this.tokens[i].literal)
        i = this.pairs.get(i) ?? i;
    }
    if (start < b) parts.push([start, b]);
    return parts;
  }
  private heap(kind: 'map' | 'list', span: SourceSpan): Value {
    if (++this.objects > this.limits.bindings) {
      this.limit('objects');
      return unknown(span, 'object-cap');
    }
    return value(kind, span);
  }
  private setKey(v: Value, key: string, child: Value, evidence: SourceSpan[]): void {
    if (v.kind !== 'map') return;
    if (!v.keys.has(key) && v.keys.size >= this.limits.keys) {
      v.unknown = true;
      v.reasons = this.reasons(v.reasons, ['key-cap']);
      this.limit('keys');
      return;
    }
    v.keys.set(key, { value: child, evidence: this.evidence(evidence) });
  }
  private append(v: Value, child: Value): void {
    if (v.kind !== 'list') return;
    if (v.items.length >= this.limits.listElements) {
      v.unknown = true;
      this.limit('list-elements');
      return;
    }
    v.items.push(child);
    if (child.kind === 'unknown') v.reasons = this.reasons(v.reasons, ['unknown-list-element']);
  }
  private widen(v: Value, reason: string, seen = new Set<Value>()): void {
    if (seen.has(v)) return;
    seen.add(v);
    v.unknown = true;
    v.reasons = this.reasons(v.reasons, [reason]);
  }
  private merge(a: Value, b: Value, depth = 0): Value {
    this.tick();
    if (depth > this.limits.payloadDepth) {
      this.limit('payload-depth');
      return unknown(a.span);
    }
    if (a.kind === 'unknown' && b.kind === 'unknown') {
      const out = unknown(a.span);
      out.reasons = this.reasons(a.reasons, b.reasons);
      out.identities = new Set([...a.identities, ...b.identities]);
      if (a.parameter && a.parameter === b.parameter) {
        out.parameter = a.parameter;
        out.directParameter = !!a.directParameter && !!b.directParameter;
      }
      return out;
    }
    if (a.kind !== b.kind) {
      const known = a.kind === 'unknown' ? b : a;
      const out = this.copy(known);
      out.identities = new Set([...a.identities, ...b.identities]);
      this.widen(out, 'path-union');
      return out;
    }
    const out = this.copy(a);
    out.origin = 'branch-union';
    out.identities = new Set([...a.identities, ...b.identities]);
    out.unknown ||= b.unknown;
    out.reasons = this.reasons(a.reasons, b.reasons, ['path-union']);
    if (a.kind === 'text') {
      const alternatives = [...new Set([...a.texts, ...b.texts])];
      out.texts = alternatives.slice(0, this.limits.alternatives);
      if (alternatives.length > this.limits.alternatives) {
        out.unknown = true;
        this.limit('alternatives');
      }
      out.evidence = this.evidence([...a.evidence, ...b.evidence]);
      out.prefix = '';
    } else if (a.kind === 'map') {
      for (const [k, entry] of b.keys) {
        const prior = out.keys.get(k);
        this.setKey(
          out,
          k,
          prior
            ? this.merge(prior.value, entry.value, depth + 1)
            : this.merge(unknown(entry.value.span), entry.value, depth + 1),
          [...(prior?.evidence ?? []), ...entry.evidence],
        );
      }
      for (const [k, entry] of out.keys)
        if (!b.keys.has(k))
          entry.value = this.merge(entry.value, unknown(entry.value.span), depth + 1);
    } else if (a.kind === 'list') for (const child of b.items) this.append(out, this.copy(child));
    if (a.parameter !== b.parameter) {
      delete out.parameter;
      delete out.directParameter;
    }
    return out;
  }
  private join(left: Map<string, Value>, right: Map<string, Value>): void {
    const joined = new Map<string, Value>();
    for (const k of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(k),
        b = right.get(k);
      joined.set(
        k,
        this.merge(
          a ?? unknown(b?.span ?? { start: 0, end: 0 }),
          b ?? unknown(a?.span ?? { start: 0, end: 0 }),
        ),
      );
    }
    this.env = joined;
  }

  private scan(a: number, b: number): void {
    let i = a;
    while (i < b) {
      this.tick(i);
      const word = this.tokens[i].text;
      if (word === ';' || word === '}') {
        i++;
        continue;
      }
      // Declarations are structural headers, never call sites.
      if (
        [
          'void',
          'string',
          'int',
          'long',
          'float',
          'bool',
          'boolean',
          'map',
          'list',
          'date',
        ].includes(word)
      ) {
        let p = i + 1;
        while (p < b && (IDENTIFIER.test(this.tokens[p].text) || this.tokens[p].text === '.')) p++;
        const end = this.pairs.get(p);
        if (
          this.tokens[p]?.text === '(' &&
          end !== undefined &&
          this.tokens[end + 1]?.text === '{'
        ) {
          for (const [x, y] of this.rangeParts(p + 1, end)) {
            const parameter = this.tokens[y - 1];
            if (parameter && IDENTIFIER.test(parameter.text))
              this.bindParameter(parameter.text, this.span(x, y));
          }
          const close = this.pairs.get(end + 1);
          if (close !== undefined) {
            this.scan(end + 2, close);
            i = close + 1;
            continue;
          }
        }
      }
      if (word === 'if') {
        i = this.branch(i, b);
        continue;
      }
      if (word === 'for' || word === 'while') {
        i = this.loop(i, b);
        continue;
      }
      if (word === 'try' || word === 'catch' || word === 'finally') {
        let open = i + 1;
        if (this.tokens[open]?.text === '(') open = (this.pairs.get(open) ?? open) + 1;
        if (this.tokens[open]?.text === '{') {
          const close = this.pairs.get(open) ?? open;
          this.warn('control-flow', this.span(i, close + 1));
          const before = this.forkEnv(this.env);
          if (word !== 'try') this.contexts.push({ kind: word, span: this.span(i, close + 1) });
          this.scan(open + 1, close);
          if (word !== 'try') this.contexts.pop();
          this.join(before, this.env);
          i = close + 1;
          continue;
        }
      }
      if (word === '{') {
        const close = this.pairs.get(i) ?? i;
        this.scan(i + 1, close);
        i = close + 1;
        continue;
      }
      let end = i;
      while (end < b && this.tokens[end].text !== ';') {
        if (['(', '[', '{'].includes(this.tokens[end].text) && !this.tokens[end].literal)
          end = this.pairs.get(end) ?? end;
        end++;
      }
      let start = i;
      if (['return', 'break', 'continue', 'throw'].includes(word)) {
        this.warn('control-flow', this.span(i, end));
        start++;
      }
      if (this.tokens[start + 1]?.text === '=' && IDENTIFIER.test(this.tokens[start]?.text ?? '')) {
        this.bind(this.tokens[start].text, this.evaluate(start + 2, end));
      } else this.evaluate(start, end);
      i = end + 1;
    }
  }

  private branch(i: number, b: number): number {
    const condition = i + 1,
      endCondition = this.pairs.get(condition);
    const open = (endCondition ?? condition) + 1,
      close = this.pairs.get(open);
    if (
      this.tokens[condition]?.text !== '(' ||
      this.tokens[open]?.text !== '{' ||
      close === undefined
    ) {
      this.limit('unsupported-form', this.span(i, b));
      this.warn('unsupported-form', this.span(i, b));
      return b;
    }
    this.evaluate(condition + 1, endCondition ?? condition);
    const before = this.forkEnv(this.env);
    this.contexts.push({ kind: 'branch', span: this.span(i, close + 1) });
    this.scan(open + 1, close);
    this.contexts.pop();
    const left = this.env;
    this.env = this.forkEnv(before);
    let next = close + 1;
    if (this.tokens[next]?.text === 'else') {
      next++;
      if (this.tokens[next]?.text === 'if') next = this.branch(next, b);
      else if (this.tokens[next]?.text === '{') {
        const stop = this.pairs.get(next) ?? next;
        this.contexts.push({ kind: 'branch', span: this.span(next, stop + 1) });
        this.scan(next + 1, stop);
        this.contexts.pop();
        next = stop + 1;
      } else {
        this.limit('unsupported-form', this.span(next, b));
        return b;
      }
    }
    this.join(left, this.env);
    return next;
  }

  private loop(i: number, b: number): number {
    let open = i + 1;
    while (open < b && this.tokens[open].text !== '{') {
      if (this.tokens[open].text === '(') open = this.pairs.get(open) ?? open;
      open++;
    }
    if (this.tokens[(this.pairs.get(open) ?? open) + 1]?.text === '{')
      open = (this.pairs.get(open) ?? open) + 1;
    const close = this.pairs.get(open);
    if (close === undefined) {
      this.limit('unsupported-loop', this.span(i, b));
      return b;
    }
    let iterator: { name: string; element: Value } | null = null;
    if (this.tokens[i].text === 'while') {
      const condition = this.pairs.get(i + 1);
      if (condition !== undefined) this.evaluate(i + 2, condition);
    } else {
      let start = i + 1;
      while (start < open && this.tokens[start].text !== 'in') start++;
      if (start < open) {
        const iterable = this.evaluate(start + 1, open);
        let element = unknown(this.span(start + 1, open));
        if (
          iterable.kind === 'list' &&
          iterable.items.length &&
          this.tokens[i + 2]?.text !== 'index'
        ) {
          element = this.copy(iterable.items[0]);
          for (const item of iterable.items.slice(1)) element = this.merge(element, item);
          if (iterable.unknown) this.widen(element, 'unknown-list-element');
        }
        iterator = { name: this.tokens[start - 1].text, element };
      }
    }
    const before = this.forkEnv(this.env);
    // The iterator shadows any earlier binding inside the body, even for dynamic lists.
    if (iterator && IDENTIFIER.test(iterator.name)) this.bind(iterator.name, iterator.element);
    // Widen carried objects before visiting any use, including uses before a put.
    // Fresh objects assigned in the body replace this widened state normally.
    for (let p = open + 1; p < close; p++) {
      this.tick(p);
      const variable = this.tokens[p].text;
      if (this.tokens[p + 1]?.text === '=' && this.env.has(variable)) {
        let end = p + 2;
        while (end < close && this.tokens[end].text !== ';') {
          if (['(', '[', '{'].includes(this.tokens[end].text) && !this.tokens[end].literal)
            end = this.pairs.get(end) ?? end;
          end++;
        }
        const rhs = this.syntacticValue(p + 2, end);
        const previous = this.env.get(variable);
        if (previous) {
          const carried = this.merge(previous, rhs);
          this.widen(carried, 'loop-carried-state');
          this.bind(variable, carried);
        }
      }
      const receiver = this.env.get(variable);
      if (!receiver || this.tokens[p + 1]?.text !== '.') continue;
      const method = this.tokens[p + 2]?.text;
      if (!method || READONLY.has(method)) continue;
      this.widen(receiver, 'loop-carried-state');
      if (this.tokens[p + 3]?.text === '(') {
        const end = this.pairs.get(p + 3);
        const parts = end === undefined ? [] : this.rangeParts(p + 4, end);
        const args = parts.map(([x, y]) => this.syntacticValue(x, y));
        if (method === 'put' && args[0]?.kind === 'text' && args[0].texts.length === 1) {
          if (receiver.kind === 'unknown') receiver.kind = 'map';
          this.setKey(receiver, args[0].texts[0], args[1] ?? unknown(receiver.span), [
            ...args[0].evidence,
            args[0].span,
          ]);
        } else if (method === 'putAll' && args[0]?.kind === 'map') {
          for (const [k, entry] of args[0].keys)
            this.setKey(receiver, k, this.snapshot(entry.value), entry.evidence);
        } else if (method === 'add' && receiver.kind === 'list')
          this.append(receiver, args[0] ?? unknown(receiver.span));
        else if (method === 'addAll' && receiver.kind === 'list' && args[0]?.kind === 'list')
          for (const item of args[0].items) this.append(receiver, item);
      }
    }
    this.contexts.push({ kind: 'loop', span: this.span(i, close + 1) });
    this.scan(open + 1, close);
    this.contexts.pop();
    this.join(before, this.env);
    return close + 1;
  }

  /** Loop lookahead collects bounded facts without executing calls twice. */
  private syntacticValue(a: number, b: number, depth = 0): Value {
    this.tick(a);
    const span = this.span(a, b);
    if (depth > this.limits.payloadDepth) {
      this.limit('payload-depth', span);
      return unknown(span);
    }
    if (b === a + 1) {
      if (this.tokens[a]?.literal) return text(decodeLiteral(this.tokens[a].text), span);
      return this.env.get(this.tokens[a]?.text) ?? unknown(span);
    }
    if (['{', '['].includes(this.tokens[a]?.text) && this.pairs.get(a) === b - 1) {
      const parts = this.rangeParts(a + 1, b - 1);
      const map =
        this.tokens[a].text === '{' &&
        (!parts.length || parts.some(([x, y]) => this.rangeParts(x, y, ':').length === 2));
      const result = this.heap(map ? 'map' : 'list', span);
      for (const [x, y] of parts) {
        const kv = this.rangeParts(x, y, ':');
        if (map && kv.length === 2) {
          const k = this.syntacticValue(...kv[0], depth + 1);
          if (k.kind === 'text' && k.texts.length === 1)
            this.setKey(result, k.texts[0], this.syntacticValue(...kv[1], depth + 1), k.evidence);
          else this.widen(result, 'dynamic-field-key');
        } else if (!map) this.append(result, this.syntacticValue(x, y, depth + 1));
      }
      return result;
    }
    return unknown(span, 'loop-carried-state');
  }
  private evaluate(a: number, b: number, depth = 0): Value {
    this.tick(a);
    const span = this.span(a, b);
    if (a >= b) return unknown(span);
    if (depth > this.limits.payloadDepth + this.limits.structuralDepth) {
      this.limit('expression-depth', span);
      return unknown(span);
    }
    const additions = this.rangeParts(a, b, '+');
    if (additions.length > 1) {
      const values = additions.map(([x, y]) => this.evaluate(x, y, depth + 1));
      const result = value('text', span);
      result.texts = [''];
      let hole = false;
      for (const part of values) {
        if (!hole) result.prefix += part.kind === 'text' ? part.prefix : '';
        if (part.kind !== 'text' || part.unknown || !part.texts.length) {
          hole = true;
          result.unknown = true;
          result.texts = [];
        } else if (!result.unknown) {
          const combinations = result.texts.flatMap((left) =>
            part.texts.map((right) => left + right),
          );
          result.texts = [...new Set(combinations)].slice(0, this.limits.alternatives);
          if (combinations.length > this.limits.alternatives) {
            result.unknown = true;
            this.limit('alternatives');
          }
        }
        result.evidence = this.evidence([...result.evidence, ...part.evidence]);
      }
      result.origin = 'propagated';
      return result;
    }
    let pos = a;
    const token = this.tokens[pos];
    let result: Value;
    if (
      ['invokeurl', 'invokeUrl', 'invokeapi', 'sendmail', 'sendMail'].includes(token.text) &&
      this.tokens[pos + 1]?.text === '['
    ) {
      const close = this.pairs.get(pos + 1);
      if (close !== undefined && close < b) {
        this.block(pos, close);
        return unknown(span);
      }
    }
    if (token.literal) {
      result = text(decodeLiteral(token.text), this.span(pos, pos + 1));
      pos++;
    } else if (['{', '['].includes(token.text)) {
      const close = this.pairs.get(pos);
      if (close === undefined || close >= b) return unknown(span);
      result = this.collection(pos + 1, close, depth + 1, token.text === '[');
      pos = close + 1;
    } else if (token.text === '(') {
      const close = this.pairs.get(pos);
      if (close === undefined || close >= b) return unknown(span);
      result = this.evaluate(pos + 1, close, depth + 1);
      pos = close + 1;
    } else if (IDENTIFIER.test(token.text)) {
      let end = pos + 1;
      while (this.tokens[end]?.text === '.' && IDENTIFIER.test(this.tokens[end + 1]?.text ?? ''))
        end += 2;
      if (this.tokens[end]?.text === '(') {
        const close = this.pairs.get(end);
        if (close === undefined || close >= b) return unknown(span);
        const parts = this.rangeParts(end + 1, close);
        const args = parts.map(([x, y]) => this.evaluate(x, y, depth + 1));
        const chain = this.tokens
          .slice(pos, end)
          .map((t) => t.text)
          .join('');
        const root = this.env.get(token.text);
        if (end === pos + 3 && root && !['zoho', ...this.categories].includes(token.text))
          result = this.mutate(
            root,
            this.tokens[pos + 2].text,
            args,
            this.span(pos, close + 1),
            this.span(pos, end),
          );
        else if (
          end === pos + 3 &&
          !root &&
          (READONLY.has(this.tokens[pos + 2].text) ||
            ['put', 'putAll', 'add', 'addAll', 'remove', 'clear'].includes(
              this.tokens[pos + 2].text,
            )) &&
          !['zoho', ...this.categories, 'thisapp'].includes(token.text)
        ) {
          const receiver = unknown(this.span(pos, pos + 1));
          this.bind(token.text, receiver);
          result = this.mutate(
            receiver,
            this.tokens[pos + 2].text,
            args,
            this.span(pos, close + 1),
            this.span(pos, end),
          );
        } else
          result = this.call(
            chain,
            args,
            parts.map(([x, y]) => this.span(x, y)),
            this.span(pos, close + 1),
            this.span(pos, end),
          );
        pos = close + 1;
      } else {
        if (end > pos + 1) result = unknown(this.span(pos, end));
        else if (['true', 'false', 'null'].includes(token.text))
          result = value('scalar', this.span(pos, end));
        else {
          result = this.env.get(token.text) ?? unknown(this.span(pos, end));
          if (result.kind === 'text')
            result = { ...result, origin: 'propagated', span: this.span(pos, end) };
        }
        pos = end;
      }
    } else {
      result = value('scalar', this.span(pos, pos + 1));
      pos++;
    }
    while (pos < b) {
      this.tick(pos);
      if (
        this.tokens[pos].text === '.' &&
        IDENTIFIER.test(this.tokens[pos + 1]?.text ?? '') &&
        this.tokens[pos + 2]?.text === '('
      ) {
        const close = this.pairs.get(pos + 2);
        if (close === undefined || close >= b) return unknown(span);
        const args = this.rangeParts(pos + 3, close).map(([x, y]) =>
          this.evaluate(x, y, depth + 1),
        );
        result = this.mutate(
          result,
          this.tokens[pos + 1].text,
          args,
          this.span(a, close + 1),
          this.span(pos, pos + 2),
        );
        pos = close + 1;
      } else {
        // Unsupported arithmetic/property forms lose scalar identity. Still visit
        // nested executable calls instead of dropping effects in expressions.
        if (pos + 1 < b) this.evaluate(pos + 1, b, depth + 1);
        return unknown(span, 'unsupported-expression');
      }
    }
    return result;
  }

  private collection(a: number, b: number, depth: number, square = false): Value {
    const span = this.span(a - 1, b + 1);
    if (depth > this.limits.payloadDepth) {
      this.limit('payload-depth', span);
      return unknown(span);
    }
    const parts = this.rangeParts(a, b);
    const isMap =
      !square && (!parts.length || parts.some(([x, y]) => this.rangeParts(x, y, ':').length > 1));
    const out = this.heap(isMap ? 'map' : 'list', span);
    for (const [x, y] of parts) {
      if (isMap) {
        const kv = this.rangeParts(x, y, ':');
        if (kv.length !== 2) {
          this.widen(out, 'dynamic-field-key');
          this.evaluate(x, y, depth);
          continue;
        }
        const k = this.evaluate(...kv[0], depth);
        const child = this.evaluate(...kv[1], depth);
        if (k.kind === 'text' && !k.unknown && k.texts.length === 1)
          this.setKey(out, k.texts[0], child, [...k.evidence, this.span(...kv[0])]);
        else this.widen(out, 'dynamic-field-key');
      } else this.append(out, this.evaluate(x, y, depth));
    }
    return out;
  }

  /** Branch joins retain possible heap identities, even when only one arm aliases. */
  private aliases(receiver: Value): { peers: Value[]; shared: boolean } {
    const peers: Value[] = [];
    const seen = new Set<Value>();
    let references = 0;
    const visit = (v: Value, depth: number): void => {
      this.tick();
      if ([...v.identities].some((id) => receiver.identities.has(id))) {
        references++;
        if (v !== receiver && !peers.includes(v)) peers.push(v);
      }
      if (seen.has(v) || depth >= this.limits.payloadDepth) return;
      seen.add(v);
      for (const e of v.keys.values()) visit(e.value, depth + 1);
      for (const item of v.items) visit(item, depth + 1);
    };
    for (const v of this.env.values()) visit(v, 0);
    return { peers, shared: references > 1 };
  }
  private propagate(receiver: Value, peers: Value[]): void {
    for (const peer of peers) {
      const merged = this.merge(peer, receiver);
      this.widen(merged, 'alias-mutation');
      Object.assign(peer, merged);
    }
  }
  /** putAll copies donor child facts at this statement, not future donor changes. */
  private snapshot(v: Value): Value {
    const out = this.copy(v);
    const seen = new Set<Value>();
    const detach = (node: Value): void => {
      if (seen.has(node)) return;
      seen.add(node);
      node.identities = new Set([{}]);
      for (const entry of node.keys.values()) detach(entry.value);
      for (const item of node.items) detach(item);
    };
    detach(out);
    return out;
  }
  private invalidate(v: Value, reason: string): void {
    const { peers } = this.aliases(v);
    this.widen(v, reason);
    this.propagate(v, peers);
  }
  private mutate(
    receiver: Value,
    method: string,
    args: Value[],
    span: SourceSpan,
    callee: SourceSpan,
  ): Value {
    if (method === 'get' && !receiver.serialized) {
      const key = args[0];
      if (receiver.kind === 'map' && key?.kind === 'text' && key.texts.length === 1) {
        const child = receiver.keys.get(key.texts[0])?.value;
        if (!child) return unknown(span);
        if (!receiver.unknown) return child;
        const candidate = this.copy(child);
        this.widen(candidate, 'unknown-map');
        return candidate;
      }
      return unknown(span);
    }
    if (method === 'toString' || method === 'toLong') {
      if (method === 'toString' && ['map', 'list'].includes(receiver.kind)) {
        const out = this.snapshot(receiver);
        out.serialized = true;
        return out;
      }
      if (receiver.kind === 'text' && method === 'toString') return receiver;
      if (receiver.parameter) return { ...receiver, span };
      return unknown(span);
    }
    if (READONLY.has(method)) return unknown(span);
    if (receiver.serialized) {
      this.warn('unknown-mutator', callee);
      return unknown(span, 'unknown-mutator');
    }
    const aliases = this.aliases(receiver);
    if (aliases.shared) this.widen(receiver, 'alias-mutation');
    if (['put', 'putAll', 'add', 'addAll'].includes(method)) {
      if (receiver.kind === 'unknown') {
        if (++this.objects > this.limits.bindings) {
          this.limit('objects');
          return unknown(span);
        }
        receiver.kind = method.startsWith('put') ? 'map' : 'list';
        this.widen(receiver, 'unknown-map');
      }
      if ([...this.env.values()].filter((v) => v === receiver).length > 1)
        this.widen(receiver, 'alias-mutation');
      if (method === 'put' && receiver.kind === 'map') {
        const key = args[0];
        if (key?.kind === 'text' && key.texts.length === 1 && !key.unknown)
          this.setKey(receiver, key.texts[0], args[1] ?? unknown(span), [
            ...key.evidence,
            key.span,
          ]);
        else this.widen(receiver, 'dynamic-field-key');
      } else if (method === 'putAll' && receiver.kind === 'map') {
        const donor = args[0];
        if (donor?.kind === 'map' && !donor.serialized) {
          for (const [k, entry] of [...donor.keys]) {
            this.tick();
            this.setKey(receiver, k, this.snapshot(entry.value), entry.evidence);
          }
          if (donor.unknown) this.widen(receiver, 'unknown-map');
        } else this.widen(receiver, 'unknown-map');
      } else if (method === 'add' && receiver.kind === 'list')
        this.append(receiver, args[0] ?? unknown(span));
      else if (method === 'addAll' && receiver.kind === 'list' && args[0]?.kind === 'list') {
        for (const item of [...args[0].items]) this.append(receiver, item);
        if (args[0].unknown) this.widen(receiver, 'unknown-list-element');
      } else this.widen(receiver, 'unknown-mutator');
      this.propagate(receiver, aliases.peers);
      return unknown(span);
    }
    this.widen(receiver, 'unknown-mutator');
    this.propagate(receiver, aliases.peers);
    this.warn('unknown-mutator', callee);
    return unknown(span, 'helper-return');
  }

  private target(v: Value | undefined, span: SourceSpan, fresh = false): RecordTarget {
    if (fresh) return { kind: 'new-record', directParameter: false, confidence: 'exact', span };
    if (v?.parameter)
      return {
        kind: 'parameter',
        parameter: v.parameter,
        directParameter: v.directParameter ?? false,
        confidence: 'exact',
        span,
      };
    if (
      (v?.kind === 'text' && !v.unknown && v.texts.length === 1) ||
      (v?.kind === 'scalar' && !v.unknown)
    )
      return { kind: 'literal', directParameter: false, confidence: 'exact', span };
    return { kind: 'dynamic', directParameter: false, confidence: 'unknown', span };
  }
  private connection(
    v: Value | undefined,
    via: 'named-block-key' | 'positional-task',
    span?: SourceSpan,
  ): string | undefined {
    if (!v) return undefined;
    const location = span ?? v.span;
    if (this.out.connections.length >= this.limits.effects) {
      this.limit('connections', location);
      return undefined;
    }
    const use = {
      id: `c${this.out.connections.length}`,
      name: this.name(v, location),
      via,
      span: location,
    };
    const bytes = JSON.stringify(use).length * 2;
    if (this.outputBytes + bytes > this.limits.outputBytes) {
      this.limit('output-bytes', location);
      return undefined;
    }
    this.outputBytes += bytes;
    this.out.connections.push(use);
    return use.id;
  }
  private trigger(
    op: WriteEffect['op'],
    opts: Value | undefined,
    via: WriteEffect['via'],
    version: string | null,
    span: SourceSpan,
  ): TriggerPolicy {
    const rest = via === 'invokeurl' || via === 'invokeapi';
    const mechanism = rest ? 'rest-trigger' : 'native-options';
    const policy: TriggerPolicy = {
      mode: 'unknown',
      requested: null,
      documentedDefault: null,
      confidence: 'unknown',
      workflow: 'unknown',
      mechanism,
      sourceUrls: [],
      reasons: [],
    };
    const entry = opts?.kind === 'map' && !opts.serialized ? opts.keys.get('trigger') : undefined;
    if (entry && !opts?.unknown) {
      const v = entry.value;
      const empty = v.kind === 'map' && !v.keys.size && !v.unknown;
      const names =
        v.kind === 'list'
          ? v.items.flatMap((item) =>
              item.kind === 'text' && item.texts.length === 1 && !item.unknown ? item.texts : [],
            )
          : [];
      const closed = empty || (v.kind === 'list' && !v.unknown && names.length === v.items.length);
      policy.span = this.evidence(entry.evidence)[0] ?? span;
      if (closed) {
        policy.mode = names.length ? 'explicit' : 'explicit-empty';
        policy.requested = [...new Set(names)];
        policy.confidence = 'exact';
        policy.workflow = names.includes('workflow') ? 'possible' : 'not-requested';
      } else policy.reasons.push('unknown-trigger');
      return policy;
    }
    if (opts && (!rest || opts.kind !== 'map' || opts.unknown || opts.serialized)) {
      policy.reasons.push(
        opts.kind === 'map' && !opts.unknown ? 'option-present-without-trigger' : 'unknown-trigger',
      );
      return policy;
    }
    let defaults: string[] | undefined;
    if (rest && version === 'v8') {
      if (op === 'create')
        defaults = ['workflow', 'approval', 'blueprint', 'pathfinder', 'orchestration'];
      if (op === 'upsert') defaults = ['workflow', 'approval', 'blueprint'];
    } else if (!rest && (!version || version === 'v8')) defaults = NATIVE_DEFAULTS[op];
    if (defaults) {
      policy.mode = 'documented-default';
      policy.documentedDefault = [...defaults];
      policy.confidence = version === 'v8' && !rest ? 'partial' : 'exact';
      policy.workflow = defaults.includes('workflow') ? 'possible' : 'not-requested';
      if (version === 'v8' && !rest) policy.reasons.push('inherited-version-default');
      const page = (
        {
          create: 'create-record',
          update: 'update-record',
          'bulk-create': 'bulk-create-records',
          'bulk-update': 'bulk-update-records',
          upsert: 'upsert-record',
        } as Partial<Record<WriteEffect['op'], string>>
      )[op];
      if (rest)
        policy.sourceUrls = [
          `https://www.zoho.com/crm/developer/docs/api/v8/${op === 'create' ? 'insert' : 'upsert'}-records.html`,
        ];
      else if (page) policy.sourceUrls = [`https://www.zoho.com/deluge/help/crm/${page}.html`];
    }
    return policy;
  }

  private fieldSet(
    payload: Value | undefined,
    relationship = false,
  ): { fields: FieldFact[]; unknownFields: boolean; reasons: string[] } {
    const fields: FieldFact[] = [];
    let unknownFields = false;
    let reasons: string[] = [];
    const visit = (v: Value | undefined, path: string[], depth: number): void => {
      this.tick();
      if (!v || v.serialized) {
        unknownFields = true;
        reasons = this.reasons(reasons, ['unknown-map']);
        return;
      }
      reasons = this.reasons(reasons, v.reasons);
      if (v.unknown) unknownFields = true;
      if (depth > this.limits.payloadDepth) {
        unknownFields = true;
        this.limit('payload-depth');
        return;
      }
      if (v.kind === 'list') {
        for (const item of v.items) visit(item, path, depth + 1);
      } else if (v.kind === 'map') {
        for (const [k, entry] of v.keys) {
          if (k === 'id' || CONTROL_KEYS.has(k)) continue;
          if (k.startsWith('$')) {
            unknownFields = true;
            reasons = this.reasons(reasons, ['unknown-record-control']);
            continue;
          }
          const full = [...path, k];
          if (!fields.some((f) => f.path.join('\0') === full.join('\0'))) {
            fields.push({
              apiName: k,
              path: full,
              domain: path.length ? 'subform' : relationship ? 'relationship' : 'record',
              confidence: 'exact',
              schema: 'unverified',
              evidence: this.evidence(entry.evidence),
            });
          } else {
            const prior = fields.find((f) => f.path.join('\0') === full.join('\0'));
            if (prior) prior.evidence = this.evidence([...prior.evidence, ...entry.evidence]);
          }
          // Lookups remain parent fields. Lists of maps carry subform paths.
          if (entry.value.kind === 'list')
            for (const item of entry.value.items)
              if (item.kind === 'map') visit(item, [...full, '[]'], depth + 1);
        }
      } else {
        unknownFields = true;
        reasons = this.reasons(reasons, ['unknown-map']);
      }
    };
    visit(payload, [], 0);
    // A union of several records may exceed one object's key cap.
    if (fields.length > this.limits.keys) {
      fields.length = this.limits.keys;
      unknownFields = true;
      this.limit('field-facts');
    }
    return { fields, unknownFields, reasons };
  }

  private write(
    base: EffectBase,
    op: WriteEffect['op'],
    mod: Value,
    payload: Value | undefined,
    target: Value | undefined,
    via: WriteEffect['via'],
    version: string | null,
    opts?: Value,
    connectionUseId?: string,
    parent?: Value,
    targetSpan?: SourceSpan,
    destination: WriteEffect['destinationScope'] = via === 'integration-task' || via === 'connector'
      ? 'current-org'
      : 'unknown',
  ): WriteEffect {
    const module = this.name(mod);
    const noFields = ['delete', 'attach', 'add-tags', 'remove-tags', 'convert'].includes(op);
    const extracted = noFields
      ? { fields: [], unknownFields: false, reasons: [] }
      : this.fieldSet(payload, op === 'update-related');
    const fieldsConfidence = noFields
      ? 'not-applicable'
      : extracted.unknownFields
        ? extracted.fields.length
          ? 'partial'
          : 'unknown'
        : 'exact';
    const trigger = this.trigger(op, opts, via, version, base.span);
    const reasons = this.reasons(
      base.reasons,
      extracted.reasons,
      trigger.reasons,
      module.confidence === 'unknown'
        ? ['dynamic-module']
        : module.confidence === 'partial'
          ? ['correlation-loss']
          : [],
      op === 'update-related' ? ['unverified-relationship'] : [],
    );
    const confidence: Confidence =
      module.confidence === 'unknown' || fieldsConfidence === 'unknown'
        ? 'unknown'
        : module.confidence === 'partial' ||
            fieldsConfidence === 'partial' ||
            base.recognition === 'candidate' ||
            op === 'update-related'
          ? 'partial'
          : 'exact';
    const effect: WriteEffect = {
      ...base,
      confidence,
      reasons,
      op,
      via,
      apiVersion: version,
      module,
      moduleConfidence: module.confidence,
      resource:
        op === 'attach'
          ? 'attachment'
          : ['add-tags', 'remove-tags'].includes(op)
            ? 'tags'
            : op === 'convert'
              ? 'conversion'
              : op === 'update-related'
                ? 'relationship'
                : 'record',
      target: this.target(
        target,
        targetSpan ?? target?.span ?? base.span,
        op === 'create' || op === 'bulk-create',
      ),
      fields: extracted.fields,
      fieldsConfidence,
      unknownFields: extracted.unknownFields,
      trigger,
      destinationScope: connectionUseId ? 'connection-org-unknown' : destination,
      ...(payload ? { payloadSpan: payload.span } : {}),
      ...(connectionUseId ? { connectionUseId } : {}),
      ...(parent ? { parentModule: this.name(parent) } : {}),
    };
    this.add(this.out.writes, effect);
    return effect;
  }

  private conversion(
    base: EffectBase,
    configuration: Value | undefined,
    target: Value | undefined,
    via: WriteEffect['via'],
    version: string | null,
    connection?: string,
  ): void {
    const source = this.write(
      base,
      'convert',
      text('Leads', base.calleeSpan),
      undefined,
      target,
      via,
      version,
      undefined,
      connection,
    );
    source.groupId = `conversion:${base.span.start}`;
    const targets: Array<[string, Value | undefined]> = [
      ['Contacts', undefined],
      ['Accounts', undefined],
    ];
    const deals =
      configuration?.kind === 'map' ? configuration.keys.get('Deals')?.value : undefined;
    if (deals || !configuration || configuration.unknown || configuration.kind !== 'map')
      targets.push(['Deals', deals]);
    for (const [module, explicit] of targets) {
      const payload = explicit ? this.copy(explicit) : unknown(base.span, 'conversion-mapping');
      this.widen(payload, 'conversion-mapping');
      const effect = this.write(
        this.base(base.span, base.calleeSpan),
        'crm-mutation',
        text(module, base.calleeSpan),
        payload,
        undefined,
        via,
        version,
        undefined,
        connection,
      );
      effect.resource = 'conversion';
      effect.groupId = source.groupId;
    }
  }

  private call(
    chain: string,
    args: Value[],
    argSpans: SourceSpan[],
    span: SourceSpan,
    callee: SourceSpan,
  ): Value {
    if (['Map', 'map', 'List', 'list'].includes(chain)) {
      if (args.length) {
        this.warn('unsupported-constructor', span);
        return unknown(span, 'unsupported-constructor');
      }
      return this.heap(chain.toLowerCase() === 'map' ? 'map' : 'list', span);
    }
    const segments = chain.split('.');
    if (segments[0] === 'zoho' && segments.length >= 3) {
      const service = segments[1];
      const version = /^v\d+(?:\.\d+)?$/.test(segments[2]) ? segments[2] : null;
      const method = segments.slice(version ? 3 : 2).join('.');
      if (service !== 'crm') {
        for (const arg of args)
          if ((arg.kind === 'map' || arg.kind === 'list') && !arg.serialized)
            this.invalidate(arg, 'unknown-mutator');
        this.add(this.out.services, {
          ...this.base(span, callee),
          service,
          method,
          apiVersion: version,
        });
        return unknown(span, 'helper-return');
      }
      const task = Object.hasOwn(TASKS, method) ? TASKS[method] : undefined;
      if (version && version !== 'v8') this.warn('unverified-version', callee);
      if (task && args.length >= task.min && args.length <= (task.connection ?? task.min - 1) + 1) {
        const connection = this.connection(
          task.connection === undefined ? undefined : args[task.connection],
          'positional-task',
          task.connection === undefined ? undefined : argSpans[task.connection],
        );
        if (task.op === 'convert')
          this.conversion(
            this.base(span, callee),
            args[task.payload ?? -1],
            args[task.target ?? -1],
            'integration-task',
            version,
            connection,
          );
        else
          this.write(
            this.base(span, callee),
            task.op,
            args[task.module] ?? unknown(span),
            task.payload === undefined ? undefined : args[task.payload],
            task.target === undefined ? undefined : args[task.target],
            'integration-task',
            version,
            task.options === undefined ? undefined : args[task.options],
            connection,
            task.parent === undefined ? undefined : args[task.parent],
            task.target === undefined ? undefined : argSpans[task.target],
          );
        return unknown(span, 'helper-return');
      }
      if (method === 'invokeConnector' && args[0]?.texts[0] === 'crm.delete' && args.length === 2) {
        const config = args[1];
        this.write(
          this.base(span, callee),
          'delete',
          config.keys.get('module')?.value ?? unknown(span),
          undefined,
          config.keys.get('id')?.value,
          'connector',
          version,
        );
        return unknown(span);
      }
      if (['getRecordById', 'searchRecords'].includes(method)) {
        this.add(this.out.reads, {
          ...this.base(span, callee),
          op: method === 'getRecordById' ? 'get-by-id' : 'search',
          module: this.name(args[0] ?? unknown(span)),
          fields: [],
          fieldsConfidence: 'unknown',
        });
        return unknown(span, 'read-derived');
      }
      const base = this.base(span, callee, 'candidate');
      base.reasons = ['unclassified-crm-call', 'unverified-task-signature'];
      this.add(this.out.services, {
        ...base,
        confidence: 'unknown',
        service: 'crm',
        method,
        apiVersion: version,
      });
      if (method === 'deleteRecord')
        this.write(
          this.base(span, callee, 'candidate'),
          'delete',
          unknown(span),
          undefined,
          undefined,
          'integration-task',
          version,
        );
      else if (task)
        this.write(
          this.base(span, callee, 'candidate'),
          'crm-mutation',
          unknown(span),
          undefined,
          undefined,
          'integration-task',
          version,
        );
      return unknown(span, 'helper-return');
    }
    this.functionCall(chain, args, argSpans, span, callee, 'direct');
    for (const arg of args)
      if ((arg.kind === 'map' || arg.kind === 'list') && !arg.serialized)
        this.invalidate(arg, 'unknown-mutator');
    return unknown(span, 'helper-return');
  }

  private functionCall(
    chain: string | null,
    args: Value[],
    argSpans: SourceSpan[],
    span: SourceSpan,
    callee: SourceSpan,
    via: FunctionCall['via'],
    connectionUseId?: string,
    destination: WriteEffect['destinationScope'] = 'current-org',
  ): void {
    const segments = chain?.split('.') ?? [];
    const category = via === 'direct' && segments.length > 1 ? segments[0] : null;
    const apiName =
      via === 'http-execute'
        ? chain
        : segments.length === 2
          ? segments[1]
          : segments.length === 1
            ? segments[0]
            : null;
    const ids = apiName ? this.catalogue.get(apiName) : undefined;
    const local =
      via === 'http-execute' ||
      (category !== null && category !== 'thisapp' && this.categories.has(category)) ||
      (category === null && !!ids);
    const canResolve =
      local &&
      this.options.catalogue !== undefined &&
      (via === 'direct' || destination === 'current-org');
    const resolution: FunctionCall['resolution'] = !canResolve
      ? 'not-attempted'
      : !ids?.size
        ? 'missing'
        : ids.size > 1
          ? 'ambiguous'
          : 'exact';
    const base = this.base(
      span,
      callee,
      category === 'standalone' || (via === 'http-execute' && chain !== null)
        ? 'registered'
        : 'candidate',
    );
    if (!local) base.reasons = ['unclassified-call'];
    const effect: FunctionCall = {
      ...base,
      confidence: chain ? (base.recognition === 'registered' ? 'exact' : 'partial') : 'unknown',
      kind: local
        ? 'crm-function'
        : category === 'thisapp' || segments.length > 1
          ? 'other-product-function'
          : 'unclassified',
      qualifiedName: this.name(chain === null ? unknown(callee) : text(chain, callee)),
      category,
      apiName,
      via,
      resolution,
      calleeFunctionId: resolution === 'exact' ? [...(ids ?? [])][0] : null,
      arguments: args.map((v, position) => ({
        position,
        span: argSpans[position],
        shape: v.serialized
          ? 'scalar'
          : v.kind === 'map' || v.kind === 'list'
            ? v.kind
            : v.kind === 'unknown'
              ? 'unknown'
              : 'scalar',
        ...(v.parameter ? { parameterOrigin: v.parameter } : {}),
      })),
      destinationScope: connectionUseId ? 'connection-org-unknown' : destination,
      ...(connectionUseId ? { connectionUseId } : {}),
    };
    this.add(this.out.calls, effect);
  }

  private block(a: number, close: number): void {
    const keyword = this.tokens[a].text;
    const span = this.span(a, close + 1),
      callee = this.span(a, a + 1);
    const props = new Map<string, Value>();
    const propSpans = new Map<string, SourceSpan>();
    const starts: Array<{ name: string; key: number; start: number }> = [];
    for (let i = a + 2; i < close; i++) {
      this.tick(i);
      if (!this.tokens[i].literal && ['(', '{', '['].includes(this.tokens[i].text)) {
        i = this.pairs.get(i) ?? i;
        continue;
      }
      let name = this.tokens[i].text,
        colon = i + 1;
      if (this.tokens[colon]?.text === '-' && IDENTIFIER.test(this.tokens[colon + 1]?.text ?? '')) {
        name += `-${this.tokens[colon + 1].text}`;
        colon += 2;
      }
      if (
        !this.tokens[i].literal &&
        this.tokens[colon]?.text === ':' &&
        (BLOCK_KEYS.has(name) || IDENTIFIER.test(name))
      ) {
        starts.push({ name, key: i, start: colon + 1 });
        i = colon;
      }
    }
    for (let i = 0; i < starts.length; i++) {
      const prop = starts[i],
        end = starts[i + 1]?.key ?? close;
      const v =
        (prop.name === 'type' &&
          end === prop.start + 1 &&
          METHODS.has(this.tokens[prop.start].text)) ||
        (prop.name === 'service' && end === prop.start + 1)
          ? text(this.tokens[prop.start].text, this.span(prop.start, end))
          : this.evaluate(prop.start, end);
      const previous = props.get(prop.name);
      if (previous) {
        props.set(prop.name, this.merge(previous, v));
        this.widen(props.get(prop.name) ?? v, 'duplicate-block-key');
        this.warn('invalid-request', this.span(prop.key, end));
      } else props.set(prop.name, v);
      propSpans.set(prop.name, this.span(prop.start, end));
    }
    if (keyword === 'sendmail' || keyword === 'sendMail') {
      this.add(this.out.external, {
        ...this.base(span, callee),
        kind: 'sendmail',
        destination: 'email',
        method: null,
      });
      return;
    }
    const connection = this.connection(
      props.get('connection'),
      'named-block-key',
      propSpans.get('connection'),
    );
    const methodValue = props.get('type');
    const method = !methodValue
      ? 'GET'
      : methodValue.kind === 'text' && methodValue.texts.length === 1 && !methodValue.unknown
        ? methodValue.texts[0]
        : null;
    let body =
      props.get('body') ??
      (['POST', 'PUT', 'PATCH'].includes(method ?? '') ? props.get('parameters') : undefined);
    const invalid = props.has('body') && props.has('parameters');
    if (invalid) {
      this.warn('invalid-request', span);
      body = unknown(span, 'invalid-request');
    }
    if (body?.serialized) {
      body = this.copy(body);
      body.serialized = false;
    }
    if (body?.kind === 'text' && !body.unknown && body.texts.length === 1) {
      try {
        body = this.jsonValue(JSON.parse(body.texts[0]), body.span, 0);
      } catch {
        body = unknown(body.span, 'invalid-envelope');
      }
    }
    const contentType = props.get('headers')?.keys.get('Content-Type')?.value.texts[0];
    if (body && contentType && !contentType.toLowerCase().includes('json')) {
      this.warn('content-type-mismatch', span);
      body = unknown(body.span, 'content-type-mismatch');
    }
    if (keyword === 'invokeapi') {
      const service = props.get('service');
      if (service?.texts[0] === 'zohocrm' && !service.unknown) {
        this.route(
          props.get('path') ?? unknown(span),
          method,
          body,
          span,
          callee,
          'invokeapi',
          connection,
          true,
        );
        return;
      }
      this.add(this.out.external, {
        ...this.base(span, callee, 'candidate'),
        kind: 'http',
        destination: 'zoho-service-url',
        method,
        ...(service?.texts[0] ? { service: service.texts[0] } : {}),
        ...(connection ? { connectionUseId: connection } : {}),
      });
      this.warn('unsupported-form', span);
      this.markLimited('unsupported-form');
      return;
    }
    this.route(
      props.get('url') ?? unknown(span),
      method,
      body,
      span,
      callee,
      'invokeurl',
      connection,
    );
  }

  private jsonValue(input: unknown, span: SourceSpan, depth: number): Value {
    this.tick();
    if (depth > this.limits.payloadDepth) {
      this.limit('payload-depth', span);
      return unknown(span);
    }
    if (typeof input === 'string') return text(input, span);
    if (Array.isArray(input)) {
      const out = this.heap('list', span);
      for (const item of input.slice(0, this.limits.listElements))
        this.append(out, this.jsonValue(item, span, depth + 1));
      if (input.length > this.limits.listElements) {
        out.unknown = true;
        this.limit('list-elements');
      }
      return out;
    }
    if (input !== null && typeof input === 'object') {
      const out = this.heap('map', span);
      const entries = Object.entries(input);
      for (const [k, v] of entries.slice(0, this.limits.keys))
        this.setKey(out, k, this.jsonValue(v, span, depth + 1), [span]);
      if (entries.length > this.limits.keys) {
        out.unknown = true;
        this.limit('keys');
      }
      return out;
    }
    return value('scalar', span);
  }

  private route(
    urlValue: Value,
    method: string | null,
    body: Value | undefined,
    span: SourceSpan,
    callee: SourceSpan,
    via: 'invokeurl' | 'invokeapi',
    connection?: string,
    api = false,
  ): void {
    const literal = urlValue.kind === 'text' && urlValue.texts.length === 1 && !urlValue.unknown;
    const prefix = literal ? urlValue.texts[0] : urlValue.prefix;
    let url: URL | undefined;
    let trusted = api;
    let current = false;
    let destination: 'external-url' | 'zoho-service-url' | 'unknown-url' = 'unknown-url';
    let service: string | undefined;
    if (prefix && (literal || api || /^https?:\/\/[^/]+\//.test(prefix))) {
      try {
        url = new URL(api ? prefix : prefix, api ? 'https://www.zohoapis.com' : undefined);
        const knownOrigin = !api && url.origin === this.options.currentCrmOrigin;
        current = !connection && knownOrigin;
        trusted ||= CRM_HOSTS.has(url.hostname) || knownOrigin;
        service = Object.hasOwn(SERVICE_HOSTS, url.hostname)
          ? SERVICE_HOSTS[url.hostname]
          : undefined;
        destination = service
          ? 'zoho-service-url'
          : /(?:^|\.)zoho(?:apis)?\.(?:com|eu|in|com\.au|jp|ca|sa|cn)$/.test(url.hostname)
            ? 'unknown-url'
            : 'external-url';
      } catch {
        /* Malformed/dynamic authority is an unresolved destination. */
      }
    }
    if (api && !url && !['GET', 'HEAD', 'OPTIONS'].includes(method ?? '')) {
      const base = this.base(span, callee, 'candidate');
      base.reasons = ['unverified-route-or-method'];
      this.write(
        base,
        'crm-mutation',
        unknown(urlValue.span),
        unknown(body?.span ?? span),
        undefined,
        via,
        null,
        body,
        connection,
      );
      return;
    }
    if (!trusted || !url) {
      this.add(this.out.external, {
        ...this.base(span, callee, literal ? 'registered' : 'candidate'),
        confidence: literal ? 'exact' : 'unknown',
        kind: 'http',
        destination,
        method,
        ...(connection ? { connectionUseId: connection } : {}),
        ...(service ? { service } : {}),
      });
      return;
    }
    const path = url.pathname.split('/').filter(Boolean);
    if (path[0] !== 'crm' || !/^v\d+(?:\.\d+)?$/.test(path[1] ?? '')) {
      this.warn('unclassified-crm-request', span);
      return;
    }
    const version = path[1];
    const registeredVersion = /^v(?:[2-8]|2\.[12])$/.test(version);
    if (!registeredVersion) this.warn('unverified-version', span);
    const scope = current ? 'current-org' : connection ? 'connection-org-unknown' : 'unknown';
    const resource = path[2];
    // Route precedence prevents settings, function execution and COQL becoming modules.
    if (resource === 'functions' || (resource === 'settings' && path[3] === 'custom_functions')) {
      const nameIndex = resource === 'functions' ? 3 : 4;
      const name = path[nameIndex];
      if (
        (literal &&
          name &&
          (path.slice(nameIndex + 1).join('/') === 'actions/execute' ||
            path.slice(nameIndex + 1).join('/') === 'execute')) ||
        !literal
      ) {
        this.functionCall(
          literal ? name : null,
          [],
          [],
          span,
          callee,
          'http-execute',
          connection,
          scope,
        );
      } else this.warn('unclassified-crm-request', span);
      return;
    }
    if (resource && (RESERVED.has(resource) || resource.startsWith('__'))) {
      if (resource !== 'coql') this.warn('unclassified-crm-request', span);
      return;
    }
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    // A module prefix is proven only when its following delimiter is literal.
    const moduleKnown =
      resource && (literal || (url.pathname.endsWith('/') && path.length === 3) || path.length > 3);
    const mod = moduleKnown ? text(resource, urlValue.span) : unknown(urlValue.span);
    let op: WriteEffect['op'] = 'crm-mutation';
    let candidate = !registeredVersion || method === null;
    let parent: Value | undefined;
    const tail = path.slice(3);
    if (
      tail.includes('actions') &&
      tail[tail.length - 2] === 'actions' &&
      ['add_tags', 'remove_tags'].includes(tail[tail.length - 1]) &&
      method === 'POST'
    )
      op = tail[tail.length - 1] === 'add_tags' ? 'add-tags' : 'remove-tags';
    else if (
      resource === 'Leads' &&
      tail.length === 3 &&
      tail[1] === 'actions' &&
      tail[2] === 'convert' &&
      method === 'POST'
    ) {
      this.conversion(
        this.base(span, callee),
        body?.keys.get('data')?.value.items[0],
        undefined,
        via,
        version,
        connection,
      );
      return;
    } else if (
      tail[1] === 'Attachments' &&
      ['POST', 'DELETE'].includes(method ?? '') &&
      tail.length <= 3
    )
      op = 'attach';
    else if (
      tail.length >= 2 &&
      tail[0] !== 'actions' &&
      tail[1] !== 'actions' &&
      tail[1] !== 'Attachments'
    ) {
      op = 'update-related';
      candidate = true;
      parent = mod;
      // Relation names are not proven ordinary record modules.
    } else if (tail[0] === 'upsert' && method === 'POST') op = 'upsert';
    else if (method === 'POST' && tail.length === 0) op = 'create';
    else if (method === 'PUT' && tail.length <= 1) op = 'update';
    else if (method === 'DELETE' && tail.length <= 1) op = 'delete';
    else candidate = true;
    if (op === 'crm-mutation') candidate = true;
    const base = this.base(span, callee, candidate ? 'candidate' : 'registered');
    if (candidate) base.reasons.push('unverified-route-or-method');
    let payload = body?.kind === 'map' ? body.keys.get('data')?.value : undefined;
    if (
      ['create', 'update', 'upsert', 'crm-mutation', 'update-related'].includes(op) &&
      payload?.kind !== 'list'
    ) {
      base.reasons.push('invalid-envelope');
      payload = unknown(body?.span ?? span, 'invalid-envelope');
    }
    const relation = parent ? text(tail[1], urlValue.span) : mod;
    const effect = this.write(
      base,
      op,
      relation,
      payload,
      undefined,
      via,
      version,
      body,
      connection,
      parent,
      undefined,
      scope,
    );
    if (op === 'delete') {
      const wf = literal ? url.searchParams.get('wf_trigger') : null;
      const known = wf === 'true' || wf === 'false';
      effect.trigger = {
        mode: known
          ? wf === 'true'
            ? 'explicit'
            : 'explicit-empty'
          : literal && version === 'v8'
            ? 'documented-default'
            : 'unknown',
        requested: known ? (wf === 'true' ? ['workflow'] : []) : null,
        documentedDefault: !known && literal && version === 'v8' ? ['workflow'] : null,
        confidence: known || (literal && version === 'v8') ? 'exact' : 'unknown',
        workflow:
          wf === 'false'
            ? 'not-requested'
            : known || (literal && version === 'v8')
              ? 'possible'
              : 'unknown',
        mechanism: 'wf_trigger',
        sourceUrls: ['https://www.zoho.com/crm/developer/docs/api/v8/delete-records.html'],
        reasons: [],
      };
    }
  }
}
