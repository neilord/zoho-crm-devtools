import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchWorkflows } from '../src/content/workflows/search';
import type { WorkflowIndexSnapshot } from '../src/content/workflows/types';
import { computeCoverage } from '../src/content/workflows/view-model';
import { actions, WorkflowIndex } from '../src/content/workflows/workflow-store';
import { billingMessage, workflowCacheMessage } from '../src/shared/browser';
import { isWorkflowCache, type WorkflowCache } from '../src/shared/workflow-cache-protocol';
import {
  binding,
  catalogue,
  context,
  detail,
  functionResource,
  paid,
  summary,
} from './fixtures/workflows';

vi.mock('../src/shared/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/shared/browser')>()),
  billingMessage: vi.fn(),
  workflowCacheMessage: vi.fn(),
}));
const response = (value: unknown) => Response.json(value);
function transport(
  options: {
    noSource?: boolean;
    noApiName?: boolean;
    failAction?: boolean;
    failSource?: boolean;
  } = {},
) {
  return vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/workflow_rules?'))
      return response({
        workflow_rules: [summary(), summary('102')],
        info: { more_records: false },
      });
    if (url.endsWith('/workflow_rules/101') || url.endsWith('/workflow_rules/102')) {
      return response({
        workflow_rules: [
          detail(url.split('/').at(-1), [
            binding,
            { id: '302', type: 'email_notifications', name: 'Harvest mail' },
          ]),
        ],
      });
    }
    if (url.endsWith('/automation/functions/301')) {
      if (options.failAction) return new Response('', { status: 403 });
      return response({
        functions: [
          {
            ...functionResource,
            function: options.noApiName ? { id: '401' } : functionResource.function,
          },
        ],
      });
    }
    if (url.endsWith('/email_notifications/302'))
      return response({
        email_notifications: [
          { id: '302', name: 'Harvest mail', template: { id: '601', name: 'Harvest' } },
        ],
      });
    if (url.endsWith('/email_templates/601'))
      return response({
        email_templates: [
          { id: '601', name: 'Harvest', subject: 'Pears ready', content: '<p>Pick fruit</p>' },
        ],
      });
    if (url.includes('/settings/fields?'))
      return response({ fields: [{ id: '71', api_name: 'Fruit', field_label: 'Harvest Fruit' }] });
    if (url.includes('/settings/functions?')) return response({ functions: catalogue });
    if (url.includes('/settings/functions/501?') && options.failSource)
      return new Response('', { status: 403 });
    if (url.includes('/settings/functions/501?'))
      return response({
        functions: [
          {
            id: '501',
            ...(options.noSource
              ? {}
              : { workflow: 'void wf_score_orchard()\n{\ninfo "synthetic pear";\n}' }),
          },
        ],
      });
    throw new Error('Unexpected synthetic endpoint');
  });
}
beforeEach(() => {
  vi.mocked(billingMessage).mockReset();
  vi.mocked(workflowCacheMessage).mockReset();
  vi.mocked(billingMessage).mockResolvedValue(paid);
  vi.mocked(workflowCacheMessage).mockResolvedValue(null);
});
describe('progressive workflow graph', () => {
  it('emits idle/list immediately, deduplicates resources/templates/sources, keeps occurrences immutable', async () => {
    const f = transport(),
      index = new WorkflowIndex({ context, fetch: f }),
      snapshots: WorkflowIndexSnapshot[] = [];
    index.subscribe((s) => snapshots.push(s));
    expect(snapshots[0].progress.phase).toBe('idle');
    await index.load(new AbortController().signal);
    const list = snapshots.find((s) => s.rules.length === 2 && s.progress.ruleDetailsLoaded === 0);
    expect(list?.rules[0].detailState).toBe('not-requested');
    const final = snapshots[snapshots.length - 1];
    expect(final.progress).toMatchObject({
      phase: 'complete',
      isComplete: true,
      ruleDetailsLoaded: 2,
      actionResourcesLoaded: 2,
      templatesLoaded: 1,
      functionSourcesAvailable: 1,
      rulesTotal: 2,
      ruleDetailsTotal: 2,
      actionResourcesTotal: 2,
      templatesTotal: 1,
      functionSourcesTotal: 1,
    });
    expect(actions(final.rules[0]).filter((a) => a.kind === 'function')).toHaveLength(2);
    expect(actions(final.rules[0])[0]).toMatchObject({
      kind: 'function',
      crmFunctionId: '401',
      delugeFunctionId: '501',
      joinConfidence: 'exact',
      sourceState: 'available',
    });
    for (const path of [
      '/automation/functions/301',
      '/email_templates/601',
      '/settings/functions/501?',
    ])
      expect(f.mock.calls.filter(([url]) => String(url).includes(path))).toHaveLength(1);
    expect(list?.rules[0].conditions).toHaveLength(0);
    const details = snapshots.filter(
      (s) => s.progress.phase === 'details' && s.progress.ruleDetailsLoaded === 2,
    );
    expect(details.length).toBeGreaterThan(0);
    expect(details[0].rules.every((r) => r.detailState === 'loaded')).toBe(true);
    const actionsPhase = snapshots.find((s) => s.progress.phase === 'actions');
    expect(actionsPhase?.rules[0]).toBe(details.at(-1)?.rules[0]);
    expect(list?.progress.actionResourcesTotal).toBeNull();
    expect(actionsPhase?.progress.actionResourcesTotal).toBe(2);
    expect(workflowCacheMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflows:readCache',
        ...{ origin: context.origin, orgId: context.orgId },
      }),
    );
  });
  it('does not label 200 without source as complete', async () => {
    const index = new WorkflowIndex({ context, fetch: transport({ noSource: true }) });
    let last!: WorkflowIndexSnapshot;
    index.subscribe((s) => {
      last = s;
    });
    await index.load(new AbortController().signal);
    expect(last.progress).toMatchObject({ isComplete: false, functionSourcesUnavailable: 1 });
    expect(actions(last.rules[0])[0]).toMatchObject({
      sourceState: 'unavailable',
      sourceText: null,
    });
  });
  it('keeps unique name-only joins uncertain and never reads their code', async () => {
    const f = transport({ noApiName: true }),
      index = new WorkflowIndex({ context, fetch: f });
    let last!: WorkflowIndexSnapshot;
    index.subscribe((s) => {
      last = s;
    });
    await index.load(new AbortController().signal);
    expect(actions(last.rules[0])[0]).toMatchObject({
      joinConfidence: 'uncertain',
      sourceText: null,
    });
    expect(last.progress.functionSourcesUncertain).toBe(1);
    expect(f.mock.calls.some(([url]) => String(url).includes('/functions/501?'))).toBe(false);
  });
  it('retries just failed shared dependencies, then discovers their children', async () => {
    const options = { failAction: true },
      f = transport(options),
      index = new WorkflowIndex({ context, fetch: f });
    let last!: WorkflowIndexSnapshot;
    index.subscribe((s) => {
      last = s;
    });
    await index.load(new AbortController().signal);
    expect(last.progress.failures[0].ruleIds).toEqual(['101', '102']);
    expect(last.rules[0].failureIds).toContain('functions:301');
    options.failAction = false;
    await last.progress.failures[0].retry();
    expect(last.progress.isComplete).toBe(true);
    expect(
      f.mock.calls.filter(([url]) => String(url).endsWith('/workflow_rules/101')),
    ).toHaveLength(1);
    expect(
      f.mock.calls.filter(([url]) => String(url).endsWith('/automation/functions/301')),
    ).toHaveLength(2);
  });
  it('blocks all cache/network I/O before entitlement', async () => {
    vi.mocked(billingMessage).mockRejectedValue(new Error('offline'));
    const f = transport(),
      index = new WorkflowIndex({ context, fetch: f });
    await expect(index.load(new AbortController().signal)).rejects.toThrow('Paid workflow');
    expect(f).not.toHaveBeenCalled();
    expect(workflowCacheMessage).not.toHaveBeenCalled();
  });
  it('warm-starts code then revalidates independent dependencies while retaining unchanged rules', async () => {
    const f = transport(),
      first = new WorkflowIndex({ context, fetch: f });
    let cached!: WorkflowIndexSnapshot;
    first.subscribe((s) => {
      cached = s;
    });
    await first.load(new AbortController().signal);
    vi.mocked(workflowCacheMessage).mockImplementation(async (m) =>
      m.type === 'workflows:readCache'
        ? { version: 1, savedAt: Date.now(), rules: [...cached.rules] }
        : null,
    );
    const fresh = transport({ noSource: true }),
      second = new WorkflowIndex({ context, fetch: fresh }),
      snapshots: WorkflowIndexSnapshot[] = [];
    second.subscribe((s) => snapshots.push(s));
    await second.load(new AbortController().signal);
    expect(
      snapshots.some(
        (s) => s.progress.phase === 'listing' && s.progress.functionSourcesAvailable === 1,
      ),
    ).toBe(true);
    expect(fresh.mock.calls.some(([url]) => String(url).endsWith('/workflow_rules/101'))).toBe(
      false,
    );
    expect(
      fresh.mock.calls.some(([url]) => String(url).endsWith('/automation/functions/301')),
    ).toBe(true);
    expect(snapshots.at(-1)?.progress.functionSourcesUnavailable).toBe(1);
  });
  it('roundtrips the actual compact worker payload across instances without dropping warm coverage', async () => {
    let saved: WorkflowCache | null = null;
    vi.mocked(workflowCacheMessage).mockImplementation(async (m) => {
      if (m.type === 'workflows:writeCache') {
        expect(isWorkflowCache(m.value)).toBe(true);
        saved = JSON.parse(JSON.stringify(m.value));
        return null;
      }
      return saved;
    });
    const first = new WorkflowIndex({ context, fetch: transport() });
    await first.load(new AbortController().signal);
    first.dispose();
    const snapshots: WorkflowIndexSnapshot[] = [];
    const second = new WorkflowIndex({ context, fetch: transport() });
    second.subscribe((s) => snapshots.push(s));
    await second.load(new AbortController().signal);
    const warm = snapshots.filter((s) => s.rules.length);
    for (const s of warm) {
      for (const [scope, query] of [
        ['code', 'synthetic pear'],
        ['actions', 'Pick fruit'],
        ['actions', 'Harvest mail'],
      ] as const)
        expect(
          searchWorkflows(s, {
            query,
            scope,
            modules: [],
            active: 'all',
            triggerTypes: [],
            triggerFieldApiNames: [],
            actionKinds: [],
          }),
        ).toHaveLength(2);
      expect(computeCoverage(s).status.kind).toBe('complete');
      expect(s.progress).toMatchObject({
        ruleDetailsLoaded: 2,
        actionResourcesLoaded: 2,
        templatesLoaded: 1,
        functionSourcesAvailable: 1,
      });
    }
    expect(
      warm[0].rules
        .flatMap(actions)
        .filter((a) => a.kind === 'emailNotification')
        .every((a) => a.template?.bodyText === 'Pick fruit'),
    ).toBe(true);
  });
  it('refreshes the code haystack after sources arrive, with mixed case and no result cap', async () => {
    const f = transport();
    const original = f.getMockImplementation();
    if (!original) throw new Error('Missing transport');
    f.mockImplementation(async (url, init) =>
      String(url).includes('/settings/functions/501?')
        ? response({
            functions: [
              {
                id: '501',
                workflow:
                  'void wf_score_orchard() { InVoKeUrL [ url: "https://synthetic.invalid" ]; }',
              },
            ],
          })
        : original(url, init),
    );
    const index = new WorkflowIndex({ context, fetch: f });
    const matches: number[] = [];
    index.subscribe((s) =>
      matches.push(
        searchWorkflows(s, {
          query: 'invokeurl',
          modules: [],
          active: 'all',
          triggerTypes: [],
          triggerFieldApiNames: [],
          actionKinds: [],
          scope: 'all',
        }).length,
      ),
    );
    await index.load(new AbortController().signal);
    expect(matches[0]).toBe(0);
    expect(matches.at(-1)).toBe(2);
  });
  it('cancels queued/in-flight work and never emits after dispose', async () => {
    const abort = new AbortController(),
      f = vi
        .fn<typeof fetch>()
        .mockImplementation(
          (_url, init) =>
            new Promise((_resolve, reject) =>
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError')),
              ),
            ),
        );
    const index = new WorkflowIndex({ context, fetch: f }),
      listener = vi.fn();
    index.subscribe(listener);
    const result = index.load(abort.signal);
    const assertion = expect(result).rejects.toThrow();
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
    const count = listener.mock.calls.length;
    index.dispose();
    await assertion;
    index.dispose();
    expect(listener).toHaveBeenCalledTimes(count);
  });
});

it.each([
  '/crm/org999002/settings/workflow-rules',
  `/crm/org${context.orgId}/settings/functions`,
])('aborts on context departure to %s without publishing stale responses', async (destination) => {
  history.replaceState(null, '', `/crm/org${context.orgId}/settings/workflow-rules`);
  const f = vi
    .fn<typeof fetch>()
    .mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        ),
    );
  const index = new WorkflowIndex({ context: { ...context, origin: location.origin }, fetch: f }),
    listener = vi.fn();
  index.subscribe(listener);
  const result = index.load(new AbortController().signal);
  const assertion = expect(result).rejects.toThrow();
  try {
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
    const count = listener.mock.calls.length;
    history.replaceState(null, '', destination);
    await assertion;
    expect(listener).toHaveBeenCalledTimes(count);
  } finally {
    index.dispose();
    history.replaceState(null, '', '/');
  }
});

it('retries a failed source without reloading successful actions or templates', async () => {
  const options = { failSource: true },
    f = transport(options),
    index = new WorkflowIndex({ context, fetch: f });
  let last!: WorkflowIndexSnapshot;
  index.subscribe((s) => {
    last = s;
  });
  await index.load(new AbortController().signal);
  expect(last.progress.failures[0].target).toEqual({
    kind: 'functionSource',
    delugeFunctionId: '501',
  });
  expect(actions(last.rules[0])[0]).toMatchObject({ sourceState: 'unavailable' });
  options.failSource = false;
  await index.retryFailed();
  expect(last.progress.isComplete).toBe(true);
  expect(
    f.mock.calls.filter(([url]) => String(url).endsWith('/automation/functions/301')),
  ).toHaveLength(1);
  expect(
    f.mock.calls.filter(([url]) => String(url).includes('/settings/functions/501?')),
  ).toHaveLength(2);
});

it('projects nullable Zoho catalogue names into a valid cache and preserves name-only joins', async () => {
  let saved: WorkflowCache | null = null;
  vi.mocked(workflowCacheMessage).mockImplementation(async (message) => {
    if (message.type === 'workflows:readCache') return saved;
    expect(isWorkflowCache(message.value)).toBe(true);
    saved = JSON.parse(JSON.stringify(message.value));
    return null;
  });
  const fetchGraph = () => {
    const original = transport({ noApiName: true });
    return vi.fn<typeof fetch>(async (url, init) =>
      String(url).includes('/settings/functions?')
        ? response({
            functions: [
              {
                ...catalogue[0],
                display_name: 'Different display name',
                workflow: { name: binding.name },
              },
              { id: '5999', api_name: null, display_name: 'Unbound legacy function' },
            ],
          })
        : original(url, init),
    );
  };
  for (let run = 0; run < 2; run++) {
    const index = new WorkflowIndex({ context, fetch: fetchGraph() });
    const snapshots: WorkflowIndexSnapshot[] = [];
    index.subscribe((s) => snapshots.push(s));
    await index.load(new AbortController().signal);
    for (const snapshot of snapshots.filter((s) => s.progress.functionSourcesTotal !== null)) {
      expect(snapshot.progress.functionSourcesUncertain).toBe(1);
      expect(snapshot.progress.functionSourcesUnavailable).toBe(0);
    }
    index.dispose();
  }
  expect(saved).not.toBeNull();
  expect(isWorkflowCache(saved)).toBe(true);
});

it('counts a failed re-read of cached missing source once, then recovers on retry', async () => {
  let saved: WorkflowCache | null = null;
  vi.mocked(workflowCacheMessage).mockImplementation(async (m) => {
    if (m.type === 'workflows:readCache') return saved;
    saved = m.value as WorkflowCache;
    return null;
  });
  const first = new WorkflowIndex({ context, fetch: transport({ noSource: true }) });
  await first.load(new AbortController().signal);
  first.dispose();
  const options = { failSource: true };
  const second = new WorkflowIndex({ context, fetch: transport(options) });
  let last!: WorkflowIndexSnapshot;
  second.subscribe((s) => {
    last = s;
  });
  await second.load(new AbortController().signal);
  expect(last.progress).toMatchObject({
    functionSourcesTotal: 1,
    functionSourcesUnavailable: 0,
    functionSourcesFailed: 1,
  });
  options.failSource = false;
  await second.retryFailed();
  expect(last.progress).toMatchObject({
    functionSourcesAvailable: 1,
    functionSourcesUnavailable: 0,
    functionSourcesFailed: 0,
    isComplete: true,
  });
  second.dispose();
});

it('queues Retry clicked after completion while the final cache acknowledgement is pending', async () => {
  let release!: () => void;
  let wrote!: () => void;
  const writing = new Promise<void>((resolve) => {
    wrote = resolve;
  });
  const acknowledgement = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  vi.mocked(workflowCacheMessage).mockImplementation(async (message) => {
    if (message.type === 'workflows:writeCache' && writes++ === 0) {
      wrote();
      await acknowledgement;
    }
    return null;
  });
  const options = { failSource: true };
  const index = new WorkflowIndex({ context, fetch: transport(options) });
  let last!: WorkflowIndexSnapshot;
  index.subscribe((s) => {
    last = s;
  });
  const loading = index.load(new AbortController().signal);
  await writing;
  expect(last.progress.functionSourcesFailed).toBe(1);
  options.failSource = false;
  const retry = index.retryFailed();
  release();
  await loading;
  await retry;
  expect(last.progress).toMatchObject({
    functionSourcesAvailable: 1,
    functionSourcesFailed: 0,
    isComplete: true,
  });
  index.dispose();
});

it('rejects conflicting catalogue identities before pagination deduplication can choose a winner', async () => {
  const entries = [catalogue[0], { ...catalogue[0], api_name: 'conflicting_api_name' }];
  for (const list of [entries, [...entries].reverse()]) {
    const original = transport();
    const fetchGraph: typeof fetch = async (url, init) =>
      String(url).includes('/settings/functions?')
        ? response({ functions: list })
        : original(url, init);
    const index = new WorkflowIndex({ context, fetch: fetchGraph });
    let last!: WorkflowIndexSnapshot;
    index.subscribe((s) => {
      last = s;
    });
    await index.load(new AbortController().signal);
    expect(last.progress.functionSourcesAvailable).toBe(0);
    expect(last.progress.failures.map((f) => f.target.kind)).toEqual(['functionCatalogue']);
    expect(last.progress.isComplete).toBe(false);
    index.dispose();
  }
});

it.each([
  'unchanged',
  'changed',
  'unknown',
] as const)('revalidates %s catalogue timestamps without hiding cached matches', async (change) => {
  let saved: WorkflowCache | null = null;
  vi.mocked(workflowCacheMessage).mockImplementation(async (m) => {
    if (m.type === 'workflows:readCache') return saved;
    saved = JSON.parse(JSON.stringify(m.value));
    return null;
  });
  const fetchGraph = (updatedTime?: string) => {
    const original = transport();
    const f = vi.fn<typeof fetch>(async (url, init) =>
      String(url).includes('/settings/functions?')
        ? response({ functions: catalogue.map((entry) => ({ ...entry, updatedTime })) })
        : original(url, init),
    );
    return f;
  };
  const first = new WorkflowIndex({ context, fetch: fetchGraph('2030-01-01') });
  await first.load(new AbortController().signal);
  first.dispose();
  const f = fetchGraph(
    change === 'unknown' ? undefined : change === 'changed' ? '2030-02-01' : '2030-01-01',
  );
  const second = new WorkflowIndex({ context, fetch: f });
  second.subscribe((snapshot) => {
    if (!snapshot.rules.length) return;
    expect(
      searchWorkflows(snapshot, {
        query: 'synthetic pear',
        scope: 'code',
        modules: [],
        active: 'all',
        triggerTypes: [],
        triggerFieldApiNames: [],
        actionKinds: [],
      }),
    ).toHaveLength(2);
  });
  await second.load(new AbortController().signal);
  expect(
    f.mock.calls.filter(([url]) => String(url).includes('/settings/functions/501?')),
  ).toHaveLength(change === 'unchanged' ? 0 : 1);
  second.dispose();
});

it('keeps cached source and action matches on failed refresh without certifying stale source freshness', async () => {
  let saved: WorkflowCache | null = null;
  vi.mocked(workflowCacheMessage).mockImplementation(async (message) => {
    if (message.type === 'workflows:readCache') return saved;
    saved = JSON.parse(JSON.stringify(message.value));
    return null;
  });
  for (const run of [0, 1, 2]) {
    const fail = run === 1;
    const original = transport({ failSource: fail, failAction: fail });
    const f = vi.fn<typeof fetch>(async (url, init) =>
      String(url).includes('/settings/functions?')
        ? response({
            functions: catalogue.map((entry) => ({
              ...entry,
              updatedTime: run === 0 ? '2030-01-01' : '2030-02-01',
            })),
          })
        : original(url, init),
    );
    const index = new WorkflowIndex({ context, fetch: f });
    let last!: WorkflowIndexSnapshot;
    index.subscribe((snapshot) => {
      last = snapshot;
    });
    await index.load(new AbortController().signal);
    expect(actions(last.rules[0])[0]).toMatchObject({ state: 'loaded', sourceState: 'available' });
    expect(
      searchWorkflows(last, {
        query: 'synthetic pear',
        scope: 'code',
        modules: [],
        active: 'all',
        triggerTypes: [],
        triggerFieldApiNames: [],
        actionKinds: [],
      }),
    ).toHaveLength(2);
    expect(
      f.mock.calls.filter(([url]) => String(url).includes('/settings/functions/501?')),
    ).toHaveLength(1);
    index.dispose();
  }
});

it('reports a failed warm list refresh as a gap while keeping the cached graph searchable', async () => {
  let saved: WorkflowCache | null = null;
  vi.mocked(workflowCacheMessage).mockImplementation(async (message) => {
    if (message.type === 'workflows:readCache') return saved;
    saved = JSON.parse(JSON.stringify(message.value));
    return null;
  });
  const first = new WorkflowIndex({ context, fetch: transport() });
  await first.load(new AbortController().signal);
  first.dispose();
  const second = new WorkflowIndex({
    context,
    fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 })),
  });
  let last!: WorkflowIndexSnapshot;
  second.subscribe((snapshot) => {
    last = snapshot;
  });
  await second.load(new AbortController().signal);
  expect(computeCoverage(last)).toMatchObject({
    refreshing: false,
    status: { kind: 'gaps', count: 1 },
  });
  expect(
    searchWorkflows(last, {
      query: 'synthetic pear',
      scope: 'code',
      modules: [],
      active: 'all',
      triggerTypes: [],
      triggerFieldApiNames: [],
      actionKinds: [],
    }),
  ).toHaveLength(2);
  second.dispose();
});
