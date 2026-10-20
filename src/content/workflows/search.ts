import { json, triggerTypes } from './normalize';
import type {
  MatchProvenance,
  WorkflowAction,
  WorkflowActionKind,
  WorkflowActionLocation,
  WorkflowCriteria,
  WorkflowIndexSnapshot,
  WorkflowRule,
  WorkflowTriggerType,
} from './types';

export type WorkflowSearchScope = 'all' | 'name' | 'conditions' | 'actions' | 'code';

/**
 * Empty arrays mean unrestricted. OR within each facet, AND across facets.
 * Query is literal text; empty query browses metadata. `name` includes description;
 * `conditions` includes trigger criteria; `actions` includes templates/webhooks;
 * source text belongs to `code`. Unknown JSON is searchable within its location.
 */
export interface WorkflowFilters {
  query: string;
  modules: readonly string[];
  active: 'all' | 'active' | 'inactive';
  triggerTypes: readonly WorkflowTriggerType[];
  triggerFieldApiNames: readonly string[];
  actionKinds: readonly WorkflowActionKind[];
  /** True: at least one available source; false: none currently available. */
  hasFunctionSource?: boolean;
  /** Unavailable includes pending/missing/uncertain bindings; rules without functions are excluded. */
  functionSource?: 'any' | 'available' | 'unavailable';
  templateIds?: readonly string[];
  scope: WorkflowSearchScope;
}

export interface WorkflowSearchResult {
  rule: WorkflowRule;
  /** Higher scores rank first; ties preserve snapshot order. */
  score: number;
  /** Empty for filter-only matches. Repeated actions retain their own provenance. */
  matches: readonly MatchProvenance[];
}

export interface WorkflowFacetCount<Key extends string = string> {
  key: Key;
  label: string;
  /** Number of distinct rules, not action occurrences. */
  count: number;
}

export interface WorkflowFacetCounts {
  modules: readonly WorkflowFacetCount[];
  triggerTypes: readonly WorkflowFacetCount<WorkflowTriggerType>[];
  actionKinds: readonly WorkflowFacetCount<WorkflowActionKind>[];
  active: readonly WorkflowFacetCount<'active' | 'inactive'>[];
  functionSource: readonly WorkflowFacetCount<'available' | 'unavailable'>[];
}

type Address = MatchProvenance extends infer P
  ? P extends MatchProvenance
    ? Omit<P, 'snippet' | 'highlights'>
    : never
  : never;
interface DocumentField {
  text: string;
  lower: string;
  scope: WorkflowSearchScope;
  address: Address;
  offsets?: { starts: number[]; ends: number[] };
}
interface SearchDocument {
  rule: WorkflowRule;
  fields: DocumentField[];
  actions: WorkflowAction[];
  triggerFields: string[];
  lastMatch?: { query: string; scope: WorkflowSearchScope; matches: MatchProvenance[] };
}
const documents = new WeakMap<WorkflowRule, SearchDocument>();
function prepare(snapshot: WorkflowIndexSnapshot): SearchDocument[] {
  return snapshot.rules.map((rule) => {
    const cached = documents.get(rule);
    if (cached) return cached;
    const fields: DocumentField[] = [],
      actions: WorkflowAction[] = [],
      triggerFields: string[] = [];
    const add = (text: string, scope: WorkflowSearchScope, address: Address) => {
      const lower = text.toLowerCase();
      const field: DocumentField = { text, lower, scope, address };
      // Unicode case folding can expand characters (e.g. İ). Preserve original UTF-16 offsets.
      if (lower.length !== text.length) {
        const starts: number[] = [],
          ends: number[] = [];
        let offset = 0;
        for (const char of text) {
          for (let i = 0; i < char.toLowerCase().length; i++) {
            starts.push(offset);
            ends.push(offset + char.length);
          }
          offset += char.length;
        }
        field.offsets = { starts, ends };
      }
      fields.push(field);
    };
    add(rule.name, 'name', { location: 'ruleName' });
    add(rule.description, 'name', { location: 'ruleDescription' });
    add(`${rule.module.label} ${rule.module.apiName}`, 'name', { location: 'ruleDescription' });
    const criteria = (
      c: WorkflowCriteria | null,
      address: Address,
      path: number[] = [],
      trigger = false,
    ) => {
      if (!c) return;
      if (c.kind === 'group')
        c.children.forEach((child, i) => {
          criteria(child, address, [...path, i], trigger);
        });
      else {
        if (trigger && c.kind === 'predicate') triggerFields.push(c.field.apiName);
        add(
          c.kind === 'predicate'
            ? `${c.field.label} ${c.field.apiName} ${c.comparator} ${json(c.value)}`
            : c.jsonText,
          'conditions',
          address.location === 'condition' ? { ...address, criteriaPath: path } : address,
        );
      }
    };
    if (rule.trigger) {
      add(json(rule.trigger), 'conditions', { location: 'trigger' });
      if (rule.trigger.type === 'field_update')
        criteria(rule.trigger.criteria, { location: 'trigger' }, [], true);
      if (rule.trigger.type === 'date_or_datetime' && rule.trigger.field)
        triggerFields.push(rule.trigger.field.apiName);
    }
    const action = (a: WorkflowAction, location: WorkflowActionLocation) => {
      actions.push(a);
      // Source has its own scope and provenance, never sneaks into generic action JSON.
      const { raw, resourceRaw, ...metadata } = a;
      const text =
        a.kind === 'function' ? json({ ...metadata, sourceText: undefined }) : json(metadata);
      add(`${text} ${json(raw)} ${json(resourceRaw)}`, 'actions', {
        location: a.kind === 'webhook' ? 'webhook' : 'action',
        action: location,
      });
      if (a.kind === 'emailNotification' && a.template)
        add(
          `${a.template.name} ${a.template.subject ?? ''} ${a.template.bodyText ?? ''}`,
          'actions',
          { location: 'emailTemplate', action: location },
        );
      if (a.kind === 'function' && a.sourceState === 'available' && a.sourceText)
        add(a.sourceText, 'code', { location: 'functionSource', action: location, lineNumber: 1 });
    };
    rule.conditions.forEach((c, conditionIndex) => {
      criteria(c.criteria, {
        location: 'condition',
        conditionIndex,
        criteriaPath: [],
        related: false,
      });
      criteria(c.relatedCriteria?.criteria ?? null, {
        location: 'condition',
        conditionIndex,
        criteriaPath: [],
        related: true,
      });
      c.instantActions.forEach((a, actionIndex) => {
        action(a, { timing: 'instant', conditionIndex, actionIndex, actionKind: a.kind });
      });
      c.scheduledActions.forEach((s, scheduleIndex) => {
        s.actions.forEach((a, actionIndex) => {
          action(a, {
            timing: 'scheduled',
            conditionIndex,
            scheduleIndex,
            actionIndex,
            actionKind: a.kind,
          });
        });
      });
    });
    const doc = { rule, fields, actions, triggerFields };
    documents.set(rule, doc);
    return doc;
  });
}
function accepts(d: SearchDocument, f: WorkflowFilters): boolean {
  return (
    (!f.modules.length || f.modules.includes(d.rule.module.apiName)) &&
    (f.active === 'all' || d.rule.active === (f.active === 'active')) &&
    (!f.triggerTypes.length ||
      (!!d.rule.trigger && f.triggerTypes.includes(d.rule.trigger.type))) &&
    (!f.triggerFieldApiNames.length ||
      d.triggerFields.some((v) => f.triggerFieldApiNames.includes(v))) &&
    (!f.actionKinds.length || d.actions.some((a) => f.actionKinds.includes(a.kind))) &&
    (f.hasFunctionSource === undefined ||
      d.actions.some((a) => a.kind === 'function' && a.sourceState === 'available') ===
        f.hasFunctionSource) &&
    (!f.functionSource ||
      f.functionSource === 'any' ||
      d.actions.some(
        (a) =>
          a.kind === 'function' &&
          (f.functionSource === 'available'
            ? a.sourceState === 'available'
            : a.sourceState !== 'available'),
      )) &&
    (!f.templateIds?.length ||
      d.actions.some(
        (a) =>
          a.kind === 'emailNotification' && a.template && f.templateIds?.includes(a.template.id),
      ))
  );
}
function match(d: SearchDocument, f: WorkflowFilters): MatchProvenance[] {
  const q = f.query.trim().toLowerCase();
  if (!q) return [];
  if (d.lastMatch?.query === q && d.lastMatch.scope === f.scope) return d.lastMatch.matches;
  const matches = d.fields.flatMap((field) => {
    if (f.scope !== 'all' && field.scope !== f.scope) return [];
    const index = field.lower.indexOf(q);
    if (index < 0) return [];
    const originalStart = (at: number) => field.offsets?.starts[at] ?? at;
    const originalEnd = (at: number) => field.offsets?.ends[at - 1] ?? at;
    const hitStart = originalStart(index),
      hitEnd = originalEnd(index + q.length);
    // A code snippet begins on the reported hit line, never on the preceding line.
    const code = field.address.location === 'functionSource';
    const lineStart = hitStart === 0 ? 0 : field.text.lastIndexOf('\n', hitStart - 1) + 1;
    const newline = field.text.indexOf('\n', hitEnd);
    const start = Math.max(code ? lineStart : 0, hitStart - 60),
      end = Math.min(field.text.length, code && newline >= 0 ? newline : Infinity, hitEnd + 100);
    const snippet = field.text.slice(start, end),
      highlights = [];
    for (
      let at = index;
      at >= 0 && originalStart(at) < end;
      at = field.lower.indexOf(q, at + q.length)
    ) {
      const matchEnd = originalEnd(at + q.length);
      if (matchEnd <= end)
        highlights.push({ start: originalStart(at) - start, end: matchEnd - start });
    }
    const address =
      field.address.location === 'functionSource'
        ? { ...field.address, lineNumber: field.text.slice(0, hitStart).split('\n').length }
        : field.address;
    return [{ ...address, snippet, highlights } as MatchProvenance];
  });
  d.lastMatch = { query: q, scope: f.scope, matches };
  return matches;
}
export function searchWorkflows(
  snapshot: WorkflowIndexSnapshot,
  filters: WorkflowFilters,
): WorkflowSearchResult[] {
  return prepare(snapshot)
    .flatMap((d) => {
      if (!accepts(d, filters)) return [];
      const matches = [...match(d, filters)].sort(
        (a, b) =>
          Number('action' in b && filters.actionKinds.includes(b.action.actionKind)) -
          Number('action' in a && filters.actionKinds.includes(a.action.actionKind)),
      );
      if (filters.query.trim() && !matches.length) return [];
      return [
        {
          rule: d.rule,
          matches,
          score:
            (matches.some((m) => 'action' in m && filters.actionKinds.includes(m.action.actionKind))
              ? 10000
              : 0) + matches.reduce((n, m) => n + (m.location === 'ruleName' ? 10 : 1), 0),
        },
      ];
    })
    .sort((a, b) => b.score - a.score);
}
export function facetCounts(
  snapshot: WorkflowIndexSnapshot,
  filters: WorkflowFilters,
): WorkflowFacetCounts {
  const docs = prepare(snapshot);
  function count<K extends string>(
    values: (d: SearchDocument) => [K, string][],
    without: Partial<WorkflowFilters>,
    known: [K, string][] = [],
  ): WorkflowFacetCount<K>[] {
    const buckets = new Map<K, WorkflowFacetCount<K>>();
    for (const [key, label] of [...known, ...docs.flatMap(values)])
      buckets.set(key, { key, label, count: 0 });
    const f = { ...filters, ...without };
    for (const d of docs)
      if (accepts(d, f) && (!f.query.trim() || match(d, f).length))
        for (const key of new Set(values(d).map(([key]) => key))) {
          const b = buckets.get(key);
          if (b) b.count++;
        }
    return [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  return {
    modules: count((d) => [[d.rule.module.apiName, d.rule.module.label]], { modules: [] }),
    triggerTypes: count(
      (d) => (d.rule.trigger ? [[d.rule.trigger.type, d.rule.trigger.type]] : []),
      { triggerTypes: [] },
      triggerTypes.map((t) => [t, t]),
    ),
    actionKinds: count(
      (d) => d.actions.map((a) => [a.kind, a.kind]),
      { actionKinds: [] },
      (
        [
          'fieldUpdate',
          'task',
          'emailNotification',
          'webhook',
          'function',
          'slack',
          'assignOwner',
          'addTags',
          'convert',
          'unknown',
        ] as WorkflowActionKind[]
      ).map((kind) => [kind, kind]),
    ),
    functionSource: count(
      (d) =>
        [
          ...new Set(
            d.actions
              .filter((a) => a.kind === 'function')
              .map((a) =>
                a.sourceState === 'available' ? ('available' as const) : ('unavailable' as const),
              ),
          ),
        ].map((key) => [key, key]),
      { functionSource: 'any', hasFunctionSource: undefined },
      [
        ['available', 'Available'],
        ['unavailable', 'Unavailable'],
      ],
    ),
    active: count(
      (d) =>
        d.rule.active === null
          ? []
          : [[d.rule.active ? 'active' : 'inactive', d.rule.active ? 'Active' : 'Inactive']],
      { active: 'all' },
      [
        ['active', 'Active'],
        ['inactive', 'Inactive'],
      ],
    ),
  };
}
