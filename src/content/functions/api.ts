import type { CrmContext } from './crm-context';
import type { ZohoFunctionDetail, ZohoFunctionSummary } from './types';

const DELUGE_API_VERSION = 'v2';
const PAGE_SIZE = 200;

/** Injectable fetch so the client can be unit tested without a network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function buildRequestHeaders(context: CrmContext): Record<string, string> {
  return {
    'Content-Type': 'application/json;charset=UTF-8',
    'X-Crm-Org': context.orgId,
    'X-Zcsrf-Token': context.csrfHeader,
  };
}

export function buildFunctionsUrl(context: CrmContext, start: number): string {
  return `${context.origin}/crm/${DELUGE_API_VERSION}/settings/functions?type=org&start=${start}&limit=${PAGE_SIZE}`;
}

export function buildFunctionDetailUrl(context: CrmContext, summary: ZohoFunctionSummary): string {
  const params = new URLSearchParams({
    language: summary.language ?? 'deluge',
    source: summary.source ?? 'crm',
  });
  return `${context.origin}/crm/${DELUGE_API_VERSION}/settings/functions/${summary.id}?${params.toString()}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function normalizeSummary(raw: unknown): ZohoFunctionSummary | null {
  const record = asRecord(raw);
  if (!record || record.id === undefined || record.id === null) {
    return null;
  }
  return { ...(record as unknown as ZohoFunctionSummary), id: String(record.id) };
}

function request(context: CrmContext, url: string, fetchImpl: FetchLike): Promise<Response> {
  return fetchImpl(url, {
    method: 'GET',
    headers: buildRequestHeaders(context),
    credentials: 'include',
  });
}

/**
 * Fetches every org function, paging until Zoho returns no further results
 * (HTTP 204 or a short final page). Duplicate ids are dropped.
 */
export async function fetchAllFunctions(
  context: CrmContext,
  fetchImpl: FetchLike = fetch,
): Promise<ZohoFunctionSummary[]> {
  const summaries: ZohoFunctionSummary[] = [];
  const seen = new Set<string>();

  for (let start = 1; ; start += PAGE_SIZE) {
    const response = await request(context, buildFunctionsUrl(context, start), fetchImpl);
    if (response.status === 204) {
      break;
    }
    if (!response.ok) {
      throw new Error(`Zoho functions list request failed with status ${response.status}`);
    }

    const body = asRecord(await response.json());
    const page = Array.isArray(body?.functions) ? body.functions : [];
    if (page.length === 0) {
      break;
    }

    for (const raw of page) {
      const summary = normalizeSummary(raw);
      if (summary && !seen.has(summary.id)) {
        seen.add(summary.id);
        summaries.push(summary);
      }
    }

    if (page.length < PAGE_SIZE) {
      break;
    }
  }

  return summaries;
}

/** Fetches a single function's details, including its Deluge source. */
export async function fetchFunctionDetail(
  context: CrmContext,
  summary: ZohoFunctionSummary,
  fetchImpl: FetchLike = fetch,
): Promise<ZohoFunctionDetail | null> {
  const response = await request(context, buildFunctionDetailUrl(context, summary), fetchImpl);
  // Zoho sometimes answers a detail request with a bodyless 204, the same signal
  // `fetchAllFunctions` treats as "nothing here" for the list endpoint. `response.ok`
  // is true for 204 too, so without this check `response.json()` below throws
  // `SyntaxError: Unexpected end of JSON input` on the empty body.
  if (response.status === 204) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Zoho function detail request failed with status ${response.status}`);
  }

  const body = asRecord(await response.json());
  const list = Array.isArray(body?.functions) ? body.functions : [];
  const detail = asRecord(list[0]);
  if (!detail) {
    return null;
  }

  return { ...(detail as unknown as ZohoFunctionDetail), id: String(detail.id ?? summary.id) };
}
