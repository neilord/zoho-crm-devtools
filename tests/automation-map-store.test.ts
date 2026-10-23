import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeDelugeEffects,
  DELUGE_EFFECTS_VERSION,
} from '../src/content/automation-map/analyzer';
import { AutomationMapStore, chooseRevealedModule } from '../src/content/automation-map/data/store';
import { buildAutomationGraph } from '../src/content/automation-map/graph/build';
import type {
  AutomationGraphInputs,
  AutomationMapSnapshot,
} from '../src/content/automation-map/types';
import { WorkflowIndex } from '../src/content/workflows/workflow-store';
import type { AutomationMapCache } from '../src/shared/automation-map-cache-protocol';
import { workflowCacheMessage } from '../src/shared/browser';
import {
  account,
  catalogue,
  context,
  graph,
  moduleWire,
  rule,
  syntheticFetch,
} from './automation-map-data-fixtures';

vi.mock('../src/shared/browser', async (original) => ({
  ...(await original<typeof import('../src/shared/browser')>()),
  workflowCacheMessage: vi.fn(async () => null),
}));
const stores: AutomationMapStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  vi.restoreAllMocks();
});
function setup(options: Partial<ConstructorParameters<typeof AutomationMapStore>[0]> = {}) {
  const snapshots: AutomationMapSnapshot[] = [],
    builds: AutomationGraphInputs[] = [],
    fetch = vi.fn(syntheticFetch()),
    cache = vi.fn(async () => null as AutomationMapCache | null);
  const buildGraph = vi.fn((inputs: AutomationGraphInputs) => {
    builds.push(inputs);
    return graph(inputs);
  });
  const store = new AutomationMapStore({
    context,
    fetch,
    cache,
    buildGraph,
    getEntitlement: async () => account(),
    ...options,
  });
  stores.push(store);
  store.subscribe((s) => snapshots.push(s));
  return { store, snapshots, builds, fetch, cache, buildGraph };
}
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
};

describe('AutomationMapStore access and loading', () => {
  it('chooses 2–12 active rules, descending volume then label, without mutating candidates', () => {
    const candidates = [
      { apiName: 'TooMany', label: 'A', activeRules: 13 },
      { apiName: 'Pear', label: 'Pear', activeRules: 6 },
      { apiName: 'Apple', label: 'Apple', activeRules: 6 },
      { apiName: 'Few', label: 'Few', activeRules: 1 },
    ];
    expect(chooseRevealedModule(candidates)).toBe('Apple');
    expect(candidates[0].apiName).toBe('TooMany');
    expect(chooseRevealedModule([])).toBeNull();
  });
  it('gates all I/O behind access, publishes progressive snapshots and analyzes every function', async () => {
    const access = deferred<ReturnType<typeof account>>();
    const { store, snapshots, builds, fetch, cache } = setup({
      getEntitlement: () => access.promise,
    });
    const load = store.start();
    expect(fetch).not.toHaveBeenCalled();
    expect(cache).not.toHaveBeenCalled();
    expect(snapshots.at(-1)?.access.level).toBe('checking');
    access.resolve(account());
    await load;
    const final = snapshots[snapshots.length - 1];
    expect(final.access).toEqual({ level: 'full' });
    expect(final.phase).toBe('complete');
    expect(final.coverage).toMatchObject({
      rules: { listed: 2, detailed: 2 },
      functions: { listed: 1, analyzed: 1, pending: 0 },
      buttons: { state: 'loaded' },
      isComplete: true,
    });
    expect(
      snapshots.some((s) => s.phase === 'enriching' && s.coverage.functions.analyzed === 0),
    ).toBe(true);
    expect(builds.at(-1)?.functions[0].effects?.writes[0].fields[0].apiName).toBe('Harvest');
    expect(cache.mock.calls).toHaveLength(2);
  });
  it.each([
    ['signed-out', { ...account('free'), signedIn: false }],
    ['free', account('free')],
    ['lower-plan', account('plus')],
    ['unavailable', { ...account(), failed: true as const }],
  ])('uses a %s teaser with a strict URL allowlist and count-only fog', async (reason, state) => {
    const fetch = vi.fn(
      syntheticFetch((url) => {
        if (url.pathname === '/crm/v2/settings/functions')
          return Response.json({ functions: [catalogue(), catalogue('502', 'Secret gardens')] });
        if (url.pathname.endsWith('/modules'))
          return Response.json({
            modules: [moduleWire(), moduleWire('SecretApi', 'Secret label', 'Secret gardens')],
          });
        if (url.pathname.endsWith('/workflow_rules'))
          return Response.json({
            workflow_rules: [
              rule(),
              rule('102'),
              { ...rule('103', 'SecretApi'), name: 'Secret rule name' },
            ],
            info: { more_records: false },
          });
        return undefined;
      }),
    );
    const { store, snapshots, cache, builds } = setup({ fetch, getEntitlement: async () => state });
    await store.start();
    const final = snapshots[snapshots.length - 1];
    expect(final.access).toEqual({ level: 'teaser', revealedModuleApiName: 'Orchards', reason });
    expect(cache).not.toHaveBeenCalled();
    const urls = fetch.mock.calls.map(([url]) => new URL(String(url)));
    for (const url of urls) {
      expect(url.origin).toBe(context.origin);
      expect([
        '/crm/v2/settings/functions',
        '/crm/v2/settings/functions/501',
        '/crm/v8/settings/automation/workflow_rules',
        '/crm/v8/settings/automation/workflow_rules/101',
        '/crm/v8/settings/automation/functions/301',
        '/crm/v8/settings/modules',
        '/crm/v2.2/settings/modules',
      ]).toContain(url.pathname);
    }
    const fog = JSON.stringify(final.teaser?.fogged);
    for (const secret of ['Secret', 'Orchards', '502', '103', 'label', 'name', 'id', 'api'])
      expect(fog).not.toContain(secret);
    expect(final.teaser?.fogged).toEqual([
      { slot: 0, counts: { rules: 1, functions: 1, buttons: 0, schedules: 0 }, recordWrites: 1 },
    ]);
    expect(builds.at(-1)?.rules).toHaveLength(1);
    expect(builds.at(-1)?.functions).toHaveLength(1);
  });
  it('reports revealed sibling rules only on the module and partitions rule totals exactly', async () => {
    const { store, snapshots } = setup({
      getEntitlement: async () => account('plus'),
      buildGraph: buildAutomationGraph,
      fetch: syntheticFetch((url) => {
        if (url.pathname.endsWith('/modules'))
          return Response.json({
            modules: [moduleWire(), moduleWire('Hidden', 'Hidden', 'Hiddens')],
          });
        if (url.pathname.endsWith('/workflow_rules'))
          return Response.json({ workflow_rules: [rule(), rule('102'), rule('103', 'Hidden')] });
        return undefined;
      }),
    });
    await store.start();
    const final = snapshots[snapshots.length - 1];
    const revealed = final.graph.nodes.get('module:Orchards');
    expect(revealed?.kind).toBe('module');
    if (revealed?.kind !== 'module') throw new Error('Missing revealed module');
    expect(revealed.counts.rules).toBe(2);
    expect([...final.graph.nodes.values()].filter((n) => n.kind === 'rule')).toHaveLength(1);
    expect(final.teaser?.fogged.map((f) => f.counts.rules)).toEqual([1]);
    expect(
      revealed.counts.rules + (final.teaser?.fogged ?? []).reduce((n, f) => n + f.counts.rules, 0),
    ).toBe(final.teaser?.totals.rules);
    expect(final.graph.modules[0].counts).toEqual(revealed.counts);
  });
  it('counts CRM write call sites once per catalogue function in each fogged module', async () => {
    const hidden = catalogue('502', 'Hiddens');
    hidden.associated_place.push({ ...hidden.associated_place[0], id: '104' });
    hidden.tasks.integrations.push(
      { service: 'crm', function: 'createRecord' },
      { service: 'ZohoCRM', function: 'zoho.crm.updateRecord' },
      { service: 'ZohoCRM', function: 'getRecordById' },
      { service: 'ZohoBooks', function: 'updateRecord' },
    );
    const { store, snapshots } = setup({
      getEntitlement: async () => account('plus'),
      fetch: syntheticFetch((url) => {
        if (url.pathname === '/crm/v2/settings/functions')
          return Response.json({
            functions: [catalogue(), catalogue('504'), hidden, hidden, catalogue('503', 'Hiddens')],
          });
        if (url.pathname.endsWith('/modules'))
          return Response.json({
            modules: [moduleWire(), moduleWire('Hidden', 'Hidden', 'Hiddens')],
          });
        return undefined;
      }),
    });
    await store.start();
    const fog = snapshots.at(-1)?.teaser?.fogged ?? [];
    // Two functions, three + one call sites; duplicate rows/associations add nothing.
    expect(fog.map((f) => [f.counts.functions, f.recordWrites])).toEqual([[2, 4]]);
  });
  it('enforces teaser detail caps and upgrades on explicit refreshAccess', async () => {
    let state = account('plus');
    const fetch = vi.fn(
      syntheticFetch((url) => {
        if (url.pathname.endsWith('/workflow_rules'))
          return Response.json({
            workflow_rules: Array.from({ length: 30 }, (_, n) => ({
              ...rule(String(100 + n)),
              status: { active: n < 12 },
            })),
            info: { more_records: false },
          });
        if (url.pathname === '/crm/v2/settings/functions')
          return Response.json({
            functions: Array.from({ length: 20 }, (_, n) => catalogue(String(500 + n))),
          });
        return undefined;
      }),
    );
    const { store, snapshots, cache } = setup({ fetch, getEntitlement: async () => state });
    await store.start();
    const paths = fetch.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths.filter((p) => /workflow_rules\/\d+$/.test(p))).toHaveLength(1);
    expect(paths.filter((p) => /settings\/functions\/\d+$/.test(p))).toHaveLength(1);
    expect(cache).not.toHaveBeenCalled();
    state = account('max');
    await store.refreshAccess();
    expect(snapshots.at(-1)?.access.level).toBe('full');
    expect(cache).toHaveBeenCalled();
  });
  it('keeps a no-candidate teaser at metadata only, and recovers pending entitlement once', async () => {
    const getEntitlement = vi
      .fn()
      .mockResolvedValueOnce({ ...account('free'), signedIn: false, signedOutPending: true })
      .mockResolvedValue(account('plus'));
    const fetch = vi.fn(
      syntheticFetch((url) =>
        url.pathname.endsWith('/workflow_rules')
          ? Response.json({ workflow_rules: [rule()], info: { more_records: false } })
          : undefined,
      ),
    );
    const { store, snapshots } = setup({ fetch, getEntitlement });
    await store.start();
    expect(getEntitlement).toHaveBeenCalledTimes(2);
    expect(snapshots.at(-1)?.access).toMatchObject({
      level: 'teaser',
      revealedModuleApiName: null,
    });
    expect(fetch.mock.calls.some(([url]) => /settings\/functions\/\d+/.test(String(url)))).toBe(
      false,
    );
  });
  it('shares strict function source/catalogue reads with WorkflowIndex on a non-workflow route', async () => {
    const fetch = vi.fn(
      syntheticFetch((url) => {
        if (/workflow_rules\/\d+$/.test(url.pathname))
          return Response.json({
            workflow_rules: [
              {
                ...rule(url.pathname.split('/').at(-1)),
                conditions: [{ instant_actions: { actions: [{ id: '301', type: 'functions' }] } }],
              },
            ],
          });
        if (url.pathname.endsWith('/automation/functions/301'))
          return Response.json({
            functions: [{ id: '301', function: { api_name: 'fn_501', id: 'different' } }],
          });
        return undefined;
      }),
    );
    const { store, snapshots, builds } = setup({ fetch });
    await store.start();
    expect(
      fetch.mock.calls.filter(
        ([url]) => new URL(String(url)).pathname === '/crm/v2/settings/functions',
      ),
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(
        ([url]) => new URL(String(url)).pathname === '/crm/v2/settings/functions/501',
      ),
    ).toHaveLength(1);
    expect(builds.at(-1)?.rules[0].conditions[0].instantActions[0]).toMatchObject({
      kind: 'function',
      delugeFunctionId: '501',
      sourceState: 'available',
    });
    expect(snapshots.at(-1)?.coverage.isComplete).toBe(true);
  });
  it('shows warm graph immediately while revalidation waits and reuses effects by revision/version', async () => {
    let saved: AutomationMapCache | null = null;
    const cache = vi.fn(
      async (
        message: Parameters<
          NonNullable<ConstructorParameters<typeof AutomationMapStore>[0]['cache']>
        >[0],
      ) => {
        if (message.type === 'automationMap:writeCache')
          saved = message.value as AutomationMapCache;
        return saved;
      },
    );
    const first = setup({ cache });
    await first.store.start();
    expect(saved).not.toBeNull();
    const barrier = deferred<Response>(),
      analyze = vi.fn(analyzeDelugeEffects);
    const request = vi.fn(
      syntheticFetch((url) =>
        url.pathname === '/crm/v2/settings/functions' ? barrier.promise : undefined,
      ),
    );
    const second = setup({ cache, analyze, fetch: request });
    const load = second.store.refresh();
    await vi.waitFor(() =>
      expect(
        second.snapshots.some((s) => s.coverage.refreshing && s.coverage.functions.analyzed === 1),
      ).toBe(true),
    );
    expect(second.builds[0].functions[0].sourceText).toContain('Harvest');
    barrier.resolve(Response.json({ functions: [catalogue()] }));
    await load;
    expect(analyze).not.toHaveBeenCalled();
    expect(
      request.mock.calls.filter(([url]) => String(url).includes('/settings/functions/501')),
    ).toHaveLength(0);
    // An analyzer-version mismatch must reanalyze unchanged cached source without refetching it.
    const current = saved as unknown as AutomationMapCache;
    current.inputs.functions[0].effects = {
      ...analyzeDelugeEffects(current.inputs.functions[0].sourceText ?? ''),
      analyzerVersion: DELUGE_EFFECTS_VERSION - 1,
    };
    const third = setup({ cache, analyze });
    await third.store.start();
    expect(analyze).toHaveBeenCalledTimes(1);
  });
  it('refetches changed revisions and treats cache read/write failures as advisory', async () => {
    let cached: AutomationMapCache | null = null;
    const first = setup({
      cache: async (message) => {
        if (message.type === 'automationMap:writeCache')
          cached = message.value as AutomationMapCache;
        return null;
      },
    });
    await first.store.start();
    const fetch = vi.fn(
      syntheticFetch((url) =>
        url.pathname === '/crm/v2/settings/functions'
          ? Response.json({ functions: [{ ...catalogue(), updatedTime: 'changed' }] })
          : undefined,
      ),
    );
    const analyze = vi.fn(analyzeDelugeEffects),
      second = setup({
        fetch,
        analyze,
        cache: async (message) => {
          if (message.type === 'automationMap:readCache') return cached;
          throw new Error('storage full');
        },
      });
    await second.store.refresh();
    expect(analyze).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/settings/functions/501'))).toBe(
      true,
    );
    expect(second.snapshots.at(-1)?.phase).toBe('complete');
    const third = setup({
      cache: async () => {
        throw new Error('storage disabled');
      },
    });
    await third.store.start();
    expect(third.snapshots.at(-1)?.coverage.isComplete).toBe(true);
  });
  it('retains cached source on failed refresh without certifying the new revision and retries one dependency', async () => {
    let saved: AutomationMapCache | null = null;
    const cache = async (
      message: Parameters<
        NonNullable<ConstructorParameters<typeof AutomationMapStore>[0]['cache']>
      >[0],
    ) => {
      if (message.type === 'automationMap:writeCache') saved = message.value as AutomationMapCache;
      return saved;
    };
    await setup({ cache }).store.start();
    let fail = true;
    const fetch = vi.fn(
      syntheticFetch((url) => {
        if (url.pathname === '/crm/v2/settings/functions')
          return Response.json({ functions: [{ ...catalogue(), updatedTime: 'changed' }] });
        if (url.pathname === '/crm/v2/settings/functions/501' && fail)
          return new Response(null, { status: 403 });
        return undefined;
      }),
    );
    const next = setup({ cache, fetch });
    await next.store.refresh();
    expect(next.snapshots.at(-1)?.coverage.functions.failed).toBe(1);
    expect(next.builds.at(-1)?.functions[0].sourceText).toContain('Harvest');
    expect(
      (saved as unknown as AutomationMapCache).inputs.functions[0].summary.updatedTime,
    ).toBeUndefined();
    const before = fetch.mock.calls.length;
    fail = false;
    await next.store.retry('source:501');
    expect(fetch.mock.calls.slice(before)).toHaveLength(1);
    expect(next.snapshots.at(-1)?.coverage.functions.analyzed).toBe(1);
  });
  it('retries entry-point failures in isolation and rechecks access before retry', async () => {
    let fail = true,
      state = account();
    const fetch = vi.fn(
      syntheticFetch((url) =>
        url.pathname.endsWith('/schedules') && fail
          ? new Response(null, { status: 403 })
          : undefined,
      ),
    );
    const { store, snapshots } = setup({ fetch, getEntitlement: async () => state });
    await store.start();
    const failure = snapshots.at(-1)?.coverage.failures.find((f) => f.id === 'schedules');
    expect(failure).toBeDefined();
    const before = fetch.mock.calls.length;
    fail = false;
    await failure?.retry();
    expect(fetch.mock.calls.slice(before)).toHaveLength(1);
    expect(snapshots.at(-1)?.coverage.schedules).toMatchObject({ state: 'loaded', failed: 0 });
    state = account('plus');
    await store.retry();
    expect(snapshots.at(-1)?.access.level).toBe('teaser');
  });
  it.each([
    'dispose',
    'abort',
    'org-change',
    'refresh',
  ] as const)('suppresses late work after %s', async (mode) => {
    const barrier = deferred<Response>(),
      signal = new AbortController();
    let current = true;
    const fetch = vi.fn(
      syntheticFetch((url) =>
        url.pathname === '/crm/v2/settings/functions' ? barrier.promise : undefined,
      ),
    );
    const { store, snapshots, cache } = setup({
      fetch,
      signal: signal.signal,
      isCurrentContext: () => current,
    });
    const load = store.start();
    await vi.waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(0));
    if (mode === 'dispose') store.dispose();
    if (mode === 'abort') signal.abort();
    if (mode === 'org-change') current = false;
    let refresh: Promise<void> | undefined;
    if (mode === 'refresh') {
      store.dispose();
      refresh = store.refreshAccess();
    }
    const before = snapshots.length;
    barrier.resolve(Response.json({ functions: [catalogue()] }));
    await load;
    await refresh;
    expect(snapshots).toHaveLength(before);
    expect(cache.mock.calls.length).toBe(1);
  });
  it('cancels an obsolete entitlement check when refreshAccess starts a new access generation', async () => {
    const first = deferred<ReturnType<typeof account>>();
    let reads = 0;
    const { store, snapshots } = setup({
      getEntitlement: () => (++reads === 1 ? first.promise : Promise.resolve(account('plus'))),
    });
    const old = store.start(),
      fresh = store.refreshAccess();
    first.resolve(account());
    await Promise.all([old, fresh]);
    expect(snapshots.at(-1)?.access.level).toBe('teaser');
    expect(snapshots.filter((s) => s.access.level === 'full')).toHaveLength(0);
  });
});

it('WorkflowIndex injected route predicate still stops work on route departure', async () => {
  let current = true;
  const barrier = deferred<Response>();
  const index = new WorkflowIndex({
    context,
    fetch: vi.fn(async () => barrier.promise),
    hasAccess: async () => true,
    isCurrentRoute: () => current,
    getCatalogue: async () => [],
    getFunctionSource: async () => null,
  });
  const snapshots: unknown[] = [];
  index.subscribe((s) => snapshots.push(s));
  const load = index.load(new AbortController().signal);
  await vi.waitFor(() => expect(vi.mocked(workflowCacheMessage)).toHaveBeenCalled());
  current = false;
  const before = snapshots.length;
  barrier.resolve(Response.json({ workflow_rules: [rule()], info: { more_records: false } }));
  await load.catch(() => {});
  expect(snapshots).toHaveLength(before);
  index.dispose();
});

it('respects the shared request budget, yields between analyses and throttles graph builds', async () => {
  let active = 0,
    peak = 0;
  const yieldPage = vi.fn(async () => {});
  vi.stubGlobal('scheduler', { yield: yieldPage });
  const base = syntheticFetch((url) =>
    url.pathname === '/crm/v2/settings/functions'
      ? Response.json({
          functions: Array.from({ length: 16 }, (_, i) => catalogue(String(500 + i))),
        })
      : undefined,
  );
  const fetch: typeof globalThis.fetch = async (input, init) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return await base(input, init);
    } finally {
      active--;
    }
  };
  const times: number[] = [];
  const { store, snapshots } = setup({
    fetch,
    buildGraph: (inputs) => {
      times.push(Date.now());
      return graph(inputs);
    },
  });
  try {
    await store.start();
    expect(peak).toBeLessThanOrEqual(4);
    expect(yieldPage).toHaveBeenCalled();
    for (let i = 1; i < times.length; i++)
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(495);
    const partial = snapshots.find(
      (s) => s.coverage.functions.listed > 0 && s.coverage.functions.pending > 0,
    );
    expect(partial?.coverage.functions.analyzed).toBeLessThan(16);
    expect(snapshots.at(-1)?.coverage.functions.analyzed).toBe(16);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('discovers sources after retrying a failed full catalogue without restarting other lists', async () => {
  let fail = true;
  const fetch = vi.fn(
    syntheticFetch((url) =>
      url.pathname === '/crm/v2/settings/functions' && fail
        ? new Response(null, { status: 403 })
        : undefined,
    ),
  );
  const { store, snapshots } = setup({ fetch });
  await store.start();
  expect(snapshots.at(-1)?.phase).toBe('failed');
  const before = fetch.mock.calls.length;
  fail = false;
  await store.retry('catalogue');
  expect(fetch.mock.calls.slice(before).map(([u]) => new URL(String(u)).pathname)).toEqual([
    '/crm/v2/settings/functions',
    '/crm/v2/settings/functions/501',
  ]);
  expect(snapshots.at(-1)?.coverage.functions.analyzed).toBe(1);
});

it('can retry failed teaser metadata and then reveal only the bounded island', async () => {
  let fail = true;
  const fetch = vi.fn(
    syntheticFetch((url) =>
      url.pathname === '/crm/v2/settings/functions' && fail
        ? new Response(null, { status: 403 })
        : undefined,
    ),
  );
  const { store, snapshots, cache } = setup({ fetch, getEntitlement: async () => account('plus') });
  await store.start();
  expect(snapshots.at(-1)?.teaser).toBeNull();
  fail = false;
  await store.retry('catalogue');
  expect(snapshots.at(-1)?.access).toMatchObject({
    level: 'teaser',
    revealedModuleApiName: 'Orchards',
  });
  expect(snapshots.at(-1)?.coverage.functions.analyzed).toBe(1);
  expect(cache).not.toHaveBeenCalled();
});

it('retries a failed blueprint transition while retaining successful transitions', async () => {
  let fail = true;
  const fetch = vi.fn(
    syntheticFetch((url) => {
      if (url.pathname.endsWith('/blueprints'))
        return Response.json({
          blueprints: [
            { id: '701', name: 'Invented', module: { api_name: 'Orchards' }, active: true },
          ],
          info: { more_records: false },
        });
      if (url.pathname.endsWith('/701/transitions'))
        return Response.json({
          transitions: [{ id: '711' }, { id: '712' }],
          info: { more_records: false },
        });
      if (url.pathname.endsWith('/transitions/712') && fail)
        return new Response(null, { status: 403 });
      if (/\/transitions\/71[12]$/.test(url.pathname))
        return Response.json({
          transitions: [
            { id: url.pathname.split('/').at(-1), name: 'Advance', during_inputs: [], actions: [] },
          ],
        });
      return undefined;
    }),
  );
  const { store, builds, snapshots } = setup({ fetch });
  await store.start();
  expect(builds.at(-1)?.transitions).toHaveLength(1);
  expect(snapshots.at(-1)?.coverage.blueprints.failed).toBe(1);
  fail = false;
  const before = fetch.mock.calls.length;
  await store.retry('blueprints:transition:712');
  expect(fetch.mock.calls.slice(before)).toHaveLength(1);
  expect(builds.at(-1)?.transitions).toHaveLength(2);
  expect(snapshots.at(-1)?.coverage.blueprints.failed).toBe(0);
});

it('reports unavailable/limited/unsupported sources honestly and queries buttons only for workflow modules', async () => {
  const fetch = vi.fn(
    syntheticFetch((url) => {
      if (url.pathname === '/crm/v2/settings/functions')
        return Response.json({
          functions: [
            catalogue('501'),
            catalogue('502'),
            { ...catalogue('503'), language: 'javascript' },
          ],
        });
      if (url.pathname === '/crm/v2/settings/functions/501')
        return new Response(null, { status: 204 });
      if (url.pathname === '/crm/v8/settings/modules')
        return Response.json({
          modules: [moduleWire(), moduleWire('Hidden', 'Hidden', 'Hidden modules')],
        });
      return undefined;
    }),
  );
  const { store, snapshots } = setup({
    fetch,
    analyze: (source, options) => {
      const effects = analyzeDelugeEffects(source, options);
      return options?.functionId === '502'
        ? { ...effects, analysis: { ...effects.analysis, status: 'limited' } }
        : effects;
    },
  });
  await store.start();
  expect(snapshots.at(-1)?.coverage.functions).toMatchObject({
    sourceUnavailable: 1,
    limited: 1,
    unsupported: 1,
    analyzed: 0,
  });
  expect(snapshots.at(-1)?.coverage.isComplete).toBe(false);
  expect(
    fetch.mock.calls
      .filter(([u]) => String(u).includes('/custom_buttons'))
      .map(([u]) => new URL(String(u)).searchParams.get('module')),
  ).toEqual(['Orchards']);
});

it('guards the default live origin/org context when the CRM org segment disappears', async () => {
  const live = { origin: context.origin, pathname: '/crm/org123/settings/functions' };
  vi.stubGlobal('location', live);
  const barrier = deferred<Response>();
  const { store, snapshots } = setup({
    fetch: syntheticFetch((url) =>
      url.pathname === '/crm/v2/settings/functions' ? barrier.promise : undefined,
    ),
  });
  try {
    const load = store.start();
    await vi.waitFor(() => expect(snapshots.some((s) => s.access.level === 'full')).toBe(true));
    live.pathname = '/crm/';
    const before = snapshots.length;
    barrier.resolve(Response.json({ functions: [catalogue()] }));
    await load;
    expect(snapshots).toHaveLength(before);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('serializes the entire teaser snapshot without fogged catalogue identities or metadata', async () => {
  const secrets = [
    'HiddenApi',
    '904',
    'Hidden singular',
    'Hidden plural',
    '903',
    'Hidden rule',
    '902',
    'Hidden function',
    'hidden_fn',
  ];
  const hiddenPlace = {
    _type: 'workflow_rules',
    id: '903',
    module: 'Hidden plural',
    name: 'Hidden rule',
    api_name: 'HiddenApi',
  };
  const fetch = syntheticFetch((url) => {
    if (url.pathname === '/crm/v2/settings/functions')
      return Response.json({
        functions: [
          {
            ...catalogue(),
            description: 'Hidden rule',
            workflow: { name: 'Hidden function', namespace: 'HiddenApi' },
            associated_place: [...catalogue().associated_place, hiddenPlace],
          },
          {
            ...catalogue('902', 'Hidden plural'),
            display_name: 'Hidden function',
            api_name: 'hidden_fn',
            associated_place: [hiddenPlace],
          },
        ],
      });
    if (url.pathname.endsWith('/modules'))
      return Response.json({
        modules: [
          moduleWire(),
          { ...moduleWire('HiddenApi', 'Hidden singular', 'Hidden plural'), id: '904' },
        ],
      });
    if (url.pathname.endsWith('/workflow_rules'))
      return Response.json({
        workflow_rules: [rule(), rule('102'), { ...rule('903', 'HiddenApi'), name: 'Hidden rule' }],
        info: { more_records: false },
      });
    return undefined;
  });
  const { store, snapshots } = setup({
    fetch,
    buildGraph: buildAutomationGraph,
    getEntitlement: async () => account('plus'),
  });
  await store.start();
  expect(snapshots.at(-1)?.graph.nodes.get('function:501')).toMatchObject({ kind: 'function' });
  for (const snapshot of snapshots) {
    const serialized = JSON.stringify(snapshot, (_key, value) =>
      value instanceof Map ? [...value] : value,
    );
    for (const secret of secrets) expect(serialized).not.toContain(secret);
  }
});

it.each([
  'failed',
  'complete',
  'empty',
] as const)('retains map-cached rules until a %s workflow listing settles', async (outcome) => {
  let saved: AutomationMapCache | null = null;
  const cache: NonNullable<ConstructorParameters<typeof AutomationMapStore>[0]['cache']> = async (
    message,
  ) => {
    if (message.type === 'automationMap:writeCache') saved = message.value as AutomationMapCache;
    return saved;
  };
  await setup({ cache }).store.start();
  const page2 = deferred<Response>();
  let retried = false;
  const fetch = syntheticFetch((url) => {
    if (!url.pathname.endsWith('/workflow_rules')) return undefined;
    if (url.searchParams.get('page') === '2')
      return retried
        ? Response.json({ workflow_rules: [], info: { more_records: false } })
        : page2.promise;
    return Response.json({
      workflow_rules: outcome === 'empty' ? [] : [rule('103')],
      info: { more_records: outcome !== 'empty' },
    });
  });
  const next = setup({ cache, fetch, buildGraph: buildAutomationGraph });
  const load = next.store.refresh();
  let pending: AutomationMapSnapshot | undefined;
  try {
    if (outcome !== 'empty') {
      await vi.waitFor(
        () => expect(next.snapshots.at(-1)?.graph.nodes.has('rule:103')).toBe(true),
        { timeout: 2000 },
      );
      pending = next.snapshots.at(-1);
    }
  } finally {
    page2.resolve(
      outcome === 'failed'
        ? new Response(null, { status: 403 })
        : Response.json({ workflow_rules: [], info: { more_records: false } }),
    );
    await load;
  }
  if (pending) {
    expect(pending.graph.nodes.has('rule:102')).toBe(true);
    expect(pending.graph.nodes.get('rule:101')).toMatchObject({ rule: { detailState: 'loaded' } });
  }
  const expected =
    outcome === 'failed' ? ['101', '102', '103'] : outcome === 'complete' ? ['103'] : [];
  expect(next.snapshots.at(-1)?.graph.nodes.has('rule:102')).toBe(outcome === 'failed');
  expect((saved as unknown as AutomationMapCache).inputs.rules.map((r) => r.id).sort()).toEqual(
    expected,
  );
  if (outcome === 'failed') {
    expect(next.snapshots.at(-1)?.coverage.failures.some((f) => f.id === 'workflow:list')).toBe(
      true,
    );
    retried = true;
    await next.store.retry('workflow:list');
    expect((saved as unknown as AutomationMapCache).inputs.rules.map((r) => r.id)).toEqual(['103']);
  }
});

it('reveals one writing rule, reserves its late function action and never publishes sibling identities', async () => {
  const fetch = vi.fn(
    syntheticFetch((url) => {
      const path = url.pathname;
      if (path === '/crm/v2/settings/functions')
        return Response.json({
          functions: [
            {
              ...catalogue(),
              associated_place: [{ _type: 'workflow_rules', id: '102', module: 'Orchard gardens' }],
            },
            {
              ...catalogue('7000000000000000999'),
              display_name: 'Hidden sibling function',
              api_name: 'hidden_sibling_fn',
              tasks: null,
            },
          ],
        });
      if (path.endsWith('/workflow_rules'))
        return Response.json({
          workflow_rules: [
            { ...rule('7000000000000000888'), name: 'Hidden sibling rule' },
            rule('102'),
          ],
          info: { more_records: false },
        });
      if (path.endsWith('/workflow_rules/102'))
        return Response.json({
          workflow_rules: [
            {
              ...rule('102'),
              conditions: [
                {
                  instant_actions: {
                    actions: [
                      { id: '302', type: 'field_updates' },
                      { id: '303', type: 'webhooks', name: 'Omitted resource secret' },
                      { id: '301', type: 'functions' },
                    ],
                  },
                },
              ],
            },
          ],
        });
      if (path.endsWith('/field_updates/302'))
        return Response.json({
          field_updates: [{ id: '302', field: { api_name: 'Harvest' }, value: 'ready' }],
        });
      return undefined;
    }),
  );
  const { store, snapshots, cache } = setup({
    fetch,
    buildGraph: buildAutomationGraph,
    getEntitlement: async () => account('plus'),
  });
  await store.start();
  const urls = fetch.mock.calls.map(([url]) => new URL(String(url)).pathname);
  expect(new Set(urls)).toEqual(
    new Set([
      '/crm/v2/settings/functions',
      '/crm/v8/settings/automation/workflow_rules',
      '/crm/v8/settings/modules',
      '/crm/v2.2/settings/modules',
      '/crm/v8/settings/automation/workflow_rules/102',
      '/crm/v8/settings/automation/field_updates/302',
      '/crm/v8/settings/automation/functions/301',
      '/crm/v2/settings/functions/501',
    ]),
  );
  expect(urls).toHaveLength(8);
  expect(cache).not.toHaveBeenCalled();
  const nodes = [...(snapshots.at(-1)?.graph.nodes.values() ?? [])];
  expect(nodes.filter((n) => n.kind === 'rule').map((n) => n.ruleId)).toEqual(['102']);
  expect(nodes.filter((n) => n.kind === 'function').map((n) => n.delugeId)).toEqual(['501']);
  expect(snapshots.at(-1)?.graph.nodes.get('module:Orchards')).toMatchObject({
    counts: { rules: 2, functions: 2 },
  });
  for (const snapshot of snapshots) {
    const serialized = JSON.stringify(snapshot, (_key, value) =>
      value instanceof Map ? [...value] : value,
    );
    for (const secret of [
      '7000000000000000888',
      '7000000000000000999',
      'Hidden sibling rule',
      'Hidden sibling function',
      'hidden_sibling_fn',
      'Omitted resource secret',
    ])
      expect(serialized).not.toContain(secret);
  }
});

it('uses one distinct dependency gap and counts unsupported/empty button probes separately', async () => {
  const fetch = syntheticFetch((url) => {
    if (url.pathname.endsWith('/modules'))
      return Response.json({
        modules: [moduleWire(), moduleWire('NoButtons'), moduleWire('Denied')],
      });
    if (url.pathname.endsWith('/custom_buttons') && url.searchParams.get('module') === 'Denied')
      return Response.json({ code: 'NO_PERMISSION' }, { status: 400 });
    if (url.pathname === '/crm/v2/settings/functions/501')
      return new Response(null, { status: 403 });
    return undefined;
  });
  const { store, snapshots } = setup({ fetch });
  await store.start();
  const coverage = snapshots.at(-1)?.coverage;
  if (!coverage) throw new Error('Missing coverage');
  // One source dependency shared with WorkflowIndex + one unanalyzed function.
  expect(coverage.gaps).toBe(2);
  expect(coverage.buttons).toMatchObject({ loaded: 2, unsupported: 1, failed: 0, state: 'loaded' });
});

it('retries a failed blueprint transition discovery and drops its dependency gap', async () => {
  let fail = true;
  const fetch = vi.fn(
    syntheticFetch((url) => {
      if (url.pathname.endsWith('/blueprints'))
        return Response.json({
          blueprints: [{ id: '701', name: 'Synthetic', module: { api_name: 'Orchards' } }],
        });
      if (url.pathname.endsWith('/701/transitions'))
        return fail
          ? new Response(null, { status: 503 })
          : Response.json({ transitions: [{ id: '711' }] });
      if (url.pathname.endsWith('/transitions/711'))
        return Response.json({
          transitions: [{ id: '711', name: 'Advance', during_inputs: [], actions: [] }],
        });
      return undefined;
    }),
  );
  const { store, snapshots, builds } = setup({ fetch });
  await store.start();
  expect(snapshots.at(-1)?.coverage.gaps).toBe(1);
  expect(snapshots.at(-1)?.coverage.blueprints).toMatchObject({ loaded: 0, failed: 1 });
  fail = false;
  await store.retry();
  expect(builds.at(-1)?.transitions).toHaveLength(1);
  expect(snapshots.at(-1)?.coverage.gaps).toBe(0);
  expect(snapshots.at(-1)?.coverage.blueprints).toMatchObject({ loaded: 2, failed: 0 });
}, 15000);

it('serves a fully revalidated cache for 15 minutes and supports explicit refresh', async () => {
  let saved: AutomationMapCache | null = null;
  const cache: NonNullable<ConstructorParameters<typeof AutomationMapStore>[0]['cache']> = async (
    m,
  ) => {
    if (m.type === 'automationMap:writeCache') saved = m.value as AutomationMapCache;
    return saved;
  };
  await setup({ cache }).store.start();
  const next = setup({ cache });
  await next.store.start();
  expect(next.fetch).not.toHaveBeenCalled();
  expect(next.snapshots.at(-1)?.coverage.lastRevalidatedAt).toBeGreaterThan(0);
  expect(next.snapshots.at(-1)?.coverage.gaps).toBe(0);
  expect(next.snapshots.at(-1)?.coverage.isComplete).toBe(true);
  await next.store.refresh();
  expect(next.fetch).toHaveBeenCalled();
  const expired = setup({ cache });
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 15 * 60 * 1000 + 1000);
  try {
    await expired.store.start();
    expect(expired.fetch).toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});

it('retries a shared source failure through its published handle and clears both indexes', async () => {
  let fail = true;
  const { store, snapshots } = setup({
    fetch: syntheticFetch((url) =>
      url.pathname === '/crm/v2/settings/functions/501' && fail
        ? new Response(null, { status: 403 })
        : undefined,
    ),
  });
  await store.start();
  expect(snapshots.at(-1)?.coverage.gaps).toBe(2);
  expect(snapshots.at(-1)?.coverage.failures).toHaveLength(1);
  fail = false;
  await snapshots.at(-1)?.coverage.failures[0].retry();
  expect(snapshots.at(-1)?.coverage.gaps).toBe(0);
  expect(snapshots.at(-1)?.coverage.failures).toHaveLength(0);
});

it('keeps settled analysis gaps and the revalidation timestamp stable across fresh opens', async () => {
  let saved: AutomationMapCache | null = null;
  const cache: NonNullable<ConstructorParameters<typeof AutomationMapStore>[0]['cache']> = async (
    message,
  ) => {
    if (message.type === 'automationMap:writeCache') saved = message.value as AutomationMapCache;
    return saved;
  };
  const first = setup({
    cache,
    analyze: (source, options) => {
      const result = analyzeDelugeEffects(source, options);
      return { ...result, analysis: { ...result.analysis, status: 'limited' } };
    },
  });
  await first.store.start();
  const updated = first.snapshots.at(-1)?.coverage.lastRevalidatedAt;
  expect(first.snapshots.at(-1)?.coverage.gaps).toBe(1);
  for (let i = 0; i < 2; i++) {
    const next = setup({ cache });
    await next.store.start();
    expect(next.fetch).not.toHaveBeenCalled();
    expect(next.snapshots.at(-1)?.coverage.gaps).toBe(1);
    expect(next.snapshots.at(-1)?.coverage.lastRevalidatedAt).toBe(updated);
    expect(next.snapshots.at(-1)?.coverage.isComplete).toBe(false);
  }
});

it('persists a settled pass with failures, opens without reads, and retries explicitly', async () => {
  let saved: AutomationMapCache | null = null;
  const cache: NonNullable<ConstructorParameters<typeof AutomationMapStore>[0]['cache']> = async (
    m,
  ) => {
    if (m.type === 'automationMap:writeCache') saved = m.value as AutomationMapCache;
    return saved;
  };
  const fetch = vi.fn(
    syntheticFetch((url) =>
      url.pathname.endsWith('/fields') ? new Response(null, { status: 403 }) : undefined,
    ),
  );
  const first = setup({ cache, fetch });
  await first.store.start();
  const settled = first.snapshots.at(-1)?.coverage;
  if (!settled) throw new Error('Missing settled coverage');
  let updated = settled.lastRevalidatedAt;
  expect(settled.failures.map((f) => f.id)).toEqual(['fields:Orchards']);
  expect(settled.lastRevalidatedAt).toBeGreaterThan(0);
  for (let i = 0; i < 2; i++) {
    fetch.mockClear();
    const next = setup({ cache, fetch });
    await next.store.start();
    expect(fetch).not.toHaveBeenCalled();
    expect(next.snapshots.at(-1)?.coverage).toMatchObject({
      gaps: settled.gaps,
      lastRevalidatedAt: updated,
      refreshing: false,
    });
    expect(next.snapshots.at(-1)?.coverage.failures.map((f) => f.id)).toEqual(['fields:Orchards']);
    await next.snapshots.at(-1)?.coverage.failures[0].retry();
    expect(fetch.mock.calls).toHaveLength(1);
    expect(new URL(String(fetch.mock.calls[0][0])).pathname).toBe('/crm/v8/settings/fields');
    expect(next.snapshots.at(-1)?.coverage.lastRevalidatedAt).toBe(updated);
    expect(next.snapshots.at(-1)?.coverage.failures).toHaveLength(1);
    updated = next.snapshots.at(-1)?.coverage.lastRevalidatedAt;
  }
  fetch.mockClear();
  await first.store.refresh();
  expect(fetch).toHaveBeenCalled();
});

it('marks gaps provisional until every dependency has settled', async () => {
  const gate = deferred<Response>();
  const { store, snapshots } = setup({
    fetch: syntheticFetch((url) => (url.pathname.endsWith('/fields') ? gate.promise : undefined)),
  });
  const loading = store.start();
  await vi.waitFor(() =>
    expect(snapshots.some((s) => s.coverage.functions.analyzed === 1)).toBe(true),
  );
  expect(snapshots.at(-1)?.coverage.gapsProvisional).toBe(true);
  gate.resolve(new Response(null, { status: 403 }));
  await loading;
  expect(snapshots.at(-1)?.coverage).toMatchObject({ gaps: 1, gapsProvisional: false });
  expect(
    snapshots
      .filter((s) => s.coverage.gapsProvisional === false)
      .every((s) => s.coverage.gaps === 1),
  ).toBe(true);
});

it('aggregates quiet inventory modules and reconciles teaser/full inventory despite inferred islands', async () => {
  const fetch = syntheticFetch((url) => {
    if (url.pathname.endsWith('/modules'))
      return Response.json({
        modules: [
          moduleWire(),
          moduleWire('Hidden', 'Hidden', 'Hiddens'),
          ...Array.from({ length: 180 }, (_, i) =>
            moduleWire(`Quiet${i}`, `Quiet${i}`, `Quiets${i}`),
          ),
        ],
      });
    if (url.pathname === '/crm/v2/settings/functions')
      return Response.json({ functions: [catalogue(), catalogue('502', 'Hiddens')] });
    if (url.pathname === '/crm/v2/settings/functions/501')
      return Response.json({
        functions: [
          { id: '501', script: 'zoho.crm.updateRecord("InferredOnly",1,{"State":"Ready"});' },
        ],
      });
    return undefined;
  });
  const teaser = setup({ fetch, getEntitlement: async () => account('plus') });
  const full = setup({ fetch, buildGraph: buildAutomationGraph });
  await Promise.all([teaser.store.start(), full.store.start()]);
  const preview = teaser.snapshots.at(-1),
    complete = full.snapshots.at(-1);
  if (!preview?.teaser || !complete) throw new Error('Missing final snapshots');
  expect(preview.teaser?.quietModules).toBe(180);
  expect(preview.teaser?.fogged).toHaveLength(1);
  expect(preview.teaser?.totals.modules).toBe(182);
  expect(complete.coverage.modules).toBe(preview.teaser?.totals.modules);
  expect(complete.graph.modules.length).toBe(183);
  expect(1 + preview.teaser.fogged.length + (preview.teaser.quietModules ?? 0)).toBe(182);
  expect(JSON.stringify(preview.teaser)).not.toContain('Quiet');
});

it('reconstructs cached approval, transition, button and field retries without unrelated reads', async () => {
  let saved: AutomationMapCache | null = null;
  const cache: NonNullable<ConstructorParameters<typeof AutomationMapStore>[0]['cache']> = async (
    m,
  ) => {
    if (m.type === 'automationMap:writeCache') saved = m.value as AutomationMapCache;
    return saved;
  };
  let fail = true;
  const failedPaths = [
    '/crm/v8/settings/blueprints/801/transitions',
    '/crm/v8/settings/blueprints/transitions/812',
    '/crm/v9/settings/approval_process/901/rules',
    '/crm/v8/settings/custom_buttons',
    '/crm/v8/settings/fields',
  ];
  const fetch = vi.fn(
    syntheticFetch((url) => {
      const path = url.pathname;
      if (fail && failedPaths.includes(path)) return new Response(null, { status: 403 });
      if (path.endsWith('/blueprints'))
        return Response.json({
          blueprints: ['801', '802'].map((id) => ({
            id,
            name: `Blueprint ${id}`,
            module: { api_name: 'Orchards' },
            field: { api_name: 'Stage' },
            active: true,
          })),
        });
      if (/blueprints\/80[12]\/transitions$/.test(path))
        return Response.json({ transitions: [{ id: path.includes('801') ? '811' : '812' }] });
      if (/blueprints\/transitions\/81[12]$/.test(path))
        return Response.json({
          transitions: [
            { id: path.split('/').at(-1), name: 'Advance', actions: [], during_inputs: [] },
          ],
        });
      if (path.endsWith('/approval_process'))
        return Response.json({
          approval_process: [
            { id: '901', name: 'Review', module: { api_name: 'Orchards' }, active: true },
          ],
        });
      if (path.endsWith('/901/rules')) return Response.json({ rules: [] });
      return undefined;
    }),
  );
  const first = setup({ cache, fetch });
  await first.store.start();
  const timestamp = first.snapshots.at(-1)?.coverage.lastRevalidatedAt;
  expect(first.snapshots.at(-1)?.coverage.failures).toHaveLength(5);
  // A second document receives only serialized data, never closures from the cold store.
  saved = JSON.parse(JSON.stringify(saved));
  const next = setup({ cache, fetch });
  fetch.mockClear();
  await next.store.start();
  expect(fetch).not.toHaveBeenCalled();
  await next.store.retry('buttons:Orchards');
  expect(fetch.mock.calls).toHaveLength(1);
  expect(next.snapshots.at(-1)?.coverage.buttons.failed).toBe(1);
  fetch.mockClear();
  fail = false;
  await next.store.retry();
  const paths = fetch.mock.calls.map(([url]) => new URL(String(url)).pathname).sort();
  expect(paths).toEqual([...failedPaths, '/crm/v8/settings/blueprints/transitions/811'].sort());
  expect(next.snapshots.at(-1)?.coverage).toMatchObject({
    lastRevalidatedAt: timestamp,
    gaps: 0,
    isComplete: true,
    blueprints: { loaded: 4, failed: 0 },
    approvals: { loaded: 1, failed: 0 },
  });
  expect((saved as unknown as AutomationMapCache).revalidation?.failureIds).toEqual([]);
  const reopened = setup({ cache, fetch });
  fetch.mockClear();
  await reopened.store.start();
  expect(fetch).not.toHaveBeenCalled();
  expect(reopened.snapshots.at(-1)?.coverage).toMatchObject({
    lastRevalidatedAt: timestamp,
    gaps: 0,
    isComplete: true,
  });
});
