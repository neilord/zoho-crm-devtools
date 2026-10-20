import type { ZohoFunctionSummary } from '../content/functions/types';
import type { WorkflowRule } from '../content/workflows/types';

export interface LegacyWorkflowCache {
  version: 1;
  savedAt: number;
  rules: WorkflowRule[];
}
/** Wire graph stores shared resources/code once, rather than once per action occurrence. */
export interface WorkflowGraphCache {
  version: 2;
  savedAt: number;
  summaries: unknown[];
  details: [string, unknown][];
  resources: [string, unknown][];
  templates: [string, unknown][];
  fields: [string, [string, import('../content/workflows/types').WorkflowField][]][];
  catalogue: ZohoFunctionSummary[] | null;
  sources: [string, string | null][];
}
export type WorkflowCache = LegacyWorkflowCache | WorkflowGraphCache;
export type WorkflowCacheMessage =
  | { type: 'workflows:readCache'; origin: string; orgId: string }
  | {
      type: 'workflows:writeCache';
      origin: string;
      orgId: string;
      value: WorkflowCache | PackedWorkflowCache;
    };
// Bound decompressed JSON independently from the compressed storage/message budget.
export const WORKFLOW_CACHE_LIMIT = 32_000_000;
export const WORKFLOW_PACKED_LIMIT = 3_000_000;
export interface PackedWorkflowCache {
  encoding: 'gzip-base64';
  savedAt: number;
  data: string;
}
export function packedWorkflowCacheIssue(value: unknown): WorkflowCacheIssue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { path: '$', reason: 'expected packed object' };
  const c = value as PackedWorkflowCache;
  if (Object.keys(c).length !== 3) return { path: '$', reason: 'expected three packed properties' };
  if (c.encoding !== 'gzip-base64') return { path: '$.encoding', reason: 'unsupported encoding' };
  if (!Number.isFinite(c.savedAt))
    return { path: '$.savedAt', reason: 'expected finite timestamp' };
  if (typeof c.data !== 'string') return { path: '$.data', reason: 'expected base64 string' };
  if (c.data.length > WORKFLOW_PACKED_LIMIT)
    return { path: '$.data.length', reason: `exceeds ${WORKFLOW_PACKED_LIMIT} encoded characters` };
  if (c.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(c.data))
    return { path: '$.data', reason: 'invalid base64 characters' };
  return null;
}
export function isPackedWorkflowCache(value: unknown): value is PackedWorkflowCache {
  return packedWorkflowCacheIssue(value) === null;
}
export function isWorkflowOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      url.protocol === 'https:' &&
      url.port === '' &&
      /^(crm\.zoho|[a-z0-9-]+\.zohoportal)\.(com|au|eu|in|com\.au|jp|com\.cn)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}
export interface WorkflowCacheIssue {
  /** Structural location only: never a CRM value, map key, name, or source snippet. */
  path: string;
  reason: string;
}

/** Validate the cache envelope, not Zoho's open-ended raw union payloads.
 * Hydration re-normalizes raw nodes; endpoint/handoff validators still own usable IDs.
 */
export function workflowCacheIssue(value: unknown): WorkflowCacheIssue | null {
  const issue = (path: string, reason: string): never => {
    throw { path, reason };
  };
  const record = (v: unknown, path: string): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) issue(path, 'expected object');
    return v as Record<string, unknown>;
  };
  const list = (v: unknown, path: string, max: number): unknown[] => {
    if (!Array.isArray(v)) issue(path, 'expected array');
    const items = v as unknown[];
    if (items.length > max) issue(`${path}.length`, `exceeds ${max} entries`);
    return items;
  };
  const text = (v: unknown, path: string) => {
    if (typeof v !== 'string') issue(path, 'expected string');
  };
  const pairs = (v: unknown, path: string): [string, unknown][] =>
    list(v, path, 10000).map((pair, i) => {
      if (!Array.isArray(pair) || pair.length !== 2) issue(`${path}[${i}]`, 'expected pair');
      const entry = pair as [string, unknown];
      text(entry[0], `${path}[${i}][0]`);
      return entry;
    });
  try {
    const c = record(value, '$');
    if (c.version !== 1 && c.version !== 2) issue('$.version', 'unsupported schema version');
    const legacyKeys = { version: true, savedAt: true, rules: true } satisfies Record<
      keyof LegacyWorkflowCache,
      true
    >;
    const graphKeys = {
      version: true,
      savedAt: true,
      summaries: true,
      details: true,
      resources: true,
      templates: true,
      fields: true,
      catalogue: true,
      sources: true,
    } satisfies Record<keyof WorkflowGraphCache, true>;
    const keys = Object.keys(c.version === 1 ? legacyKeys : graphKeys);
    for (const key of keys) if (!(key in c)) issue(`$.${key}`, 'missing property');
    if (Object.keys(c).length !== keys.length) issue('$', 'unexpected envelope properties');
    if (!Number.isFinite(c.savedAt)) issue('$.savedAt', 'expected finite timestamp');
    if (c.version === 2) {
      list(c.summaries, '$.summaries', 2000); // unknown[] by contract, including future Zoho shapes.
      for (const key of ['details', 'resources', 'templates']) pairs(c[key], `$.${key}`);
      for (const [i, [, fields]] of pairs(c.fields, '$.fields').entries())
        for (const [j, [, field]] of pairs(fields, `$.fields[${i}][1]`).entries()) {
          const path = `$.fields[${i}][1][${j}][1]`;
          const f = record(field, path);
          text(f.apiName, `${path}.apiName`);
          text(f.label, `${path}.label`);
          if (f.id !== undefined) text(f.id, `${path}.id`);
        }
      if (c.catalogue !== null)
        for (const [i, entry] of list(c.catalogue, '$.catalogue', Infinity).entries()) {
          const path = `$.catalogue[${i}]`,
            summary = record(entry, path);
          text(summary.id, `${path}.id`);
          // Zoho's nullable optional name is valid wire data. Missing/empty/namespaced
          // identifiers are advisory cache data, never permission to call an endpoint.
          if (summary.api_name != null) text(summary.api_name, `${path}.api_name`);
        }
      for (const [i, [, source]] of pairs(c.sources, '$.sources').entries())
        if (source !== null) text(source, `$.sources[${i}][1]`);
    } else {
      for (const [i, entry] of list(c.rules, '$.rules', 2000).entries()) {
        const path = `$.rules[${i}]`,
          rule = record(entry, path);
        text(rule.id, `${path}.id`);
        text(rule.name, `${path}.name`);
        const module = record(rule.module, `${path}.module`);
        text(module.apiName, `${path}.module.apiName`);
        list(rule.conditions, `${path}.conditions`, Infinity);
        // raw/detailRaw are unknown, and normalized actions/triggers are not trusted
        // on read. Do not reject unknown unions or compare numeric wire IDs to strings.
      }
    }
    if (new TextEncoder().encode(JSON.stringify(value)).length > WORKFLOW_CACHE_LIMIT)
      issue('$.byteLength', `exceeds ${WORKFLOW_CACHE_LIMIT} decoded bytes`);
    return null;
  } catch (error) {
    if (error && typeof error === 'object' && 'path' in error && 'reason' in error)
      return error as WorkflowCacheIssue;
    return { path: '$', reason: 'not JSON serializable' };
  }
}

export function reportWorkflowCacheIssue(value: unknown): void {
  if (import.meta.env.MODE === 'development') {
    const issue =
      value && typeof value === 'object' && 'encoding' in value
        ? packedWorkflowCacheIssue(value)
        : workflowCacheIssue(value);
    if (issue) console.warn('Zoho CRM DevTools: invalid workflow cache', issue);
  }
}
export function isWorkflowCache(value: unknown): value is WorkflowCache {
  return workflowCacheIssue(value) === null;
}
export function isWorkflowCacheMessage(value: unknown): value is WorkflowCacheMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as WorkflowCacheMessage;
  if (
    typeof m.origin !== 'string' ||
    !isWorkflowOrigin(m.origin) ||
    typeof m.orgId !== 'string' ||
    !/^\d+$/.test(m.orgId)
  )
    return false;
  if (m.type === 'workflows:readCache') return Object.keys(m).length === 3;
  return (
    m.type === 'workflows:writeCache' &&
    Object.keys(m).length === 4 &&
    (isWorkflowCache(m.value) || isPackedWorkflowCache(m.value))
  );
}
export function workflowCacheKey(origin: string, orgId: string): string {
  return `zcdt-workflow-cache:${origin}:${orgId}`;
}
