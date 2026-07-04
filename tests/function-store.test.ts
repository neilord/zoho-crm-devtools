import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrmContext } from '../src/content/functions/crm-context';
import { clearFunctionCache, loadFunctions } from '../src/content/functions/function-store';
import type { StorageArea } from '../src/shared/browser';

const context: CrmContext = {
  origin: 'https://crm.zoho.eu',
  orgId: '42',
  csrfHeader: 'crmcsrfparam=tok',
};

function createFakeStorage(): StorageArea {
  const store = new Map<string, unknown>();
  return {
    async get<T extends Record<string, unknown>>(keys?: string[] | null) {
      const list = keys ?? Array.from(store.keys());
      const result: Record<string, unknown> = {};
      for (const key of list) {
        if (store.has(key)) {
          result[key] = store.get(key);
        }
      }
      return result as T;
    },
    async set(items: Record<string, unknown>) {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
    },
  };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function summary(id: string, updatedTime: string) {
  return { id, display_name: `fn-${id}`, category: 'Standalone', updatedTime };
}

function mockFetch(updatedTime: string) {
  return vi.fn(async (url: string) => {
    if (url.includes('/settings/functions?')) {
      return jsonResponse({ functions: [summary('1', updatedTime)] });
    }
    return jsonResponse({ functions: [{ id: '1', script: 'return 1;' }] });
  });
}

async function collect(storage: StorageArea): Promise<void> {
  await loadFunctions(
    context,
    {
      onListLoaded: () => {},
      onDetailProgress: () => {},
      onComplete: () => {},
      onError: (error) => {
        throw error;
      },
    },
    storage,
  );
}

function detailCallCount(fetchImpl: ReturnType<typeof mockFetch>): number {
  return fetchImpl.mock.calls.filter(([url]) => String(url).includes('/settings/functions/1?'))
    .length;
}

describe('loadFunctions persistence', () => {
  afterEach(() => {
    clearFunctionCache();
    vi.unstubAllGlobals();
  });

  it('reuses a persisted detail across a fresh in-memory cache (simulating a reload)', async () => {
    const storage = createFakeStorage();
    const fetchImpl = mockFetch('2026-01-01');
    vi.stubGlobal('fetch', fetchImpl);

    await collect(storage);
    expect(detailCallCount(fetchImpl)).toBe(1);

    // A new tab or page reload wipes the in-memory cache but not `storage`.
    clearFunctionCache();
    await collect(storage);

    expect(detailCallCount(fetchImpl)).toBe(1);
  });

  it('refetches the detail when a persisted function changes updatedTime', async () => {
    const storage = createFakeStorage();
    const fetchImplV1 = mockFetch('2026-01-01');
    vi.stubGlobal('fetch', fetchImplV1);
    await collect(storage);
    clearFunctionCache();

    const fetchImplV2 = mockFetch('2026-02-01');
    vi.stubGlobal('fetch', fetchImplV2);
    await collect(storage);

    expect(detailCallCount(fetchImplV2)).toBe(1);
  });
});
