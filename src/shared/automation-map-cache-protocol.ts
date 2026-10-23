import type { RetryParent } from '../content/automation-map/data/zoho-api';
import type { AutomationGraphInputs, MapCoverage } from '../content/automation-map/types';
import { packWorkflowCache, unpackWorkflowCache } from './workflow-cache-codec';
import {
  isPackedWorkflowCache,
  isWorkflowCache,
  isWorkflowOrigin,
  type PackedWorkflowCache,
  type WorkflowGraphCache,
} from './workflow-cache-protocol';

export const AUTOMATION_MAP_CACHE_LIMIT = 24_000_000;
export const AUTOMATION_MAP_PACKED_LIMIT = 3_000_000;
export const AUTOMATION_MAP_BUCKET_LIMIT = 9_000_000;
export const AUTOMATION_MAP_PARTITIONS = 3;
export interface AutomationMapCache {
  version: 1;
  savedAt: number;
  /** Optional for old caches; absence always requires revalidation. No executable retry handles. */
  revalidation?: {
    lastRevalidatedAt: number | null;
    categories: Pick<MapCoverage, 'buttons' | 'schedules' | 'blueprints' | 'approvals'>;
    failureIds: string[];
    dependencies?: {
      id: string;
      state: 'loaded' | 'unsupported' | 'failed';
      parent?: RetryParent;
    }[];
  };
  inputs: Omit<AutomationGraphInputs, 'fields'> & {
    fields: [string, { apiName: string; label: string }[]][];
  };
}
export type AutomationMapCacheMessage =
  | { type: 'automationMap:readCache'; origin: string; orgId: string }
  | {
      type: 'automationMap:writeCache';
      origin: string;
      orgId: string;
      value: AutomationMapCache | PackedWorkflowCache;
    };
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
const list = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= 10_000;
const nullableText = (v: unknown) => v === null || text(v);
const flag = (v: unknown) => v === null || typeof v === 'boolean';
function actions(v: unknown): boolean {
  return (
    list(v) &&
    v.every(
      (a) => record(a) && record(a.raw) && (a.resourceRaw === undefined || record(a.resourceRaw)),
    )
  );
}
function effects(v: unknown): boolean {
  if (v === null) return true;
  if (
    !record(v) ||
    v.schemaVersion !== 1 ||
    !Number.isInteger(v.analyzerVersion) ||
    !text(v.functionId) ||
    !text(v.sourceRevision) ||
    v.certainty !== 'possible' ||
    !record(v.analysis)
  )
    return false;
  const a = v.analysis;
  if (
    !['analyzed', 'limited', 'unsupported', 'failed'].includes(String(a.status)) ||
    !list(a.analyzedSpans) ||
    !list(a.unscanned) ||
    !list(a.limitReasons) ||
    !Number.isFinite(a.sourceLength)
  )
    return false;
  for (const key of ['writes', 'calls', 'services', 'external', 'connections', 'reads', 'warnings'])
    if (!list(v[key])) return false;
  // Validate the graph-facing facts rather than accepting arbitrary normalized objects.
  const span = (s: unknown) =>
    record(s) &&
    Number.isInteger(s.start) &&
    Number.isInteger(s.end) &&
    Number(s.start) >= 0 &&
    Number(s.end) >= Number(s.start);
  const strings = (s: unknown) => list(s) && s.every(text);
  const spans = (s: unknown) => list(s) && s.every(span);
  const common = (e: unknown) =>
    record(e) &&
    text(e.id) &&
    ['exact', 'partial', 'unknown'].includes(String(e.confidence)) &&
    span(e.span) &&
    span(e.calleeSpan) &&
    strings(e.reasons) &&
    list(e.contexts);
  const name = (n: unknown) =>
    record(n) &&
    nullableText(n.value) &&
    strings(n.candidates) &&
    span(n.span) &&
    spans(n.evidence);
  const fields = (f: unknown) =>
    list(f) && f.every((v) => record(v) && text(v.apiName) && strings(v.path) && spans(v.evidence));
  return (
    spans(a.analyzedSpans) &&
    spans(a.unscanned) &&
    strings(a.limitReasons) &&
    (v.writes as unknown[]).every(
      (w) =>
        record(w) &&
        common(w) &&
        text(w.op) &&
        name(w.module) &&
        fields(w.fields) &&
        typeof w.unknownFields === 'boolean' &&
        record(w.trigger) &&
        text(w.trigger.workflow) &&
        (w.trigger.requested === null || strings(w.trigger.requested)),
    ) &&
    (v.calls as unknown[]).every(
      (c) =>
        record(c) &&
        common(c) &&
        name(c.qualifiedName) &&
        nullableText(c.apiName) &&
        nullableText(c.calleeFunctionId) &&
        list(c.arguments),
    ) &&
    (v.services as unknown[]).every(
      (s) => record(s) && common(s) && text(s.service) && text(s.method),
    ) &&
    (v.external as unknown[]).every(
      (e) => record(e) && common(e) && text(e.kind) && text(e.destination),
    ) &&
    (v.connections as unknown[]).every(
      (c) => record(c) && text(c.id) && name(c.name) && span(c.span),
    ) &&
    (v.reads as unknown[]).every(
      (r) => record(r) && common(r) && name(r.module) && fields(r.fields),
    ) &&
    (v.warnings as unknown[]).every(
      (w) => record(w) && text(w.code) && text(w.messageKey) && strings(w.effectIds),
    )
  );
}
export function isAutomationMapCache(value: unknown): value is AutomationMapCache {
  try {
    if (
      !record(value) ||
      Object.keys(value).some(
        (k) => !['version', 'savedAt', 'inputs', 'revalidation'].includes(k),
      ) ||
      value.version !== 1 ||
      !Number.isFinite(value.savedAt) ||
      !record(value.inputs)
    )
      return false;
    if (value.revalidation !== undefined) {
      const r = value.revalidation;
      const count = (v: unknown) => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 100_000;
      if (
        !record(r) ||
        Object.keys(r).some(
          (k) => !['lastRevalidatedAt', 'categories', 'failureIds', 'dependencies'].includes(k),
        ) ||
        !(
          r.lastRevalidatedAt === null ||
          (Number.isFinite(r.lastRevalidatedAt) &&
            Number(r.lastRevalidatedAt) >= 0 &&
            Number(r.lastRevalidatedAt) <= Number(value.savedAt))
        ) ||
        !list(r.failureIds) ||
        !r.failureIds.every((id) => text(id) && id.length <= 512) ||
        (r.dependencies !== undefined &&
          (!list(r.dependencies) ||
            !r.dependencies.every(
              (d) =>
                record(d) &&
                Object.keys(d).every((k) => ['id', 'state', 'parent'].includes(k)) &&
                text(d.id) &&
                d.id.length <= 512 &&
                ['loaded', 'unsupported', 'failed'].includes(String(d.state)) &&
                (d.parent === undefined ||
                  (record(d.parent) &&
                    Object.keys(d.parent).length === 5 &&
                    text(d.parent.id) &&
                    /^\d{1,100}$/.test(d.parent.id) &&
                    text(d.parent.name) &&
                    d.parent.name.length <= 1024 &&
                    flag(d.parent.active) &&
                    record(d.parent.module) &&
                    Object.keys(d.parent.module).length === 1 &&
                    text(d.parent.module.api_name) &&
                    d.parent.module.api_name.length <= 256 &&
                    record(d.parent.field) &&
                    Object.keys(d.parent.field).length === 1 &&
                    text(d.parent.field.api_name) &&
                    d.parent.field.api_name.length <= 256)),
            ))) ||
        !record(r.categories) ||
        Object.keys(r.categories).length !== 4 ||
        !['buttons', 'schedules', 'blueprints', 'approvals'].every((key) => {
          const c = (r.categories as Record<string, unknown>)[key];
          return (
            record(c) &&
            count(c.loaded) &&
            count(c.failed) &&
            (c.unsupported === undefined || count(c.unsupported)) &&
            ['not-requested', 'loading', 'loaded', 'failed', 'unsupported'].includes(
              String(c.state),
            )
          );
        })
      )
        return false;
    }
    const i = value.inputs;
    if (
      Object.keys(i).length !== 8 ||
      !list(i.modules) ||
      !list(i.fields) ||
      !list(i.functions) ||
      !list(i.buttons) ||
      !list(i.schedules) ||
      !list(i.transitions) ||
      !list(i.approvals) ||
      !list(i.rules)
    )
      return false;
    if (!isWorkflowCache({ version: 1, savedAt: value.savedAt, rules: i.rules })) return false;
    if (
      !i.rules.every(
        (r) =>
          record(r) &&
          record(r.raw) &&
          (r.detailRaw === undefined || record(r.detailRaw)) &&
          list(r.conditions) &&
          r.conditions.every(
            (c) =>
              record(c) &&
              actions(c.instantActions) &&
              list(c.scheduledActions) &&
              c.scheduledActions.every((s) => record(s) && actions(s.actions)),
          ),
      )
    )
      return false;
    if (
      !i.modules.every(
        (m) => record(m) && text(m.apiName) && text(m.label) && nullableText(m.pluralLabel),
      )
    )
      return false;
    if (
      !i.fields.every(
        (p) =>
          list(p) &&
          p.length === 2 &&
          text(p[0]) &&
          list(p[1]) &&
          p[1].every((f) => record(f) && text(f.apiName) && text(f.label)),
      )
    )
      return false;
    if (
      !i.functions.every(
        (f) =>
          record(f) &&
          text(f.delugeId) &&
          record(f.summary) &&
          text(f.summary.id) &&
          f.summary.id === f.delugeId &&
          text(f.summary.display_name) &&
          text(f.summary.category) &&
          (f.summary.api_name == null || text(f.summary.api_name)) &&
          (f.summary.language === undefined || text(f.summary.language)) &&
          (f.summary.source === undefined || text(f.summary.source)) &&
          (f.summary.rest_api === undefined ||
            (list(f.summary.rest_api) && f.summary.rest_api.every(record))) &&
          (f.summary.associated_place === undefined ||
            (list(f.summary.associated_place) && f.summary.associated_place.every(record))) &&
          (f.summary.tasks == null ||
            (record(f.summary.tasks) &&
              (f.summary.tasks.integrations === undefined ||
                (list(f.summary.tasks.integrations) &&
                  f.summary.tasks.integrations.every(record))))) &&
          list(f.places) &&
          f.places.every(
            (p) =>
              record(p) && text(p.type) && nullableText(p.id) && nullableText(p.modulePluralLabel),
          ) &&
          ['pending', 'available', 'unavailable', 'failed'].includes(String(f.sourceState)) &&
          nullableText(f.sourceText) &&
          effects(f.effects),
      )
    )
      return false;
    if (
      !i.buttons.every(
        (b) =>
          record(b) &&
          text(b.id) &&
          text(b.name) &&
          text(b.moduleApiName) &&
          list(b.placements) &&
          b.placements.every(text) &&
          text(b.actionType) &&
          nullableText(b.functionDelugeId),
      )
    )
      return false;
    if (
      !i.schedules.every(
        (s) =>
          record(s) &&
          text(s.id) &&
          text(s.name) &&
          flag(s.active) &&
          nullableText(s.recurrenceLabel) &&
          nullableText(s.functionApiName),
      )
    )
      return false;
    if (
      !i.transitions.every(
        (t) =>
          record(t) &&
          text(t.blueprintId) &&
          text(t.blueprintName) &&
          flag(t.blueprintActive) &&
          text(t.moduleApiName) &&
          text(t.transitionId) &&
          text(t.name) &&
          list(t.duringInputFields) &&
          t.duringInputFields.every(text) &&
          actions(t.actions),
      )
    )
      return false;
    if (
      !i.approvals.every(
        (a) =>
          record(a) &&
          text(a.id) &&
          text(a.name) &&
          text(a.moduleApiName) &&
          flag(a.active) &&
          actions(a.actions),
      )
    )
      return false;
    return new TextEncoder().encode(JSON.stringify(value)).length <= AUTOMATION_MAP_CACHE_LIMIT;
  } catch {
    return false;
  }
}
export function isAutomationMapCacheMessage(v: unknown): v is AutomationMapCacheMessage {
  if (
    !record(v) ||
    !text(v.origin) ||
    !isWorkflowOrigin(v.origin) ||
    !text(v.orgId) ||
    !/^\d+$/.test(v.orgId)
  )
    return false;
  return v.type === 'automationMap:readCache'
    ? Object.keys(v).length === 3
    : v.type === 'automationMap:writeCache' &&
        Object.keys(v).length === 4 &&
        (isAutomationMapCache(v.value) || isPackedWorkflowCache(v.value));
}
export const automationMapCacheKey = (origin: string, orgId: string) =>
  `automation-map:${origin}:${orgId}`;

/** Reuse the workflow gzip/base64 codec and its streaming decompression bomb limit.
 * A single opaque wire summary carries our independently validated, versioned payload.
 */
export async function packAutomationMapCache(
  value: AutomationMapCache,
): Promise<PackedWorkflowCache> {
  if (!isAutomationMapCache(value)) throw new Error('Invalid Automation Map cache');
  const carrier: WorkflowGraphCache = {
    version: 2,
    savedAt: value.savedAt,
    summaries: [value],
    details: [],
    resources: [],
    templates: [],
    fields: [],
    catalogue: null,
    sources: [],
  };
  return packWorkflowCache(carrier);
}
export async function unpackAutomationMapCache(value: unknown): Promise<AutomationMapCache | null> {
  if (isAutomationMapCache(value)) return value;
  if (!isPackedWorkflowCache(value) || value.data.length > AUTOMATION_MAP_PACKED_LIMIT) return null;
  const carrier = await unpackWorkflowCache(value);
  const decoded =
    carrier?.version === 2 && carrier.summaries.length === 1 ? carrier.summaries[0] : null;
  return isAutomationMapCache(decoded) ? decoded : null;
}
