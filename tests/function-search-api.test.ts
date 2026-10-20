import { describe, expect, it, vi } from 'vitest';
import {
  buildFunctionDetailUrl,
  buildFunctionsUrl,
  buildRequestHeaders,
  type FetchLike,
  fetchAllFunctions,
  fetchFunctionDetail,
} from '../src/content/functions/api';
import type { CrmContext } from '../src/content/functions/crm-context';
import type { ZohoFunctionSummary } from '../src/content/functions/types';

const context: CrmContext = {
  origin: 'https://crm.zoho.eu',
  orgId: '42',
  csrfHeader: 'crmcsrfparam=tok',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function summary(id: string): ZohoFunctionSummary {
  return { id, display_name: `fn-${id}`, category: 'Standalone' };
}

describe('request building', () => {
  it('keeps untrusted ids within one path segment and rejects dot segments', () => {
    expect(buildFunctionDetailUrl(context, summary('a/b?c#d'))).toContain('/a%2Fb%3Fc%23d?');
    for (const id of ['', '.', '..'])
      expect(() => buildFunctionDetailUrl(context, summary(id))).toThrow();
  });
  it('builds the paginated list URL', () => {
    expect(buildFunctionsUrl(context, 1)).toBe(
      'https://crm.zoho.eu/crm/v2/settings/functions?type=org&start=1&limit=200',
    );
  });

  it('builds the detail URL with language and source defaults', () => {
    expect(buildFunctionDetailUrl(context, summary('7'))).toBe(
      'https://crm.zoho.eu/crm/v2/settings/functions/7?language=deluge&source=crm',
    );
  });

  it('sends the org and CSRF headers', () => {
    expect(buildRequestHeaders(context)).toMatchObject({
      'X-Crm-Org': '42',
      'X-Zcsrf-Token': 'crmcsrfparam=tok',
    });
  });
});

describe('fetchAllFunctions', () => {
  it('fails rather than looping when Zoho repeats a full page', async () => {
    const functions = Array.from({ length: 200 }, (_, i) => ({ id: i + 1 }));
    const request = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ functions }));
    await expect(fetchAllFunctions(context, request)).rejects.toThrow(
      'pagination made no progress',
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('pages until a short page and de-duplicates ids', async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({ id: index + 1 }));
    const secondPage = [{ id: 200 }, { id: 201 }]; // 200 repeats across the boundary

    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ functions: firstPage }))
      .mockResolvedValueOnce(jsonResponse({ functions: secondPage }));

    const result = await fetchAllFunctions(context, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(201);
    expect(result.every((fn) => typeof fn.id === 'string')).toBe(true);
  });

  it('stops on a 204 with no results', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(null, 204));
    expect(await fetchAllFunctions(context, fetchImpl)).toEqual([]);
  });

  it('throws on an error status', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(null, 500));
    await expect(fetchAllFunctions(context, fetchImpl)).rejects.toThrow('status 500');
  });
});

describe('fetchFunctionDetail', () => {
  it('returns the first detail with a string id', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse({ functions: [{ id: 7, script: 'return 1;' }] }));

    const detail = await fetchFunctionDetail(context, summary('7'), fetchImpl);

    expect(detail).toEqual({ id: '7', script: 'return 1;' });
  });

  it('returns null when no function is present', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ functions: [] }));
    expect(await fetchFunctionDetail(context, summary('7'), fetchImpl)).toBeNull();
  });

  it('returns null on a bodyless 204 instead of throwing on the empty body', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(null, 204));
    expect(await fetchFunctionDetail(context, summary('7'), fetchImpl)).toBeNull();
  });
});
