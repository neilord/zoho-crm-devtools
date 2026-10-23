/** Confidence describes static extraction, never execution or API acceptance. */
export type Confidence = 'exact' | 'partial' | 'unknown';
/** Resource mutations need not have an ordinary record field set. */
export type FieldsConfidence = Confidence | 'not-applicable';
/** Zero-based UTF-16 offsets in the supplied source; end is exclusive. */
export interface SourceSpan {
  start: number;
  end: number;
}
/** A static API-name candidate, without retaining its source expression. */
export interface NameFact {
  value: string | null;
  candidates: string[];
  confidence: Confidence;
  origin: 'literal' | 'propagated' | 'branch-union' | 'dynamic';
  span: SourceSpan;
  evidence: SourceSpan[];
}
/** Field candidates remain unverified until a separate schema layer validates them. */
export interface FieldFact {
  apiName: string;
  path: string[];
  domain: 'record' | 'subform' | 'relationship';
  confidence: Confidence;
  schema: 'unverified';
  evidence: SourceSpan[];
}
/** Only registered positional roles and named block keys identify connections. */
export interface ConnectionUse {
  id: string;
  name: NameFact;
  via: 'named-block-key' | 'positional-task';
  span: SourceSpan;
}
/** Requested automation is data; graph-level eligibility/suppression is not analyzed. */
export interface TriggerPolicy {
  mode: 'explicit' | 'explicit-empty' | 'documented-default' | 'unknown' | 'not-applicable';
  requested: string[] | null;
  documentedDefault: string[] | null;
  confidence: Confidence;
  workflow: 'possible' | 'not-requested' | 'unknown';
  mechanism: 'native-options' | 'rest-trigger' | 'wf_trigger' | 'unknown';
  sourceUrls: string[];
  span?: SourceSpan;
  reasons: string[];
}
/** Control context records possible execution without evaluating predicates. */
export interface EffectContext {
  kind: 'branch' | 'loop' | 'catch' | 'finally';
  span: SourceSpan;
}
/** Shared evidence for one syntactic effect site. IDs are local to this source revision. */
export interface EffectBase {
  id: string;
  certainty: 'possible';
  confidence: Confidence;
  recognition: 'registered' | 'candidate';
  span: SourceSpan;
  calleeSpan: SourceSpan;
  contexts: EffectContext[];
  reasons: string[];
}
/** Symbolic selector provenance. Actual record IDs are never retained. */
export interface RecordTarget {
  kind: 'parameter' | 'input-parameter' | 'read-derived' | 'literal' | 'dynamic' | 'new-record';
  parameter?: string;
  /** True only for the parameter itself (safe casts/aliases retain parameter provenance). */
  directParameter: boolean;
  confidence: Confidence;
  span: SourceSpan;
}
/** A possible CRM mutation; related resources are distinct from record fields. */
export interface WriteEffect extends EffectBase {
  op:
    | 'create'
    | 'update'
    | 'bulk-create'
    | 'bulk-update'
    | 'update-related'
    | 'upsert'
    | 'delete'
    | 'attach'
    | 'add-tags'
    | 'remove-tags'
    | 'convert'
    | 'crm-mutation';
  via: 'integration-task' | 'connector' | 'invokeurl' | 'invokeapi';
  apiVersion: string | null;
  module: NameFact;
  moduleConfidence: Confidence;
  parentModule?: NameFact;
  resource: 'record' | 'relationship' | 'attachment' | 'tags' | 'conversion';
  target: RecordTarget;
  fields: FieldFact[];
  fieldsConfidence: FieldsConfidence;
  unknownFields: boolean;
  payloadSpan?: SourceSpan;
  trigger: TriggerPolicy;
  connectionUseId?: string;
  destinationScope: 'current-org' | 'connection-org-unknown' | 'unknown';
  groupId?: string;
}
/** A possible function invocation; catalogue identity never implies readable source. */
export interface FunctionCall extends EffectBase {
  kind: 'crm-function' | 'other-product-function' | 'unclassified';
  qualifiedName: NameFact;
  category: string | null;
  apiName: string | null;
  via: 'direct' | 'http-execute';
  resolution: 'exact' | 'ambiguous' | 'missing' | 'not-attempted';
  calleeFunctionId: string | null;
  arguments: Array<{
    position: number;
    span: SourceSpan;
    parameterOrigin?: string;
    shape: 'map' | 'list' | 'scalar' | 'unknown';
  }>;
  connectionUseId?: string;
  destinationScope: WriteEffect['destinationScope'];
}
/** A Zoho built-in call grouped by its immediate service namespace. */
export interface ServiceCall extends EffectBase {
  service: string;
  method: string;
  apiVersion: string | null;
  connectionUseId?: string;
}
/** External capability, without URL, recipients, message, or payload content. */
export interface ExternalEffect extends EffectBase {
  kind: 'http' | 'sendmail';
  destination: 'external-url' | 'zoho-service-url' | 'unknown-url' | 'email';
  method: string | null;
  service?: string;
  connectionUseId?: string;
}
/** Optional native reads; never included in the write index. */
export interface ReadEffect extends EffectBase {
  op: 'get-by-id' | 'search';
  module: NameFact;
  fields: FieldFact[];
  fieldsConfidence: FieldsConfidence;
  connectionUseId?: string;
}
/** Stable diagnostic codes and static message keys contain no source snippets. */
export interface AnalysisWarning {
  code: string;
  severity: 'info' | 'coverage-gap';
  messageKey: string;
  span?: SourceSpan;
  effectIds: string[];
}
/** Deterministic local work budgets, clamped to finite positive integers. */
export interface AnalysisLimits {
  sourceLength: number;
  tokens: number;
  bindings: number;
  keys: number;
  listElements: number;
  alternatives: number;
  evidence: number;
  structuralDepth: number;
  payloadDepth: number;
  visits: number;
  effects: number;
  warnings: number;
  outputBytes: number;
}
/** Exact catalogue API names only; duplicate conflicting identities stay ambiguous. */
export interface CatalogueFunction {
  id: string;
  apiName: string;
  category?: string;
}
/** Caller-supplied identity/context does not propagate workflow bindings into analysis. */
export interface AnalyzeOptions {
  functionId?: string;
  sourceRevision?: string;
  language?: string;
  freshness?: 'current' | 'cached-stale' | 'unknown';
  /** Body-only source may supply its declared parameter names here. */
  parameters?: readonly string[];
  catalogue?: readonly CatalogueFunction[];
  /** Explicit current-context origins; only these permit HTTP catalogue joins. */
  currentCrmOrigin?: string;
  limits?: Partial<AnalysisLimits>;
}
/** Cacheable possible effects of exactly one supplied function source. */
export interface FunctionEffects {
  schemaVersion: 1;
  analyzerVersion: number;
  functionId: string;
  sourceRevision: string;
  certainty: 'possible';
  analysis: {
    status: 'analyzed' | 'limited' | 'unsupported' | 'failed';
    freshness: 'current' | 'cached-stale' | 'unknown';
    sourceLength: number;
    tokenCount: number;
    analyzedSpans: SourceSpan[];
    unscanned: SourceSpan[];
    limitReasons: string[];
  };
  writes: WriteEffect[];
  calls: FunctionCall[];
  services: ServiceCall[];
  external: ExternalEffect[];
  connections: ConnectionUse[];
  reads: ReadEffect[];
  warnings: AnalysisWarning[];
}
