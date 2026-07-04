import { browser, type StorageArea } from '../../shared/browser';
import { fetchAllFunctions, fetchFunctionDetail } from './api';
import type { CrmContext } from './crm-context';
import type { FunctionRecord, ZohoFunctionSummary } from './types';

/** Number of detail requests in flight at once while warming the source cache. */
const DETAIL_CONCURRENCY = 6;

const CACHE_KEY_PREFIX = 'zcdt-function-cache:';
const CACHE_VERSION = 1;

interface PersistedCache {
  version: number;
  records: FunctionRecord[];
}

/**
 * In-memory caches keyed by org id, keyed again by function id. Details are
 * expensive (one request each) so we keep them for the life of the page and
 * only refetch when a function's `updatedTime` changes. Each org's cache is
 * lazily hydrated once from `chrome.storage.local` (see `getOrgCache`) so the
 * warm cache also survives page reloads and new tabs, not just repeat opens
 * within the same page.
 */
const cachesByOrg = new Map<string, Map<string, FunctionRecord>>();
const hydratedOrgs = new Set<string>();

function sameVersion(a: ZohoFunctionSummary, b: ZohoFunctionSummary): boolean {
  return a.updatedTime === b.updatedTime;
}

function cacheKey(orgId: string): string {
  return `${CACHE_KEY_PREFIX}${orgId}`;
}

async function readPersistedCache(orgId: string, storage: StorageArea): Promise<FunctionRecord[]> {
  try {
    const stored = await storage.get<Record<string, PersistedCache>>([cacheKey(orgId)]);
    const cache = stored[cacheKey(orgId)];
    return cache && cache.version === CACHE_VERSION && Array.isArray(cache.records)
      ? cache.records
      : [];
  } catch (error) {
    console.warn('Zoho CRM DevTools: failed to read persisted function cache', error);
    return [];
  }
}

async function writePersistedCache(
  orgId: string,
  records: FunctionRecord[],
  storage: StorageArea,
): Promise<void> {
  try {
    const payload: PersistedCache = { version: CACHE_VERSION, records };
    await storage.set({ [cacheKey(orgId)]: payload });
  } catch (error) {
    console.warn('Zoho CRM DevTools: failed to persist function cache', error);
  }
}

/** Returns the in-memory cache for an org, hydrating it from storage on first use. */
async function getOrgCache(
  orgId: string,
  storage: StorageArea,
): Promise<Map<string, FunctionRecord>> {
  let cache = cachesByOrg.get(orgId);
  if (!cache) {
    cache = new Map();
    cachesByOrg.set(orgId, cache);
  }

  if (!hydratedOrgs.has(orgId)) {
    hydratedOrgs.add(orgId);
    for (const record of await readPersistedCache(orgId, storage)) {
      cache.set(record.summary.id, record);
    }
  }

  return cache;
}

export interface LoadHandlers {
  /**
   * Called synchronously with whatever is already cached (this page load or a
   * past one, via `chrome.storage.local`) before the network list request
   * starts. Lets the UI render instantly instead of blocking on the network;
   * `onListLoaded` still follows with the authoritative list once it resolves.
   * Skipped when nothing is cached yet.
   */
  onCacheLoaded(records: FunctionRecord[]): void;
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
export async function loadFunctions(
  context: CrmContext,
  handlers: LoadHandlers,
  storage: StorageArea = browser.storage.local,
): Promise<void> {
  const recordCache = await getOrgCache(context.orgId, storage);

  if (recordCache.size > 0) {
    handlers.onCacheLoaded(Array.from(recordCache.values()));
  }

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

  // Drop entries for functions that no longer exist in the org so the cache
  // (and what we persist) doesn't grow stale forever.
  const currentIds = new Set(records.map((record) => record.summary.id));
  for (const id of Array.from(recordCache.keys())) {
    if (!currentIds.has(id)) {
      recordCache.delete(id);
    }
  }

  handlers.onListLoaded(records);
  // Persist immediately: even before details finish warming, this snapshot
  // already reuses everything unchanged since the last visit.
  void writePersistedCache(context.orgId, records, storage);

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

  void writePersistedCache(context.orgId, records, storage);
  handlers.onComplete();
}

/** Test-only helper to clear the per-tab cache. */
export function clearFunctionCache(): void {
  cachesByOrg.clear();
  hydratedOrgs.clear();
}
