import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FREE } from '../src/billing/entitlement';
import { UPGRADE_REQUIRED_EVENT } from '../src/content/billing/upgrade-hook';
import { bootstrapFunctionSearch } from '../src/content/functions/bootstrap';
import type { CrmContext } from '../src/content/functions/crm-context';
import {
  type ExportDependencies,
  runFunctionExport,
} from '../src/content/functions/export-controller';
import { loadExportFunctions } from '../src/content/functions/export-loader';
import {
  EXPORT_REQUEST_EVENT,
  EXPORT_STATE_EVENT,
  mountFunctionExport,
} from '../src/content/functions/export-ui';
import type { FunctionRecord } from '../src/content/functions/types';
import { isExportFormat, serializeFunctionExport } from '../src/features/function-export';
import {
  EXPORT_FUNCTIONS_GATE_ENFORCED,
  getFeature,
  isFeatureAvailable,
} from '../src/features/registry';

vi.mock('../src/settings/storage', () => ({
  loadSettings: vi.fn(async () => ({ enabled: true })),
}));
const context: CrmContext = {
  origin: 'https://crm.zoho.eu',
  orgId: '42',
  csrfHeader: 'crmcsrfparam=fixture',
};
const metadata = { orgId: '42', exportedAt: '2026-10-20T12:00:00.000Z' };
const records: FunctionRecord[] = [
  {
    summary: {
      id: '1',
      display_name: 'Résumé, "One"',
      category: 'Standalone',
      description: 'line one\nline two',
      api_name: 'one',
    },
    detail: {
      id: '1',
      script: 'info "こんにちは";\nreturn 1;',
      params: [{ name: 'x', type: 'string' }],
    },
  },
  {
    summary: { id: '2', display_name: 'Two', category: 'Automation' },
    detail: { id: '2', workflow: 'return "workflow";' },
  },
];
const pro = {
  ...FREE,
  plan: 'pro' as const,
  entitled: true,
  status: 'active',
  checkedAt: metadata.exportedAt,
};
function dependencies(): ExportDependencies {
  return {
    getEntitlement: vi.fn(async () => ({ signedIn: true, entitlement: pro })),
    load: vi.fn(async () => ({ records: structuredClone(records), skipped: [] })),
    download: vi.fn(),
    upgradeRequired: vi.fn(),
    state: vi.fn(),
    contextIsCurrent: () => true,
    now: () => metadata.exportedAt,
  };
}

describe('pure export formats', () => {
  it('round-trips JSON summary/detail including unknown metadata and exact Unicode source', () => {
    const full = structuredClone(records);
    Object.assign(full[0].summary, { unknown_metadata: { retain: true } });
    Object.assign(full[0].detail ?? {}, { unknown_detail: ['keep'] });
    const file = serializeFunctionExport(full, 'json', metadata);
    expect(JSON.parse(file.content)).toEqual({
      schemaVersion: 1,
      ...metadata,
      functions: full,
      skipped: [],
    });
    expect(file.filename).toBe('zoho-functions-42-2026-10-20.json');
    expect(file.mediaType).toContain('application/json');
  });
  it('quotes commas, multiline code/metadata and quotes in CSV with both source variants', () => {
    const file = serializeFunctionExport(records, 'csv', metadata);
    expect(file.content).toContain('"Résumé, ""One"""');
    expect(file.content).toContain('"line one\nline two"');
    expect(file.content).toContain('"info ""こんにちは"";\nreturn 1;"');
    expect(file.content).toContain('"return ""workflow"";"');
    expect(file.content).toContain('"metadata_json","code","error"\r\n');
    expect(file.content.startsWith('\uFEFF')).toBe(true);
  });
  it.each([
    '=SUM(1,2)',
    ' +danger',
    '-danger',
    '@danger',
    '\tformula',
  ])('neutralizes spreadsheet formulas: %s', (value) => {
    const input = structuredClone(records);
    input[0].summary.display_name = value;
    input[0].detail = { id: '1', script: value };
    const csv = serializeFunctionExport(input, 'csv', metadata).content;
    expect(csv).toContain(`"'${value}"`);
    expect(
      JSON.parse(serializeFunctionExport(input, 'json', metadata).content).functions[0].detail
        .script,
    ).toBe(value);
  });
  it('uses one combined Markdown file with source-safe fences and escaped headings', () => {
    const input = structuredClone(records);
    input[0].summary.display_name = '<script>\n# title';
    input[0].detail = { id: '1', script: '```\n#### not a heading\n````' };
    const file = serializeFunctionExport(input, 'markdown', metadata);
    expect(file.filename.endsWith('.md')).toBe(true);
    expect(file.content).toContain('## &lt;script&gt; \\# title');
    expect(file.content).toContain('`````deluge\n```\n#### not a heading\n````\n`````');
    expect(file.content).toContain('return "workflow";');
  });
  it('serializes large Markdown sources without exceeding the argument stack', () => {
    const source = '` x '.repeat(150_000);
    const input = [{ ...records[0], detail: { id: '1', script: source } }];
    expect(serializeFunctionExport(input, 'markdown', metadata).content).toContain(source);
  });
  it('uses string workflow source when an unknown script field is not text', () => {
    const input = [
      { ...records[0], detail: { id: '1', script: {} as string, workflow: 'return 1;' } },
    ];
    expect(serializeFunctionExport(input, 'csv', metadata).content).toContain('"return 1;"');
  });
  it.each([
    'json',
    'csv',
    'markdown',
  ] as const)('handles an empty org explicitly in %s', (format) => {
    expect(serializeFunctionExport([], format, metadata).content).toBeTruthy();
  });
  it.each([
    null,
    { id: '1' },
    { id: 'wrong', script: 'code' },
  ])('refuses incomplete exports (%j)', (detail) => {
    expect(() => serializeFunctionExport([{ ...records[0], detail }], 'json', metadata)).toThrow(
      'incomplete',
    );
  });
  it('lists skipped identities and safe reasons in every format', () => {
    const skipped = [
      { id: '3', name: '<Missing>', apiName: '=formula', reason: 'Zoho returned HTTP 503' },
    ];
    expect(
      JSON.parse(serializeFunctionExport(records, 'json', metadata, skipped).content).skipped,
    ).toEqual(skipped);
    const csv = serializeFunctionExport(records, 'csv', metadata, skipped).content;
    expect(csv).toContain('"3","<Missing>","\'=formula"');
    expect(csv).toContain('"Zoho returned HTTP 503"');
    const markdown = serializeFunctionExport(records, 'markdown', metadata, skipped).content;
    expect(markdown).toContain('## Not exported');
    expect(markdown).toContain('&lt;Missing&gt; (ID: 3, API name: =formula)');
  });
  it('rejects duplicate ids and unsafe format/filename inputs', () => {
    expect(() => serializeFunctionExport([records[0], records[0]], 'csv', metadata)).toThrow();
    expect(() =>
      serializeFunctionExport(records, 'json', { ...metadata, orgId: '../bad' }),
    ).toThrow();
    expect(isExportFormat('html')).toBe(false);
  });
});

describe('export entitlement orchestration', () => {
  it('registers a new premium feature with its one gate constant enforced', () => {
    expect(EXPORT_FUNCTIONS_GATE_ENFORCED).toBe(true);
    expect(getFeature('exportFunctions').tier).toBe('premium');
    expect(isFeatureAvailable(getFeature('exportFunctions'), FREE)).toBe(false);
    expect(isFeatureAvailable(getFeature('exportFunctions'), FREE, false)).toBe(true);
    expect(isFeatureAvailable(getFeature('functionSearch'), FREE)).toBe(true);
  });
  it.each(['plus', 'pro', 'max', 'future'])('exports for entitled %s', async (plan) => {
    const deps = dependencies();
    deps.getEntitlement = vi.fn(async () => ({ signedIn: true, entitlement: { ...pro, plan } }));
    await runFunctionExport(context, 'json', deps, new AbortController().signal);
    expect(deps.download).toHaveBeenCalledOnce();
    expect(deps.upgradeRequired).not.toHaveBeenCalled();
    expect(deps.state).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'complete', count: 2 }),
    );
    expect(deps.getEntitlement).toHaveBeenCalledWith();
  });
  it.each([
    { signedIn: false, entitlement: FREE },
    { signedIn: true, entitlement: FREE },
    ...['plus', 'pro', 'max', 'future'].map((plan) => ({
      signedIn: true,
      entitlement: { ...pro, plan, entitled: false },
    })),
    { signedIn: true, entitlement: { ...FREE, status: 'past_due' } },
    { signedIn: false, entitlement: pro },
  ])('requests upgrade without fetching any Zoho data for %j', async (account) => {
    const deps = dependencies();
    deps.getEntitlement = vi.fn(async () => account);
    await runFunctionExport(context, 'csv', deps, new AbortController().signal);
    expect(deps.upgradeRequired).toHaveBeenCalledOnce();
    expect(deps.load).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
  });
  it('downloads partial results and reports successful versus total counts', async () => {
    const deps = dependencies();
    deps.load = vi.fn(async () => ({
      records,
      skipped: [{ id: '3', name: 'Missing', apiName: 'missing', reason: 'Zoho returned HTTP 503' }],
    }));
    await runFunctionExport(context, 'json', deps, new AbortController().signal);
    expect(deps.download).toHaveBeenCalledOnce();
    expect(deps.state).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'complete', count: 2, total: 3, skipped: 1 }),
    );
    deps.load = vi.fn(async () => ({ records: [], skipped: [] }));
    vi.mocked(deps.download).mockClear();
    await runFunctionExport(context, 'json', deps, new AbortController().signal);
    expect(deps.download).not.toHaveBeenCalled();
  });
  it('finishes signed-out-pending storage recovery exactly once', async () => {
    const deps = dependencies();
    deps.getEntitlement = vi
      .fn()
      .mockResolvedValueOnce({ signedIn: false, signedOutPending: true, entitlement: FREE })
      .mockResolvedValueOnce({ signedIn: true, entitlement: pro });
    await runFunctionExport(context, 'json', deps, new AbortController().signal);
    expect(deps.getEntitlement).toHaveBeenCalledTimes(2);
    expect(deps.download).toHaveBeenCalledOnce();
  });
  it('treats unavailable entitlement as Free', async () => {
    const deps = dependencies();
    deps.getEntitlement = vi.fn().mockRejectedValue(new Error('offline'));
    await runFunctionExport(context, 'json', deps, new AbortController().signal);
    expect(deps.upgradeRequired).toHaveBeenCalledOnce();
    expect(deps.load).not.toHaveBeenCalled();
  });
  it('never downloads after list failure, cancellation, or org navigation', async () => {
    for (const failure of ['load', 'abort', 'navigate']) {
      const deps = dependencies();
      const controller = new AbortController();
      deps.load = vi.fn(async () => {
        if (failure === 'load') throw new Error('private source must not reach events');
        if (failure === 'abort') controller.abort();
        if (failure === 'navigate') deps.contextIsCurrent = () => false;
        return { records, skipped: [] };
      });
      await runFunctionExport(context, 'markdown', deps, controller.signal);
      expect(deps.download).not.toHaveBeenCalled();
      expect(deps.state).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error' }));
      expect(JSON.stringify(vi.mocked(deps.state).mock.calls)).not.toContain('private source');
    }
  });
});

describe('fresh Zoho export loading', () => {
  it('retries 429/5xx in pool slots, honors Retry-After, and reports persistent failures', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const attempts = new Map<string, number>();
      const times: number[] = [];
      const request = vi.fn(async (url: string) => {
        if (url.includes('/settings/functions?'))
          return Response.json({
            functions: [
              { id: '1', display_name: 'Unavailable', api_name: 'missing', source: 'crm' },
              { id: '2', display_name: 'Extension', source: 'extension' },
              { id: '3', display_name: 'Transient', source: 'crm' },
            ],
          });
        const parsed = new URL(url);
        const id = parsed.pathname.split('/').at(-1) as string;
        const count = (attempts.get(id) ?? 0) + 1;
        attempts.set(id, count);
        if (id === '1') {
          times.push(Date.now());
          return new Response(null, { status: 503, headers: { 'Retry-After': '2' } });
        }
        if (id === '3' && count === 1)
          return new Response(null, {
            status: 429,
            headers: { 'Retry-After': new Date(Date.now() + 3000).toUTCString() },
          });
        expect(parsed.searchParams.get('source')).toBe(id === '2' ? 'extension' : 'crm');
        return Response.json({ functions: [{ id, script: 'info 1;' }] });
      });
      const progress = vi.fn();
      const pending = loadExportFunctions(context, progress, new AbortController().signal, request);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.records.map((r) => r.summary.id)).toEqual(['2', '3']);
      expect(result.skipped).toEqual([
        { id: '1', name: 'Unavailable', apiName: 'missing', reason: 'Zoho returned HTTP 503' },
      ]);
      expect(attempts.get('1')).toBe(4);
      expect(attempts.get('3')).toBe(2);
      expect(times[1] - times[0]).toBe(2000);
      expect(times[3] - times[2]).toBe(2125);
      expect(progress).toHaveBeenLastCalledWith({ loaded: 3, total: 3 });
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
  it('cancels during retry backoff without further requests', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const request = vi.fn(async (url: string) =>
        url.includes('/settings/functions?')
          ? Response.json({ functions: [records[0].summary] })
          : new Response(null, { status: 503 }),
      );
      const pending = loadExportFunctions(context, () => {}, controller.signal, request);
      const rejected = expect(pending).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(1);
      controller.abort();
      await rejected;
      await vi.runAllTimersAsync();
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('reuses pagination/detail contracts with at most four concurrent details and no billing calls', async () => {
    const summaries = Array.from({ length: 201 }, (_, i) => ({
      id: String(i + 1),
      display_name: `Function ${i}`,
      category: 'Standalone',
    }));
    let active = 0;
    let maxActive = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(new URL(url).origin).toBe(context.origin);
      expect(init?.credentials).toBe('include');
      expect(init?.redirect).toBe('error');
      expect(init?.headers).toMatchObject({ 'X-Crm-Org': '42' });
      if (url.includes('/settings/functions?')) {
        const start = Number(new URL(url).searchParams.get('start'));
        return Response.json({ functions: summaries.slice(start - 1, start - 1 + 200) });
      }
      active++;
      maxActive = Math.max(active, maxActive);
      await Promise.resolve();
      active--;
      const id = new URL(url).pathname.split('/').at(-1);
      return Response.json({ functions: [{ id, script: `return ${id};` }] });
    });
    const progress = vi.fn();
    const loaded = await loadExportFunctions(
      context,
      progress,
      new AbortController().signal,
      fetchImpl,
    );
    expect(loaded.records).toHaveLength(201);
    expect(loaded.records[200].detail?.script).toBe('return 201;');
    expect(maxActive).toBe(4);
    expect(fetchImpl).toHaveBeenCalledTimes(203);
    expect(progress).toHaveBeenLastCalledWith({ loaded: 201, total: 201 });
  });
  it.each([204, 403])('reports unreadable detail HTTP %s without retrying', async (status) => {
    const request = vi.fn(async (url: string) => {
      if (url.includes('/settings/functions?'))
        return Response.json({ functions: records.map((r) => r.summary) });
      return url.includes('/functions/1?')
        ? new Response(null, { status })
        : Response.json({ functions: [records[1].detail] });
    });
    const result = await loadExportFunctions(
      context,
      () => {},
      new AbortController().signal,
      request,
    );
    expect(result.records).toHaveLength(1);
    expect(result.skipped[0].id).toBe('1');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('rejects repeated pages, duplicate ids and unsafe ids before requesting details', async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1) }));
    for (const functions of [
      fullPage,
      [{ id: '1' }, { id: '1' }],
      [{ id: '../other' }],
      [{ id: Number.MAX_SAFE_INTEGER + 1 }],
    ]) {
      const request = vi.fn(async () => Response.json({ functions }));
      await expect(
        loadExportFunctions(context, () => {}, new AbortController().signal, request),
      ).rejects.toThrow('Invalid functions list');
      expect(request).toHaveBeenCalledTimes(functions === fullPage ? 2 : 1);
    }
  });
  it.each([
    { functions: [{ script: 'info 1;' }] },
    {
      functions: [
        { id: '1', script: 'info 1;' },
        { id: '2', script: 'info 2;' },
      ],
    },
  ])('rejects ambiguous detail identity %j', async ({ functions }) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ functions: [records[0].summary] }))
      .mockResolvedValueOnce(Response.json({ functions }));
    await expect(
      loadExportFunctions(context, () => {}, new AbortController().signal, request),
    ).rejects.toThrow('No function sources');
  });
  it('rejects malformed lists rather than silently exporting a partial/empty backup', async () => {
    for (const body of [{}, { functions: [{ display_name: 'missing id' }] }]) {
      await expect(
        loadExportFunctions(
          context,
          () => {},
          new AbortController().signal,
          vi.fn(async () => Response.json(body)),
        ),
      ).rejects.toThrow('Invalid functions list');
    }
  });
  it('makes no requests after pre-cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn();
    await expect(
      loadExportFunctions(context, () => {}, controller.signal, request),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('unstyled frontend hooks', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    history.replaceState({}, '', '/org42/settings/functions');
  });
  afterEach(() => {
    document.body.replaceChildren();
  });
  it('exposes request/state events and the upgrade hook for Free users without fetching functions', async () => {
    const root = document.createElement('section');
    document.body.append(root);
    const deps = dependencies();
    deps.getEntitlement = vi.fn(async () => ({ signedIn: false, entitlement: FREE }));
    const { upgradeRequired: _upgradeRequired, ...overrides } = deps;
    const dispose = mountFunctionExport(root, overrides);
    const upgraded = vi.fn();
    document.addEventListener(UPGRADE_REQUIRED_EVENT, upgraded);
    root.dispatchEvent(new CustomEvent(EXPORT_REQUEST_EVENT, { detail: { format: 'json' } }));
    await vi.waitFor(() => expect(root.dataset.exportState).toBe('upgrade-required'));
    expect(deps.load).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect((document.querySelector('[data-zcdt-upgrade-modal]') as HTMLElement).hidden).toBe(
        false,
      ),
    );
    expect((upgraded.mock.calls[0][0] as CustomEvent).detail).toEqual({
      featureId: 'exportFunctions',
      reason: 'paid-required',
    });
    expect(root.querySelector('[data-zcdt-export-run]')).not.toBeNull();
    dispose();
    document.removeEventListener(UPGRADE_REQUIRED_EVENT, upgraded);
    expect(root.children.length).toBe(0);
  });
  it.each([
    '<div><div class="search-function"><lyte-input id="functionSearch"></lyte-input></div></div>',
    '<div><div data-zcqa="fxn_lv_search_parent"><input data-zcqa="fxn_lv_search"></div></div>',
    '<div><button>Create Function</button></div>',
  ])('mounts once immediately right of Search in each toolbar and disposes on departure: %s', async (markup) => {
    let scan = () => {};
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback: () => void) {
          scan = callback;
        }
        observe() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    document.body.innerHTML = markup;
    try {
      await bootstrapFunctionSearch();
      scan();
      expect(document.querySelectorAll('#zcdt-function-export')).toHaveLength(1);
      expect(document.querySelector('#zcdt-function-search-button')?.nextElementSibling?.id).toBe(
        'zcdt-function-export',
      );
      history.replaceState({}, '', '/org42/settings/other');
      scan();
      expect(document.querySelector('#zcdt-function-export')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('coalesces repeated requests while busy and emits completion without source payloads', async () => {
    const root = document.createElement('section');
    document.body.append(root);
    const deps = dependencies();
    const dispose = mountFunctionExport(root, deps);
    const changed = vi.fn();
    root.addEventListener(EXPORT_STATE_EVENT, changed);
    const request = () =>
      root.dispatchEvent(new CustomEvent(EXPORT_REQUEST_EVENT, { detail: { format: 'markdown' } }));
    request();
    request();
    await vi.waitFor(() => expect(deps.download).toHaveBeenCalledOnce());
    // One non-blocking read for the PRO badge at mount, one for the export gate itself.
    expect(deps.getEntitlement).toHaveBeenCalledTimes(2);
    expect(root.getAttribute('aria-busy')).toBe('false');
    expect((changed.mock.calls.at(-1)?.[0] as CustomEvent).detail).toMatchObject({
      status: 'complete',
      format: 'markdown',
      count: 2,
    });
    expect(changed.mock.calls.every(([event]) => !(event as CustomEvent).detail.functions)).toBe(
      true,
    );
    dispose();
  });
});
