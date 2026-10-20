import {
  facetCounts,
  searchWorkflows,
  type WorkflowFacetCount,
  type WorkflowFilters,
  type WorkflowSearchResult,
  type WorkflowSearchScope,
} from './search';
import type {
  HighlightRange,
  MatchProvenance,
  WorkflowAction,
  WorkflowActionKind,
  WorkflowActionLocation,
  WorkflowCriteria,
  WorkflowIndexFailure,
  WorkflowIndexSnapshot,
  WorkflowRule,
  WorkflowTrigger,
  WorkflowTriggerType,
} from './types';

/** Pure presentation logic for the workflow dashboard: no DOM, easy to unit test. */

export const KIND_LABELS: Readonly<Record<WorkflowActionKind, string>> = {
  fieldUpdate: 'Field update',
  task: 'Task',
  emailNotification: 'Email notification',
  webhook: 'Webhook',
  function: 'Function',
  slack: 'Slack',
  assignOwner: 'Assign owner',
  addTags: 'Add tags',
  convert: 'Convert',
  unknown: 'Other',
};
export const KIND_ORDER: readonly WorkflowActionKind[] = [
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
];

export const TRIGGER_LABELS: Readonly<Record<WorkflowTriggerType, string>> = {
  field_update: 'Field update',
  create: 'Record created',
  create_or_edit: 'Created or edited',
  edit: 'Record edited',
  date_or_datetime: 'Date / time',
  mail_sent: 'Email sent',
  mail_sent_opened: 'Email opened',
  mail_sent_bounced: 'Email bounced',
  email_received: 'Email received',
  section_update: 'Section update',
  incoming_call_createedit: 'Incoming call',
  outgoing_call_createedit: 'Outgoing call',
  unknown: 'Unrecognized',
};

export const SCOPE_LABELS: Readonly<Record<WorkflowSearchScope, string>> = {
  all: 'Everywhere',
  name: 'Name',
  conditions: 'Conditions',
  actions: 'Actions',
  code: 'Function code',
};
export const SCOPE_ORDER: readonly WorkflowSearchScope[] = [
  'all',
  'name',
  'conditions',
  'actions',
  'code',
];

export type SortKey = 'relevance' | 'name' | 'module' | 'modified';
export type CodeFilter = 'has' | 'missing';

/** Dashboard-level filter state; translated to the frozen {@link WorkflowFilters}. */
export interface UiFilters {
  query: string;
  scope: WorkflowSearchScope;
  status: Set<'active' | 'inactive'>;
  modules: Set<string>;
  triggerTypes: Set<WorkflowTriggerType>;
  triggerField: string;
  actionKinds: Set<WorkflowActionKind>;
  code: Set<CodeFilter>;
}

export function emptyFilters(): UiFilters {
  return {
    query: '',
    scope: 'all',
    status: new Set(),
    modules: new Set(),
    triggerTypes: new Set(),
    triggerField: '',
    actionKinds: new Set(),
    code: new Set(),
  };
}

export function activeFilterCount(f: UiFilters): number {
  return (
    f.status.size +
    f.modules.size +
    f.triggerTypes.size +
    f.actionKinds.size +
    f.code.size +
    (f.triggerField.trim() ? 1 : 0)
  );
}

export function hasAnyConstraint(f: UiFilters): boolean {
  return f.query.trim() !== '' || activeFilterCount(f) > 0;
}

// ---------- actions ----------

export interface LocatedAction {
  action: WorkflowAction;
  location: WorkflowActionLocation;
  /** Stable within a rule: addresses the occurrence, independent of object identity. */
  key: string;
  scheduleLabel: string | null;
}

export function locationKey(l: WorkflowActionLocation): string {
  return l.timing === 'instant'
    ? `${l.conditionIndex}:i:${l.actionIndex}`
    : `${l.conditionIndex}:s${l.scheduleIndex}:${l.actionIndex}`;
}

export function listActions(rule: WorkflowRule): LocatedAction[] {
  const out: LocatedAction[] = [];
  rule.conditions.forEach((condition, conditionIndex) => {
    condition.instantActions.forEach((action, actionIndex) => {
      const location: WorkflowActionLocation = {
        timing: 'instant',
        conditionIndex,
        actionIndex,
        actionKind: action.kind,
      };
      out.push({ action, location, key: locationKey(location), scheduleLabel: null });
    });
    condition.scheduledActions.forEach((schedule, scheduleIndex) => {
      schedule.actions.forEach((action, actionIndex) => {
        const location: WorkflowActionLocation = {
          timing: 'scheduled',
          conditionIndex,
          scheduleIndex,
          actionIndex,
          actionKind: action.kind,
        };
        out.push({
          action,
          location,
          key: locationKey(location),
          scheduleLabel: scheduleText(schedule.offset, schedule.label),
        });
      });
    });
  });
  return out;
}

export function actionAt(
  rule: WorkflowRule,
  location: WorkflowActionLocation,
): WorkflowAction | null {
  const condition = rule.conditions[location.conditionIndex];
  if (!condition) return null;
  return location.timing === 'instant'
    ? (condition.instantActions[location.actionIndex] ?? null)
    : (condition.scheduledActions[location.scheduleIndex]?.actions[location.actionIndex] ?? null);
}

function scheduleText(
  offset: { unit: number | string | null; period: string | null } | null,
  label: string,
): string {
  if (offset && (offset.unit !== null || offset.period !== null)) {
    return `${offset.unit ?? ''} ${(offset.period ?? '').replace(/_/g, ' ')}`.trim();
  }
  return label;
}

export type FunctionAction = Extract<WorkflowAction, { kind: 'function' }>;

/** Only an exact join with available source may be handed to the editor. */
export function isOpenableFunction(action: WorkflowAction): action is FunctionAction {
  return (
    action.kind === 'function' &&
    action.joinConfidence === 'exact' &&
    action.sourceState === 'available' &&
    !!action.delugeFunctionId &&
    !!action.sourceText
  );
}

// ---------- text ----------

const COMPARATORS: Readonly<Record<string, string>> = {
  equal: 'is',
  equals: 'is',
  not_equal: 'is not',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  is_empty: 'is empty',
  empty: 'is empty',
  is_not_empty: 'is not empty',
  not_empty: 'is not empty',
  greater_than: '>',
  less_than: '<',
  greater_equal: '≥',
  less_equal: '≤',
  between: 'is between',
};
export function comparatorText(comparator: string): string {
  return COMPARATORS[comparator] ?? comparator.replace(/_/g, ' ');
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string')
    return value.replace(/\$\{!([^}]+)\}/g, (_, path: string) =>
      path
        .split('.')
        .map((part) => part.replace(/_/g, ' '))
        .join(' › '),
    );
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const key of ['display_value', 'name', 'label', 'email', 'api_name', 'value']) {
      if (typeof o[key] === 'string' && o[key]) return formatValue(o[key]);
    }
    // Recipient and assignee wrappers carry nested resources/fields, not display strings.
    for (const key of [
      'details',
      'resource',
      'field',
      'user',
      'users',
      'recipients',
      'email_addresses',
      'channel',
    ]) {
      if (o[key] != null) {
        const label = formatValue(o[key]);
        if (label) return label;
      }
    }
    return Object.entries(o)
      .filter(([key, v]) => v != null && !['id', 'type'].includes(key))
      .map(([key, v]) => `${key.replace(/_/g, ' ')}: ${formatValue(v)}`)
      .join('; ');
  }
  return String(value);
}

export function criteriaLeaves(
  c: WorkflowCriteria | null,
): Array<Extract<WorkflowCriteria, { kind: 'predicate' }>> {
  if (!c) return [];
  if (c.kind === 'predicate') return [c];
  if (c.kind === 'group') return c.children.flatMap(criteriaLeaves);
  return [];
}

export function predicateParts(
  c: Extract<WorkflowCriteria, { kind: 'predicate' }>,
  modified = false,
): { comparator: string; value: string } {
  let comparator = comparatorText(c.comparator),
    value = formatValue(c.value);
  if (
    value === `\${EMPTY}` &&
    ['equal', 'equals', 'not_equal', 'not_equals'].includes(c.comparator)
  ) {
    comparator = c.comparator.startsWith('not_') ? 'is not empty' : 'is empty';
    value = '';
  } else if (value === `\${ANYVALUE}` && c.comparator === `\${ANYVALUE}`) {
    return { comparator: 'is modified to any value', value: '' };
  } else if (value === `\${CLOSEDWON}`) value = 'Closed Won';
  if (modified)
    comparator =
      comparator === 'is not empty'
        ? 'is modified to not empty'
        : comparator === 'is empty'
          ? 'is modified to empty'
          : comparator === 'is'
            ? 'is modified to'
            : `is modified to ${comparator.replace(/^is /, '')}`;
  return { comparator, value };
}
export function predicateText(
  c: Extract<WorkflowCriteria, { kind: 'predicate' }>,
  modified = false,
): string {
  const { comparator, value } = predicateParts(c, modified);
  return `${c.field.label} ${comparator}${value ? ` “${value}”` : ''}`;
}

export function triggerSummary(rule: WorkflowRule): string {
  const t = rule.trigger;
  if (!t) return rule.detailState === 'loaded' ? 'No trigger' : 'Trigger loading…';
  return describeTrigger(t, rule);
}

export function describeTrigger(t: WorkflowTrigger, rule?: WorkflowRule): string {
  switch (t.type) {
    case 'field_update': {
      const leaves = criteriaLeaves(t.criteria);
      if (leaves.length === 0) return 'A field is updated';
      const [first] = leaves;
      return `${predicateText(first, true)}${leaves.length > 1 ? ` +${leaves.length - 1}` : ''}`;
    }
    case 'create':
      return t.triggerModule && rule && t.triggerModule.apiName !== rule.module.apiName
        ? `A ${t.triggerModule.label.replace(/s$/, '')} is added`
        : 'A record is created';
    case 'create_or_edit':
      return 'A record is created or edited';
    case 'edit':
      return 'A record is edited';
    case 'date_or_datetime': {
      const parts = ['Date / time', t.field?.label];
      if (t.offset) parts.push(scheduleText(t.offset, ''));
      if (t.executeAt) parts.push(t.executeAt);
      return parts.filter(Boolean).join(' · ');
    }
    case 'mail_sent':
      return 'An email is sent';
    case 'mail_sent_opened':
      return 'A sent email is opened';
    case 'mail_sent_bounced':
      return 'A sent email bounces';
    case 'email_received':
      return 'An email is received';
    case 'section_update':
      return 'A section is updated';
    case 'incoming_call_createedit':
      return 'An incoming call is created or edited';
    case 'outgoing_call_createedit':
      return 'An outgoing call is created or edited';
    default:
      return `Unrecognized trigger · ${t.rawType}`;
  }
}

export function moduleBadge(rule: WorkflowRule): string {
  return rule.module.label || rule.module.apiName;
}

export function formatModified(value: string | number | undefined): string | null {
  if (value === undefined || value === '') return null;
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  const d = new Date(numeric);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

// ---------- provenance ----------

export interface ProvenanceView {
  where: string;
  ref: string | null;
  snippet: string;
  highlights: readonly HighlightRange[];
  mono: boolean;
}

const PROVENANCE_PRIORITY: Readonly<Record<MatchProvenance['location'], number>> = {
  functionSource: 0,
  emailTemplate: 1,
  webhook: 2,
  action: 3,
  condition: 4,
  trigger: 5,
  ruleDescription: 6,
  ruleName: 99,
};

/** The most informative non-name match, used for the one-line row explanation. */
export function bestProvenance(
  result: WorkflowSearchResult,
  activeKinds: ReadonlySet<WorkflowActionKind> = new Set(),
): MatchProvenance | null {
  const candidates = result.matches.filter((m) => m.location !== 'ruleName');
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) =>
      Number('action' in b && activeKinds.has(b.action.actionKind)) -
        Number('action' in a && activeKinds.has(a.action.actionKind)) ||
      PROVENANCE_PRIORITY[a.location] - PROVENANCE_PRIORITY[b.location],
  )[0];
}

/**
 * The engine's snippets are slices of raw JSON. When a readable one-line summary of the
 * matched item contains the matched text, show that instead; the raw slice is the fallback.
 */
function readable(
  base: { snippet: string; highlights: readonly HighlightRange[] },
  where: string,
  ref: string | null,
  summary: string,
  m: MatchProvenance,
  rawMono = true,
): ProvenanceView {
  const first = m.highlights[0];
  const needle = first ? m.snippet.slice(first.start, first.end).toLowerCase() : '';
  const lower = summary.toLowerCase();
  const at = needle ? lower.indexOf(needle) : -1;
  if (at < 0 || lower.length !== summary.length)
    return cropProvenance({ ...base, where, ref, mono: rawMono });
  const hits: HighlightRange[] = [];
  for (let i = at; i >= 0; i = lower.indexOf(needle, i + needle.length)) {
    hits.push({ start: i, end: i + needle.length });
  }
  return cropProvenance({ where, ref, snippet: summary, highlights: hits, mono: false });
}

function triggerFullText(rule: WorkflowRule): string {
  const t = rule.trigger;
  if (!t) return '';
  if (t.type === 'field_update') {
    const leaves = criteriaLeaves(t.criteria).map((c) => predicateText(c, true));
    if (leaves.length) return leaves.join(' and ');
  }
  return describeTrigger(t, rule);
}

function conditionLeafText(
  rule: WorkflowRule,
  conditionIndex: number,
  path: readonly number[],
  related: boolean,
): string {
  const condition = rule.conditions[conditionIndex];
  let node: WorkflowCriteria | null | undefined = related
    ? condition?.relatedCriteria?.criteria
    : condition?.criteria;
  for (const index of path) node = node?.kind === 'group' ? node.children[index] : null;
  return node?.kind === 'predicate' ? predicateText(node) : '';
}

/** Put the first match near the start so ellipsis cannot hide all highlights. */
function cropProvenance(view: ProvenanceView): ProvenanceView {
  const first = view.highlights[0];
  if (!first) return view;
  const start = first.start > 40 ? first.start - 12 : 0,
    end = Math.max(first.end, start + 140);
  return {
    ...view,
    snippet: view.snippet.slice(start, end),
    highlights: view.highlights
      .filter((r) => r.start >= start && r.end <= end)
      .map((r) => ({ start: r.start - start, end: r.end - start })),
  };
}
export function describeProvenance(rule: WorkflowRule, m: MatchProvenance): ProvenanceView {
  // Length-preserving whitespace collapse keeps highlight offsets valid.
  const snippet = m.snippet.replace(/\s/g, ' ');
  const base = cropProvenance({
    snippet,
    highlights: m.highlights,
    where: '',
    ref: null,
    mono: false,
  });
  switch (m.location) {
    case 'ruleName':
      return { ...base, where: 'Name', ref: null, mono: false };
    case 'ruleDescription':
      return { ...base, where: 'Description', ref: null, mono: false };
    case 'trigger':
      return readable(base, 'Trigger', null, triggerFullText(rule), m);
    case 'condition':
      return readable(
        base,
        m.related ? 'Related condition' : 'Condition',
        `Condition ${m.conditionIndex + 1}`,
        conditionLeafText(rule, m.conditionIndex, m.criteriaPath, m.related),
        m,
      );
    case 'emailTemplate':
      return { ...base, where: 'Email template', ref: actionRef(rule, m.action), mono: false };
    case 'webhook':
    case 'action': {
      const action = actionAt(rule, m.action);
      return readable(
        base,
        m.location === 'webhook' ? 'Webhook' : KIND_LABELS[m.action.actionKind],
        actionRef(rule, m.action),
        action ? actionSummary(action) : '',
        m,
      );
    }
    case 'functionSource':
      return {
        ...base,
        where: 'Function code',
        ref: `${actionRef(rule, m.action) ?? 'function'} · line ${m.lineNumber}`,
        mono: true,
      };
  }
}

/** One readable line describing what an action does; used for row-level match explanations. */
export function actionSummary(a: WorkflowAction): string {
  switch (a.kind) {
    case 'fieldUpdate':
      return `${a.name} · ${a.field?.label ?? ''}${a.field?.apiName && a.field.apiName !== a.field.label ? ` (${a.field.apiName})` : ''} = ${formatValue(a.value)}`;
    case 'task':
      return a.subject ?? a.name;
    case 'emailNotification':
      return (
        [a.template?.name, a.template?.subject, formatValue(a.recipients)]
          .filter(Boolean)
          .join(' · ') || a.name
      );
    case 'webhook':
      return `${a.method ?? ''} ${a.url ?? ''}`.trim() || a.name;
    case 'function':
      return `${a.apiName ?? a.bindingName}(${a.arguments.map((x) => `${x.name} = ${formatValue(x.value)}`).join(', ')})`;
    case 'slack':
      return ['Slack', a.message, formatValue(a.notifyTo)].filter(Boolean).join(' · ');
    case 'assignOwner':
      return `Assign owner: ${formatValue(a.assignTo)}`;
    case 'addTags':
      return a.tags.map((t) => t.name).join(', ');
    case 'convert':
      return a.fieldMappings
        .map((m) => `${m.field.label} = ${formatValue(m.displayValue ?? m.value)}`)
        .join(', ');
    default:
      return a.jsonText;
  }
}

function actionRef(rule: WorkflowRule, location: WorkflowActionLocation): string | null {
  const a = actionAt(rule, location);
  if (!a) return null;
  if (a.kind === 'function') return a.apiName ?? a.bindingName ?? a.name;
  return a.name || null;
}

/** Action occurrences that matched the query, for the detail pane's "Match" flags. */
export function matchedActionKeys(result: WorkflowSearchResult | undefined): Set<string> {
  const keys = new Set<string>();
  for (const m of result?.matches ?? []) {
    if ('action' in m) keys.add(locationKey(m.action));
  }
  return keys;
}

// ---------- search ----------

export interface TriggerFieldOption {
  apiName: string;
  label: string;
}

export function collectTriggerFields(rules: readonly WorkflowRule[]): TriggerFieldOption[] {
  const fields = new Map<string, string>();
  for (const rule of rules) {
    const t = rule.trigger;
    if (!t) continue;
    if (t.type === 'field_update') {
      for (const leaf of criteriaLeaves(t.criteria))
        fields.set(leaf.field.apiName, leaf.field.label);
    } else if (t.type === 'date_or_datetime' && t.field) {
      fields.set(t.field.apiName, t.field.label);
    }
  }
  return [...fields].map(([apiName, label]) => ({ apiName, label }));
}

/** Matches a typed trigger field to real fields; an unmatched entry must yield no results. */
function resolveTriggerFields(text: string, options: readonly TriggerFieldOption[]): string[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return [];
  const hits = options
    .filter(
      (o) => o.apiName.toLowerCase().includes(needle) || o.label.toLowerCase().includes(needle),
    )
    .map((o) => o.apiName);
  return hits.length > 0 ? hits : ['\u0000no-such-field'];
}

export function toWorkflowFilters(
  ui: UiFilters,
  fields: readonly TriggerFieldOption[],
): WorkflowFilters {
  return {
    query: ui.query,
    modules: [...ui.modules],
    active: ui.status.size === 1 ? ([...ui.status][0] as 'active' | 'inactive') : 'all',
    triggerTypes: [...ui.triggerTypes],
    triggerFieldApiNames: resolveTriggerFields(ui.triggerField, fields),
    actionKinds: [...ui.actionKinds],
    functionSource: ui.code.size === 1 ? (ui.code.has('has') ? 'available' : 'unavailable') : 'any',
    scope: ui.scope,
  };
}

export interface UiFacetCounts {
  modules: WorkflowFacetCount[];
  triggerTypes: WorkflowFacetCount<WorkflowTriggerType>[];
  actionKinds: WorkflowFacetCount<WorkflowActionKind>[];
  active: { active: number; inactive: number };
  code: { has: number; missing: number };
}

export interface SearchOutcome {
  results: WorkflowSearchResult[];
  counts: UiFacetCounts;
  triggerFields: TriggerFieldOption[];
}

function sortResults(results: WorkflowSearchResult[], sort: SortKey, hasQuery: boolean): void {
  if (sort === 'relevance' && hasQuery) return; // searchWorkflows already ranks
  const by =
    sort === 'module'
      ? (a: WorkflowSearchResult, b: WorkflowSearchResult) =>
          moduleBadge(a.rule).localeCompare(moduleBadge(b.rule)) ||
          a.rule.name.localeCompare(b.rule.name)
      : sort === 'modified'
        ? (a: WorkflowSearchResult, b: WorkflowSearchResult) =>
            time(b.rule.modifiedTime) - time(a.rule.modifiedTime)
        : (a: WorkflowSearchResult, b: WorkflowSearchResult) =>
            a.rule.name.localeCompare(b.rule.name);
  results.sort(by);
}
function time(v: string | number | undefined): number {
  if (v === undefined) return 0;
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : new Date(v).getTime();
  return Number.isNaN(n) ? 0 : n;
}

export function runSearch(
  snapshot: WorkflowIndexSnapshot,
  ui: UiFilters,
  sort: SortKey,
): SearchOutcome {
  const triggerFields = collectTriggerFields(snapshot.rules);
  const filters = toWorkflowFilters(ui, triggerFields);
  const results = searchWorkflows(snapshot, filters);
  sortResults(results, sort, ui.query.trim() !== '');
  const raw = facetCounts(snapshot, filters);
  const count = (key: 'active' | 'inactive') => raw.active.find((c) => c.key === key)?.count ?? 0;
  return {
    results,
    triggerFields,
    counts: {
      modules: [...raw.modules].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      triggerTypes: raw.triggerTypes
        .filter((c) => c.count > 0 || ui.triggerTypes.has(c.key))
        .map((c) => ({ ...c, label: TRIGGER_LABELS[c.key] ?? c.label }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      actionKinds: KIND_ORDER.map(
        (key) =>
          raw.actionKinds.find((c) => c.key === key) ?? { key, label: KIND_LABELS[key], count: 0 },
      ).map((c) => ({ ...c, label: KIND_LABELS[c.key] })),
      active: { active: count('active'), inactive: count('inactive') },
      code: {
        has: raw.functionSource.find((c) => c.key === 'available')?.count ?? 0,
        missing: raw.functionSource.find((c) => c.key === 'unavailable')?.count ?? 0,
      },
    },
  };
}

// ---------- coverage ----------

export interface CoverageRow {
  key: 'rules' | 'details' | 'actions' | 'templates' | 'sources';
  label: string;
  done: number;
  total: number;
  failed: number;
  /** Totals may still grow (earlier stages have not finished discovering work). */
  provisional: boolean;
  notes: string[];
}

export type IndexStatus =
  | { kind: 'indexing'; percent: number }
  | { kind: 'complete' }
  | { kind: 'gaps'; count: number }
  | { kind: 'failed' }
  | { kind: 'cancelled' };

export interface Coverage {
  refreshing: boolean;
  rows: CoverageRow[];
  status: IndexStatus;
  gaps: number;
  pending: { details: number; actions: number; sources: number };
  failures: readonly WorkflowIndexFailure[];
}

/** Coverage consumes store-owned dependency totals; null means discovery is still open. */
export function computeCoverage(snapshot: WorkflowIndexSnapshot): Coverage {
  const { progress } = snapshot;
  const listed = progress.rulesTotal ?? progress.rulesListed;
  const detailsTotal = progress.ruleDetailsTotal ?? progress.rulesListed;
  const detailsSettled = progress.ruleDetailsLoaded + progress.ruleDetailsFailed;
  const actionsDone = progress.actionResourcesLoaded;
  const failedActions = progress.actionResourcesFailed;
  const templatesDone = progress.templatesLoaded;
  const failedTemplates = progress.templatesFailed;
  const actionTotal = progress.actionResourcesTotal ?? actionsDone + failedActions;
  const templateTotal = progress.templatesTotal ?? templatesDone + failedTemplates;
  const sourceAvailable = progress.functionSourcesAvailable;
  const sourceSettled =
    sourceAvailable +
    progress.functionSourcesUnavailable +
    progress.functionSourcesUncertain +
    progress.functionSourcesFailed;
  const sourceTotal = progress.functionSourcesTotal ?? sourceSettled;
  const sourcesPending = Math.max(0, sourceTotal - sourceSettled);
  const cachedSettled =
    progress.refreshing &&
    [
      progress.rulesTotal,
      progress.ruleDetailsTotal,
      progress.actionResourcesTotal,
      progress.templatesTotal,
      progress.functionSourcesTotal,
    ].every((total) => total !== null) &&
    detailsSettled >= detailsTotal &&
    actionsDone + failedActions >= actionTotal &&
    templatesDone + failedTemplates >= templateTotal &&
    sourceSettled >= sourceTotal;
  const finished = progress.phase === 'complete' || cachedSettled;
  const more = ['More will appear as dependencies load'];

  const rows: CoverageRow[] = [
    {
      key: 'rules',
      label: 'Rules',
      done: progress.rulesListed,
      total: listed,
      failed: 0,
      provisional: progress.rulesTotal === null,
      notes: [],
    },
    {
      key: 'details',
      label: 'Rule details',
      done: progress.ruleDetailsLoaded,
      total: detailsTotal,
      failed: progress.ruleDetailsFailed,
      provisional: progress.ruleDetailsTotal === null,
      notes: progress.ruleDetailsFailed ? [`${progress.ruleDetailsFailed} failed to load`] : [],
    },
    {
      key: 'actions',
      label: 'Actions',
      done: actionsDone,
      total: actionTotal,
      failed: failedActions,
      provisional: progress.actionResourcesTotal === null,
      notes: [
        ...(failedActions ? [`${failedActions} failed to load`] : []),
        ...(progress.actionResourcesTotal === null ? more : []),
      ],
    },
    {
      key: 'templates',
      label: 'Email templates',
      done: templatesDone,
      total: templateTotal,
      failed: failedTemplates,
      provisional: progress.templatesTotal === null,
      notes: [
        ...(failedTemplates ? [`${failedTemplates} failed to load`] : []),
        ...(progress.templatesTotal === null ? more : []),
      ],
    },
    {
      key: 'sources',
      label: 'Function sources',
      done: sourceAvailable,
      total: sourceTotal,
      failed: progress.functionSourcesFailed,
      provisional: progress.functionSourcesTotal === null,
      notes: [
        ...(progress.functionSourcesFailed
          ? [`${progress.functionSourcesFailed} failed to load (retryable)`]
          : []),
        progress.functionSourcesUnavailable
          ? `${progress.functionSourcesUnavailable} unavailable (source missing or no exact match)`
          : '',
        progress.functionSourcesUncertain
          ? `${progress.functionSourcesUncertain} uncertain (matched by name only)`
          : '',
        ...(progress.functionSourcesTotal === null ? more : []),
      ].filter(Boolean),
    },
  ];

  const gaps =
    progress.failures.length +
    progress.functionSourcesUnavailable +
    progress.functionSourcesUncertain;
  const settledFraction = (done: number, failed: number, total: number) =>
    total === 0 ? 1 : Math.min(1, (done + failed) / total);
  // Later stages cannot be further along than the stage that feeds them.
  const detailsFraction = settledFraction(
    progress.ruleDetailsLoaded,
    progress.ruleDetailsFailed,
    detailsTotal,
  );
  const actionsFraction = Math.min(
    detailsFraction,
    progress.actionResourcesTotal === null
      ? 0
      : settledFraction(actionsDone, failedActions, actionTotal),
  );
  const templatesFraction = Math.min(
    actionsFraction,
    progress.templatesTotal === null
      ? 0
      : settledFraction(templatesDone, failedTemplates, templateTotal),
  );
  const sourcesFraction = Math.min(
    actionsFraction,
    progress.functionSourcesTotal === null ? 0 : settledFraction(sourceSettled, 0, sourceTotal),
  );
  const percent = Math.round(
    100 *
      (detailsFraction * 0.4 +
        actionsFraction * 0.3 +
        templatesFraction * 0.1 +
        sourcesFraction * 0.2),
  );
  let status: IndexStatus;
  if (progress.phase === 'failed') status = { kind: 'failed' };
  else if (progress.phase === 'cancelled') status = { kind: 'cancelled' };
  else if (finished && gaps === 0) status = { kind: 'complete' };
  else if (finished) status = { kind: 'gaps', count: gaps };
  else
    status = { kind: 'indexing', percent: Math.min(99, Math.max(listed === 0 ? 0 : 2, percent)) };

  return {
    refreshing: !!progress.refreshing,
    rows,
    status,
    gaps,
    failures: progress.failures,
    pending: {
      details: Math.max(0, detailsTotal - detailsSettled),
      actions: Math.max(0, actionTotal - actionsDone - failedActions),
      sources: sourcesPending,
    },
  };
}

/** The failure that explains an action's missing configuration, if the store reported one. */
export function failureFor(
  rule: WorkflowRule,
  action: WorkflowAction,
  failures: readonly WorkflowIndexFailure[],
): WorkflowIndexFailure | null {
  return (
    failures.find((f) => {
      if (!rule.failureIds.includes(f.id) && !f.ruleIds.includes(rule.id)) return false;
      const t = f.target;
      if (t.kind === 'actionResource')
        return t.actionKind === action.kind && t.resourceId === action.id;
      if (t.kind === 'template')
        return action.kind === 'emailNotification' && action.template?.id === t.templateId;
      if (t.kind === 'functionSource')
        return action.kind === 'function' && action.delugeFunctionId === t.delugeFunctionId;
      return false;
    }) ?? null
  );
}

// Rule identity is the store's revision contract. Status-only signatures miss changes
// to metadata labels, criteria values, templates and code during revalidation.
const detailRevisions = new WeakMap<WorkflowRule, number>();
let detailRevision = 0;
export function detailSignature(rule: WorkflowRule): string {
  let revision = detailRevisions.get(rule);
  if (revision === undefined) {
    revision = ++detailRevision;
    detailRevisions.set(rule, revision);
  }
  return String(revision);
}
