/**
 * Normalized, local-only workflow graph consumed by the dashboard.
 * IDs stay strings. `raw` preserves the original payload (including unknown keys),
 * never rendered as HTML. Null means absent/not yet known, not an empty success.
 */
export interface WorkflowModule {
  id?: string;
  apiName: string;
  /** Exact metadata label, or the API name until metadata is available. */
  label: string;
}

export interface WorkflowField {
  id?: string;
  apiName: string;
  label: string;
}

export type WorkflowLoadState = 'not-requested' | 'loading' | 'loaded' | 'failed';

/** Recursive criteria preserve grouping, merge expressions and non-scalar values. */
export type WorkflowCriteria =
  | { kind: 'group'; operator: 'AND' | 'OR'; children: readonly WorkflowCriteria[]; raw: unknown }
  | {
      kind: 'predicate';
      field: WorkflowField;
      comparator: string;
      value: unknown;
      /** Wire `type`, e.g. value; expressions must not be evaluated. */
      valueType?: string;
      raw: unknown;
    }
  | { kind: 'unknown'; jsonText: string; raw: unknown };

export type WorkflowTriggerType =
  | 'field_update'
  | 'create'
  | 'create_or_edit'
  | 'edit'
  | 'date_or_datetime'
  | 'mail_sent'
  | 'mail_sent_opened'
  | 'mail_sent_bounced'
  | 'email_received'
  | 'section_update'
  | 'incoming_call_createedit'
  | 'outgoing_call_createedit'
  | 'unknown';

interface TriggerBase {
  /** Can differ from the rule module (e.g. a related Notes creation). */
  triggerModule: WorkflowModule | null;
  repeat: boolean | null;
  raw: unknown;
}

export type WorkflowTrigger = TriggerBase &
  (
    | { type: 'field_update'; criteria: WorkflowCriteria | null; matchAll: boolean | null }
    | {
        type: 'date_or_datetime';
        field: WorkflowField | null;
        offset: WorkflowOffset | null;
        recurrence: string | null;
        executeAt: string | null;
      }
    | { type: 'section_update'; sectionIds: readonly string[] }
    | {
        type: Exclude<
          WorkflowTriggerType,
          'field_update' | 'date_or_datetime' | 'section_update' | 'unknown'
        >;
      }
    | { type: 'unknown'; rawType: string; jsonText: string }
  );

/** Preserve period codes such as b_days; their semantics are not inferred. */
export interface WorkflowOffset {
  unit: number | string | null;
  period: string | null;
  raw: unknown;
}

export interface WorkflowFieldMapping {
  field: WorkflowField;
  type: string | null;
  value: unknown;
  displayValue: unknown;
  raw: unknown;
}

export interface WorkflowEmailTemplate {
  id: string;
  name: string;
  subject: string | null;
  /** Plain text extracted from content/mail_content; never executable HTML. */
  bodyText: string | null;
  state: WorkflowLoadState;
  raw: unknown;
}

/** Function arguments are named bindings, unlike task/convert field mappings. */
export interface WorkflowFunctionArgument {
  name: string;
  type: string | null;
  value: unknown;
  raw: unknown;
}

export type FunctionJoinConfidence = 'exact' | 'uncertain' | 'none';
export type FunctionSourceState = 'loading' | 'available' | 'unavailable' | 'not-requested';

interface ActionBase {
  /** Workflow action resource/binding id, NOT a CRM or Deluge function id. */
  id: string | null;
  name: string;
  module: WorkflowModule | null;
  state: WorkflowLoadState;
  /** Original occurrence and separately fetched resource, when present. */
  raw: unknown;
  resourceRaw?: unknown;
}

/** Each occurrence remains in its condition/schedule even when resources are shared. */
export type WorkflowAction = ActionBase &
  (
    | {
        kind: 'fieldUpdate';
        field: WorkflowField | null;
        value: unknown;
        valueType: string | null;
        relatedModule: WorkflowModule | null;
      }
    | { kind: 'task'; subject: string | null; fieldMappings: readonly WorkflowFieldMapping[] }
    | { kind: 'emailNotification'; template: WorkflowEmailTemplate | null; recipients: unknown }
    | { kind: 'webhook'; url: string | null; method: string | null }
    | {
        kind: 'function';
        bindingName: string;
        apiName: string | null;
        crmFunctionId: string | null;
        /** Unique catalogue candidate; uncertain candidates must be labelled in UI. */
        delugeFunctionId: string | null;
        joinConfidence: FunctionJoinConfidence;
        sourceState: FunctionSourceState;
        /** Null unless source is available; HTTP 200 alone does not imply availability. */
        sourceText: string | null;
        arguments: readonly WorkflowFunctionArgument[];
      }
    | { kind: 'slack'; message: string | null; notifyTo: unknown }
    | { kind: 'assignOwner'; assignTo: readonly unknown[]; configuration: unknown }
    | {
        kind: 'addTags';
        tags: readonly { id?: string; name: string; colorCode?: string }[];
        overwrite: boolean | null;
      }
    | { kind: 'convert'; fieldMappings: readonly WorkflowFieldMapping[]; configuration: unknown }
    | { kind: 'unknown'; rawType: string; jsonText: string }
  );

export type WorkflowActionKind = WorkflowAction['kind'];

export interface WorkflowScheduledActions {
  id: string | null;
  offset: WorkflowOffset | null;
  /** Human-readable schedule; preserve full field-relative execute_after in raw. */
  label: string;
  actions: readonly WorkflowAction[];
  raw: unknown;
}

export interface WorkflowCondition {
  id: string | null;
  sequenceNumber: number | null;
  /** Null criteria can mean an unconditional branch once detail has loaded. */
  criteria: WorkflowCriteria | null;
  relatedCriteria: {
    module: WorkflowModule | null;
    moduleSelection: unknown;
    criteria: WorkflowCriteria | null;
    raw: unknown;
  } | null;
  instantActions: readonly WorkflowAction[];
  scheduledActions: readonly WorkflowScheduledActions[];
  raw: unknown;
}

export interface WorkflowRule {
  id: string;
  name: string;
  description: string;
  module: WorkflowModule;
  /** From status.active, independent of category (drafts can be active). */
  active: boolean | null;
  deprecated: boolean | null;
  category: string | null;
  createdBy?: string | { id?: string; name?: string; raw: unknown };
  modifiedTime?: string | number;
  trigger: WorkflowTrigger | null;
  conditions: readonly WorkflowCondition[];
  detailState: WorkflowLoadState;
  enrichmentState: WorkflowLoadState;
  /** Handles into progress.failures; shared failures may affect several rules. */
  failureIds: readonly string[];
  raw: unknown;
  detailRaw?: unknown;
}

export type WorkflowFailureTarget =
  | { kind: 'list' }
  | { kind: 'ruleDetail'; ruleId: string }
  | { kind: 'actionResource'; actionKind: WorkflowActionKind; resourceId: string }
  | { kind: 'template'; templateId: string }
  | { kind: 'functionSource'; delugeFunctionId: string }
  | { kind: 'metadata'; moduleApiName: string }
  | { kind: 'functionCatalogue' };

export interface WorkflowIndexFailure {
  id: string;
  target: WorkflowFailureTarget;
  ruleIds: readonly string[];
  /** Sanitized display text; no transport error/credentials. */
  message: string;
  /** Retry just this dependency, updating every affected occurrence. */
  retry(): Promise<void>;
}

export interface WorkflowIndexProgress {
  phase:
    | 'idle'
    | 'listing'
    | 'details'
    | 'actions'
    | 'templates'
    | 'sources'
    | 'complete'
    | 'failed'
    | 'cancelled';
  /** Cached presence is independent of in-flight freshness checks. */
  refreshing?: boolean;
  /** Expected unique dependency counts; null until discovery for that stage finishes. */
  rulesTotal: number | null;
  ruleDetailsTotal: number | null;
  actionResourcesTotal: number | null;
  templatesTotal: number | null;
  functionSourcesTotal: number | null;
  functionSourcesFailed: number;
  rulesListed: number;
  ruleDetailsLoaded: number;
  ruleDetailsFailed: number;
  /** Resource/template/source counts are unique dependencies, not occurrences. */
  actionResourcesLoaded: number;
  actionResourcesFailed: number;
  templatesLoaded: number;
  templatesFailed: number;
  functionSourcesAvailable: number;
  functionSourcesUnavailable: number;
  /** Unique bindings whose name-only join is tentative; not available source. */
  functionSourcesUncertain: number;
  /** True only after all discovered work settles without failures or coverage gaps. */
  isComplete: boolean;
  failures: readonly WorkflowIndexFailure[];
}

/** Snapshots and their nested values are owned by the store; consumers never mutate them. */
export interface WorkflowIndexSnapshot {
  rules: readonly WorkflowRule[];
  progress: WorkflowIndexProgress;
}

/** Stable occurrence address; indexes refer to the rule's normalized arrays. */
export type WorkflowActionLocation = {
  conditionIndex: number;
  actionIndex: number;
  actionKind: WorkflowActionKind;
} & ({ timing: 'instant' } | { timing: 'scheduled'; scheduleIndex: number });

/** Offsets are zero-based UTF-16, end-exclusive, relative to the returned snippet. */
export interface HighlightRange {
  start: number;
  end: number;
}

export type MatchProvenance = {
  snippet: string;
  highlights: readonly HighlightRange[];
} & (
  | { location: 'ruleName' | 'ruleDescription' | 'trigger' }
  | {
      location: 'condition';
      conditionIndex: number;
      criteriaPath: readonly number[];
      related: boolean;
    }
  | { location: 'action' | 'emailTemplate' | 'webhook'; action: WorkflowActionLocation }
  | {
      location: 'functionSource';
      action: WorkflowActionLocation;
      /** One-based source line containing the match. */
      lineNumber: number;
    }
);
