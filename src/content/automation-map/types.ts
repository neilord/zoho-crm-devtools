/**
 * Frozen contract between the Automation Map data layer (store + graph builder) and its UI.
 *
 * The graph is local-only, built from Zoho same-origin reads and the Deluge effects analyzer.
 * Snapshots and every nested value are owned by the store; consumers never mutate them.
 * Inferred edges describe *possible* behavior and never claim completeness (ADR 0026).
 */

import type { ZohoFunctionSummary } from '../functions/types';
import type {
  WorkflowAction,
  WorkflowActionLocation,
  WorkflowIndexFailure,
  WorkflowRule,
  WorkflowTriggerType,
} from '../workflows/types';
import type { FunctionEffects } from './analyzer';

/**
 * Stable, namespaced node ids. Zoho id namespaces never mix (ADR 0024):
 * `module:<api>`, `field:<module api>.<field api>`, `field:<module api>.*` (unknown fields of a
 * known module), `field:*.*` (unknown module), `rule:<rule id>`,
 * `action:<rule id>/<condition>/<i|s<schedule>>/<action>`, `template:<id>`,
 * `function:<deluge catalogue id>`, `button:<id>`, `schedule:<id>`, `transition:<blueprint id>/<id>`,
 * `approval:<id>`, `external:<kind>:<key>`. Action ids nest under their owner's id.
 */
export type MapNodeId = string;

export type MapNodeKind =
  | 'module'
  | 'field'
  | 'rule'
  | 'action'
  | 'template'
  | 'function'
  | 'button'
  | 'schedule'
  | 'transition'
  | 'approval'
  | 'external';

/** Ways automation starts. A function can be several at once (button + API + rule action). */
export type EntryKind = 'rule' | 'button' | 'schedule' | 'restApi' | 'transition' | 'approval';

interface NodeBase<K extends MapNodeKind> {
  id: MapNodeId;
  kind: K;
  label: string;
  /** Home island; null for org-level nodes (shared functions, externals, unknown-module bucket). */
  moduleApiName: string | null;
  /** null = unknown. Rules: status.active. Functions: reachable from an active entry point. */
  active: boolean | null;
  /** Precomputed membership of the default "Active automation" scope. */
  inActiveScope: boolean;
}

export interface ModuleNode extends NodeBase<'module'> {
  apiName: string;
  counts: {
    rules: number;
    activeRules: number;
    buttons: number;
    schedules: number;
    functions: number;
    fieldsWritten: number;
  };
}

export interface FieldNode extends NodeBase<'field'> {
  /** '*' for the unknown-fields bucket of a module; module is '*' for the unknown-module bucket. */
  fieldApiName: string;
  /** False when the label was not confirmed by fields metadata (API name shown instead). */
  labelConfirmed: boolean;
  bucket: 'field' | 'unknownFields' | 'unknownModule';
}

export interface RuleNode extends NodeBase<'rule'> {
  ruleId: string;
  triggerType: WorkflowTriggerType | null;
  /** Field API names a field-update trigger watches, when known. */
  watchedFields: readonly string[];
  /** Store-owned normalized rule for the inspector (criteria, schedules, raw). */
  rule: WorkflowRule;
}

export interface ActionNode extends NodeBase<'action'> {
  /** The rule, blueprint transition or approval that runs this action occurrence. */
  ownerId: MapNodeId;
  /** Present for workflow-rule occurrences only. */
  location: WorkflowActionLocation | null;
  /** Human schedule text for scheduled actions, e.g. "2 days after Closing Date". */
  timingLabel: string | null;
  action: WorkflowAction;
}

export interface TemplateNode extends NodeBase<'template'> {
  templateId: string;
  subject: string | null;
}

export type FunctionAnalysisState =
  | 'pending'
  | 'analyzed'
  | 'limited'
  | 'unsupported'
  | 'source-unavailable'
  | 'failed';

export interface FunctionNode extends NodeBase<'function'> {
  delugeId: string;
  apiName: string | null;
  category: string | null;
  /** Entry kinds that reach this function directly (button, schedule, restApi, rule). */
  entryKinds: readonly EntryKind[];
  /** REST API exposure from the catalogue (API key and/or OAuth), when enabled. */
  restApi: { apiKey: boolean; oauth: boolean } | null;
  analysis: FunctionAnalysisState;
  /** Null until source is available and analyzed. */
  effects: FunctionEffects | null;
  /** Number of distinct callers (rules, buttons, schedules, functions); drives hub collapse. */
  inDegree: number;
  summary: ZohoFunctionSummary;
}

export interface ButtonNode extends NodeBase<'button'> {
  buttonId: string;
  /** Zoho placement values as observed (e.g. detail page, list view); never guessed. */
  placements: readonly string[];
  actionType: string;
  raw: unknown;
}

export interface ScheduleNode extends NodeBase<'schedule'> {
  scheduleId: string;
  /** Human recurrence text, or null when Zoho's shape is not understood. */
  recurrenceLabel: string | null;
  raw: unknown;
}

/** A blueprint transition: user-driven, runs field updates/tasks and collects during-inputs. */
export interface TransitionNode extends NodeBase<'transition'> {
  blueprintId: string;
  blueprintName: string;
  transitionId: string;
  /** Field API names the user fills in during the transition (declared writes). */
  duringInputFields: readonly string[];
  raw: unknown;
}

export interface ApprovalNode extends NodeBase<'approval'> {
  approvalId: string;
  raw: unknown;
}

export interface ExternalNode extends NodeBase<'external'> {
  externalKind: 'webhookHost' | 'urlHost' | 'connection' | 'zohoService' | 'email';
  /** Host, connection name, or service name (e.g. books). Configuration data, never contacted. */
  key: string;
}

export type MapNode =
  | ModuleNode
  | FieldNode
  | RuleNode
  | ActionNode
  | TemplateNode
  | FunctionNode
  | ButtonNode
  | ScheduleNode
  | TransitionNode
  | ApprovalNode
  | ExternalNode;

/**
 * - `starts`: entry point (button/schedule) → function; rule/transition/approval → action.
 * - `invokes`: function action → function; function → function (code call).
 * - `uses`: email notification → template.
 * - `writes`: field-update/task/convert action → field; transition during-input → field;
 *   function → field (inferred).
 * - `calls`: webhook action / function → external.
 * - `reacts`: field → rule (field-update trigger or criteria reference).
 * - `cascades`: a write whose trigger policy may re-fire workflows → rule on that module.
 */
export type MapEdgeKind =
  | 'starts'
  | 'invokes'
  | 'uses'
  | 'writes'
  | 'calls'
  | 'reacts'
  | 'cascades';

/** declared = configuration says so; inferred = code analysis; unresolved = dynamic/unknown. */
export type EdgeEvidence = 'declared' | 'inferred' | 'unresolved';

export type WriteOperation =
  | 'update'
  | 'create'
  | 'upsert'
  | 'delete'
  | 'relate'
  | 'attach'
  | 'convert'
  | 'other';

/** Offsets are zero-based UTF-16, end-exclusive, into the function's source text. */
export interface SourceSpan {
  start: number;
  end: number;
  /** One-based line of `start`. */
  line: number;
}

export interface MapEdge {
  id: string;
  kind: MapEdgeKind;
  from: MapNodeId;
  to: MapNodeId;
  evidence: EdgeEvidence;
  /** Analyzer confidence for inferred edges; null for declared edges. */
  confidence: 'exact' | 'partial' | 'unknown' | null;
  operation?: WriteOperation;
  /** False for record mutations that set no field values (including unknown-module effects). */
  setsFields?: boolean;
  /** Requested trigger list on the write, as captured (e.g. ['workflow']); null = default/unknown. */
  triggers?: readonly string[] | null;
  /** Evidence locations in the `from` function's source, for inferred edges. */
  spans?: readonly SourceSpan[];
  /**
   * Inferred writes only: whether the write targets this org. A connection to an unknown org
   * never counts as an exact local writer and never creates local cascades.
   */
  destinationScope?: 'current-org' | 'connection-org-unknown' | 'unknown';
  /** Subform row writes land on the subform field node; this is the row field path. */
  subformPath?: readonly string[];
  /** True when both endpoints are in the default active scope. */
  inActiveScope: boolean;
  /** Short reason shown in the edge tooltip, e.g. "zoho.crm.updateRecord · line 42". */
  note?: string;
}

export interface MapCoverage {
  /** Distinct module inventory (metadata plus listed rules), excluding source-only graph islands. */
  modules?: number;
  /** True while dependency discovery/analysis can still change gaps. Announce ready only when false. */
  gapsProvisional?: boolean;
  rules: { listed: number; detailed: number; failed: number; total: number | null };
  functions: {
    listed: number;
    analyzed: number;
    limited: number;
    unsupported: number;
    sourceUnavailable: number;
    pending: number;
    failed: number;
  };
  buttons: { loaded: number; failed: number; unsupported?: number; state: CoverageState };
  schedules: { loaded: number; failed: number; unsupported?: number; state: CoverageState };
  blueprints: { loaded: number; failed: number; unsupported?: number; state: CoverageState };
  approvals: { loaded: number; failed: number; unsupported?: number; state: CoverageState };
  /**
   * The one gap count every surface shows (chip, banner, live region, field lens): unique failed
   * dependencies plus functions whose analysis is not complete. Computed by the store only.
   */
  gaps: number;
  /** Last settled dependency revalidation pass, including retryable failures and analysis gaps. */
  lastRevalidatedAt?: number | null;
  /** True only when every discovered dependency settled without failures or gaps. */
  isComplete: boolean;
  /** Cached data shown while a background revalidation runs. */
  refreshing: boolean;
  failures: readonly MapFailure[];
}

export type CoverageState = 'not-requested' | 'loading' | 'loaded' | 'failed' | 'unsupported';

export interface MapFailure {
  id: string;
  /** Sanitized display text; no transport errors or credentials. */
  message: string;
  retry(): Promise<void>;
  /** Present when the failure came from the composed workflow index. */
  workflow?: WorkflowIndexFailure;
}

export interface AutomationGraph {
  nodes: ReadonlyMap<MapNodeId, MapNode>;
  edges: readonly MapEdge[];
  outgoing: ReadonlyMap<MapNodeId, readonly MapEdge[]>;
  incoming: ReadonlyMap<MapNodeId, readonly MapEdge[]>;
  /** Module nodes sorted by automation volume (descending), then label. */
  modules: readonly ModuleNode[];
}

/** Access level decides what the store loads and what the UI may render (ADR 0026). */
export type MapAccess =
  | { level: 'checking' }
  | { level: 'full' }
  /** Non-Pro teaser: metadata-only silhouettes, plus one revealed island. */
  | { level: 'teaser'; revealedModuleApiName: string | null; reason: TeaserReason };

export type TeaserReason = 'signed-out' | 'free' | 'lower-plan' | 'unavailable';

export interface AutomationMapSnapshot {
  access: MapAccess;
  /** Full graph with full access; only the revealed island's subgraph in teaser mode. */
  graph: AutomationGraph;
  /** Present only in teaser mode. */
  teaser: TeaserFog | null;
  coverage: MapCoverage;
  phase: 'idle' | 'loading' | 'enriching' | 'complete' | 'failed' | 'cancelled';
}

/**
 * Teaser silhouettes for fogged islands: shape and counts only. By construction this carries
 * no names, labels, criteria, code or ids, so fogged DOM cannot leak configuration.
 */
export interface FoggedIsland {
  /** Opaque, per-snapshot index; not a Zoho id or module API name. */
  slot: number;
  counts: { rules: number; functions: number; buttons: number; schedules: number };
  /** CRM write call sites from `tasks.integrations`, once per distinct catalogue function in this
   * module (regardless of association count); no source read. */
  recordWrites: number;
}

export interface TeaserFog {
  /** Inventory modules without list-visible automation, omitted from fogged islands. */
  quietModules?: number;
  fogged: readonly FoggedIsland[];
  totals: { rules: number; functions: number; modules: number };
}

/* ---------- Pure queries (implemented in graph-queries.ts / search.ts; UI calls these) ---------- */

/** `fieldWriters(graph, moduleApiName, fieldApiName): FieldLens` */
export interface FieldLens {
  /** Write source → selectable entity: actions use their owning rule/transition/approval. */
  writerEntityIds?: ReadonlyMap<MapNodeId, MapNodeId>;
  field: FieldNode | null;
  /** Writes naming this exact field (declared and inferred-exact). */
  writers: readonly MapEdge[];
  /** Writes to this module whose field set is unknown or partial ("may write"). */
  possibleWriters: readonly MapEdge[];
  /** Writes whose module could not be resolved ("might affect any module"). */
  unresolvedWriters: readonly MapEdge[];
  /**
   * Changes to this module's records that set no field values (delete, relate, attach, tags).
   * Never listed as field writers.
   */
  otherRecordChanges: readonly MapEdge[];
  /** Rules that react to this field (field-update triggers, criteria references). */
  reactors: readonly MapEdge[];
  /** Functions whose analysis is not complete, so the answer may be missing writers. */
  coverageGaps: number;
}

/** `traceFrom(graph, nodeId, options): TraceResult` — breadth-first, visited-set, no path enumeration. */
export interface TraceOptions {
  upstream: number;
  downstream: number;
  /** Hard cap; excess frontier nodes are counted in `truncated`. */
  maxNodes: number;
  includeInactive: boolean;
}

export interface TraceResult {
  rootId: MapNodeId;
  nodeIds: ReadonlySet<MapNodeId>;
  edges: readonly MapEdge[];
  /** Layer per node: negative upstream, 0 root, positive downstream. Nearest side wins; ties go downstream. */
  depth: ReadonlyMap<MapNodeId, number>;
  truncated: { upstream: number; downstream: number };
}

export interface MapFilters {
  scope: 'active' | 'everything';
  /** Empty = all modules. */
  modules: ReadonlySet<string>;
  kinds: ReadonlySet<MapNodeKind>;
  triggerTypes: ReadonlySet<WorkflowTriggerType>;
  flags: ReadonlySet<'writesFields' | 'callsExternal' | 'cascades' | 'restApi' | 'gaps'>;
}

/** `searchMap(index, query, filters): readonly SearchHit[]`, ranked; index built once per graph. */
export interface SearchHit {
  nodeId: MapNodeId;
  score: number;
  /** Where the text matched; `line` is one-based for function source. */
  matches: readonly {
    location: 'name' | 'apiName' | 'criteria' | 'value' | 'template' | 'url' | 'source';
    snippet: string;
    highlights: readonly { start: number; end: number }[];
    line?: number;
  }[];
}

/* ---------- Graph builder input (store → pure `buildAutomationGraph(inputs): AutomationGraph`) ---------- */

/** Catalogue `associated_place[]` entry, normalized. Ids are strings (19-digit ids patched pre-parse). */
export interface AssociatedPlaceInput {
  type: 'workflow_rules' | 'custom_buttons' | 'schedules' | 'approvals' | 'related_list' | string;
  id: string | null;
  /** Zoho reports the module's plural label here, not its API name; resolve via modules. */
  modulePluralLabel: string | null;
  raw: unknown;
}

export interface FunctionInput {
  summary: ZohoFunctionSummary;
  /** Catalogue id (Deluge namespace). */
  delugeId: string;
  places: readonly AssociatedPlaceInput[];
  sourceState: 'pending' | 'available' | 'unavailable' | 'failed';
  /** Present only when available; used for code search and evidence display. */
  sourceText: string | null;
  effects: FunctionEffects | null;
}

export interface ButtonInput {
  id: string;
  name: string;
  moduleApiName: string;
  placements: readonly string[];
  /** Observed: custom_function, url, cscript. Unknown values are preserved. */
  actionType: string;
  /** Catalogue id from `details.custom_function.id` (Deluge namespace) when actionType is a function. */
  functionDelugeId: string | null;
  raw: unknown;
}

export interface ScheduleInput {
  id: string;
  name: string;
  active: boolean | null;
  recurrenceLabel: string | null;
  /** Schedule `function.id` is NOT a catalogue id; join by API name or reverse place. */
  functionApiName: string | null;
  raw: unknown;
}

export interface TransitionInput {
  blueprintId: string;
  blueprintName: string;
  blueprintActive: boolean | null;
  moduleApiName: string;
  transitionId: string;
  name: string;
  duringInputFields: readonly string[];
  /** Normalized with the workflow action normalizer (field_updates, tasks, …). */
  actions: readonly WorkflowAction[];
  raw: unknown;
}

export interface ApprovalInput {
  id: string;
  name: string;
  moduleApiName: string;
  active: boolean | null;
  actions: readonly WorkflowAction[];
  raw: unknown;
}

export interface ModuleInput {
  apiName: string;
  label: string;
  pluralLabel: string | null;
}

export interface AutomationGraphInputs {
  modules: readonly ModuleInput[];
  /** Field metadata by module API name; missing modules fall back to API names (unconfirmed). */
  fields: ReadonlyMap<string, readonly { apiName: string; label: string }[]>;
  rules: readonly WorkflowRule[];
  functions: readonly FunctionInput[];
  buttons: readonly ButtonInput[];
  schedules: readonly ScheduleInput[];
  transitions: readonly TransitionInput[];
  approvals: readonly ApprovalInput[];
}
