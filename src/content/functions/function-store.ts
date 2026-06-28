import { fetchAllFunctions, fetchFunctionDetail } from './api';
import type { CrmContext } from './crm-context';
import type { FunctionRecord, ZohoFunctionSummary } from './types';

/** Number of detail requests in flight at once while warming the source cache. */
const DETAIL_CONCURRENCY = 6;

/**
 * Per-tab cache keyed by function id. Details are expensive (one request each)
 * so we keep them for the life of the page and only refetch when a function's
 * `updatedTime` changes. This is intentionally in-memory; persistence can come
 * later if large orgs need it.
 */
const recordCache = new Map<string, FunctionRecord>();

function sameVersion(a: ZohoFunctionSummary, b: ZohoFunctionSummary): boolean {
  return a.updatedTime === b.updatedTime;
}

export interface LoadHandlers {
  /** Called once with all summaries, before any detail has loaded. */
  onListLoaded(records: FunctionRecord[]): void;
  /** Called as each detail resolves, with running progress counts. */
  onDetailProgress(loaded: number, total: number): void;
  /** Called once all details have settled (resolved or failed). */
  onComplete(): void;
  /** Called when the list request itself fails; loading stops. */
  onError(error: unknown): void;
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

/**
 * Loads the function list immediately, then warms each function's detail/source
 * in the background so full-text search becomes available progressively.
 */
export async function loadFunctions(context: CrmContext, handlers: LoadHandlers): Promise<void> {
  let summaries: ZohoFunctionSummary[];
  try {
    summaries = await fetchAllFunctions(context);
  } catch (error) {
    handlers.onError(error);
    return;
  }

  const records: FunctionRecord[] = summaries.map((summary) => {
    const cached = recordCache.get(summary.id);
    const detail = cached && sameVersion(cached.summary, summary) ? cached.detail : null;
    const record: FunctionRecord = { summary, detail };
    recordCache.set(summary.id, record);
    return record;
  });

  handlers.onListLoaded(records);

  const pending = records.filter((record) => record.detail === null);
  const total = records.length;
  let loaded = total - pending.length;
  handlers.onDetailProgress(loaded, total);

  await runPool(pending, DETAIL_CONCURRENCY, async (record) => {
    try {
      record.detail = await fetchFunctionDetail(context, record.summary);
      recordCache.set(record.summary.id, record);
    } catch (error) {
      console.warn('Zoho CRM DevTools: failed to load function detail', record.summary.id, error);
    } finally {
      loaded += 1;
      handlers.onDetailProgress(loaded, total);
    }
  });

  handlers.onComplete();
}

/** Test-only helper to clear the per-tab cache. */
export function clearFunctionCache(): void {
  recordCache.clear();
}
