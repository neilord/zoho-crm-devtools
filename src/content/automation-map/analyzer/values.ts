import type { SourceSpan } from './types';

export interface Entry {
  value: Value;
  evidence: SourceSpan[];
}
/** Internal heap nodes are shared by aliases, and never escape into JSON output. */
export interface Value {
  kind: 'unknown' | 'text' | 'scalar' | 'map' | 'list';
  span: SourceSpan;
  evidence: SourceSpan[];
  texts: string[];
  /** Proven literal prefix before the first runtime hole, used only at URL sinks. */
  prefix: string;
  keys: Map<string, Entry>;
  items: Value[];
  unknown: boolean;
  reasons: string[];
  parameter?: string;
  directParameter?: boolean;
  /** A serialized snapshot is decoded as data only at a recognized HTTP body sink. */
  serialized?: boolean;
  identities: Set<object>;
  origin: 'literal' | 'propagated' | 'branch-union' | 'dynamic';
}
export function value(kind: Value['kind'], span: SourceSpan, unknown = false): Value {
  return {
    kind,
    span,
    evidence: [],
    texts: [],
    prefix: '',
    keys: new Map(),
    items: [],
    unknown,
    reasons: [],
    origin: kind === 'unknown' ? 'dynamic' : 'literal',
    identities: new Set([{}]),
  };
}
export function unknown(span: SourceSpan, reason = 'unknown-map'): Value {
  const v = value('unknown', span, true);
  v.reasons = [reason];
  return v;
}
export function text(s: string, span: SourceSpan): Value {
  const v = value('text', span);
  v.texts = [s];
  v.prefix = s;
  v.evidence = [span];
  return v;
}
export function clone(
  v: Value,
  memo = new Map<Value, Value>(),
  maxDepth = 4,
  tick: () => void = () => {},
  limited: () => void = () => {},
  depth = 0,
): Value {
  tick();
  const old = memo.get(v);
  if (old) return old;
  if (depth > maxDepth) {
    limited();
    return unknown(v.span, 'summary-depth');
  }
  const out = {
    ...v,
    evidence: [...v.evidence],
    texts: [...v.texts],
    reasons: [...v.reasons],
    keys: new Map<string, Entry>(),
    items: [] as Value[],
  };
  memo.set(v, out);
  for (const [k, entry] of v.keys)
    out.keys.set(k, {
      evidence: [...entry.evidence],
      value: clone(entry.value, memo, maxDepth, tick, limited, depth + 1),
    });
  out.items = v.items.map((item) => clone(item, memo, maxDepth, tick, limited, depth + 1));
  return out;
}
