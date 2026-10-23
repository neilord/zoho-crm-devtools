import { describe, expect, it, vi } from 'vitest';
import {
  AutomationMapApi,
  catalogueInput,
  patchLargeIntegers,
} from '../src/content/automation-map/data/zoho-api';
import { catalogue, context, moduleWire, syntheticFetch } from './automation-map-data-fixtures';

const api = (fetch = syntheticFetch()) =>
  new AutomationMapApi(context, fetch as typeof globalThis.fetch, new AbortController().signal);

describe('Automation Map precision-safe read adapters', () => {
  it('patches only integer tokens before JSON parsing, including escaped strings', () => {
    const raw =
      '{"id":1234567890123456789,"n":-1234567890123456,"s":"1234567890123456789 \\"quoted\\"","safe":123,"decimal":1234567890123456.5,"exponent":1234567890123456e2}';
    const parsed = JSON.parse(patchLargeIntegers(raw));
    expect(parsed.id).toBe('1234567890123456789');
    expect(parsed.n).toBe('-1234567890123456');
    expect(parsed.s).toBe('1234567890123456789 "quoted"');
    expect(parsed.safe).toBe(123);
    expect(typeof parsed.decimal).toBe('number');
    expect(typeof parsed.exponent).toBe('number');
  });
  it('maps catalogue associations, REST metadata and cheap integration counts without precision loss', async () => {
    const request = vi.fn(
      async () =>
        new Response(
          '{"functions":[{"id":1234567890123456789,"display_name":"Invented","category":"button","associated_place":[{"id":2234567890123456789,"_type":"custom_buttons","module":"Orchard gardens"}],"rest_api":[{"type":"zapikey","active":true}],"tasks":{"integrations":[{"service":"crm","function":"updateRecord"}]}}]}',
        ),
    );
    const [input] = await api(request).catalogue();
    expect(input.delugeId).toBe('1234567890123456789');
    expect(input.places[0]).toMatchObject({
      id: '2234567890123456789',
      modulePluralLabel: 'Orchard gardens',
      type: 'custom_buttons',
    });
    expect(input.summary.rest_api?.[0].type).toBe('zapikey');
    expect(input.summary.tasks?.integrations).toHaveLength(1);
    expect(request.mock.calls[0]).toMatchObject([
      expect.stringContaining('/crm/v2/settings/functions?type=org&start=1&limit=200'),
      {
        method: 'GET',
        credentials: 'include',
        redirect: 'error',
        headers: { 'X-Crm-Org': '123', 'X-Zcsrf-Token': context.csrfHeader },
      },
    ]);
  });
  it('pages the legacy catalogue through full pages and rejects conflicting/repeated identities', async () => {
    const first = Array.from({ length: 200 }, (_, n) => catalogue(String(n + 1)));
    const request = vi.fn(
      syntheticFetch((url) =>
        url.pathname.endsWith('/functions')
          ? Number(url.searchParams.get('start')) === 1
            ? Response.json({ functions: first })
            : new Response(null, { status: 204 })
          : undefined,
      ),
    );
    expect(await api(request).catalogue()).toHaveLength(200);
    expect(request).toHaveBeenCalledTimes(2);
    await expect(
      api(async () =>
        Response.json({ functions: [...first, { ...first[0], api_name: 'conflict' }] }),
      ).catalogue(),
    ).rejects.toThrow('Conflicting');
    await expect(api(async () => Response.json({ functions: first })).catalogue()).rejects.toThrow(
      'no progress',
    );
    expect(catalogueInput({ ...catalogue(), api_name: null }).summary.api_name).toBeNull();
  });
  it('uses more_records after short pages, handles 204 and rejects repeated pages', async () => {
    const request = vi.fn(
      syntheticFetch((url) =>
        url.pathname.endsWith('/schedules')
          ? Response.json({
              schedules: [
                {
                  id: url.searchParams.get('page'),
                  name: 'Invented',
                  status: 'deactive',
                  function: { id: 'other-namespace' },
                  frequency: { type: 'hourly' },
                },
              ],
              info: { more_records: url.searchParams.get('page') === '1' },
            })
          : undefined,
      ),
    );
    const schedules = await api(request).schedules();
    expect(schedules).toHaveLength(2);
    expect(schedules[0]).toMatchObject({
      id: '1',
      active: false,
      functionApiName: null,
      recurrenceLabel: 'hourly',
    });
    expect(await api().schedules()).toEqual([]);
    await expect(
      api(async () =>
        Response.json({ schedules: [{ id: '1' }], info: { more_records: true } }),
      ).schedules(),
    ).rejects.toThrow('no progress');
  });
  it('maps modules/fields and handles empty metadata', async () => {
    expect(await api().modules()).toEqual({
      modules: [{ apiName: 'Orchards', label: 'Orchard garden', pluralLabel: 'Orchard gardens' }],
      workflowModules: ['Orchards'],
    });
    expect(await api().fields('Orchards')).toEqual([
      { apiName: 'Harvest', label: 'Harvest status' },
    ]);
    expect(await api(async () => new Response(null, { status: 204 })).fields('Empty')).toEqual([]);
    expect(
      await api(
        syntheticFetch((url) =>
          url.pathname.endsWith('/modules')
            ? Response.json({ modules: [moduleWire()] })
            : undefined,
        ),
      ).modules(),
    ).toHaveProperty('workflowModules', ['Orchards']);
  });
  it('maps buttons and distinguishes unsupported/permission outcomes from other 400s', async () => {
    const reader = api(async () =>
      Response.json({
        custom_buttons: [
          {
            id: '301',
            name: 'Invented',
            position: 'view',
            action: 'custom_function',
            details: { custom_function: { id: '501' } },
          },
        ],
      }),
    );
    expect((await reader.buttons('Orchards')).buttons[0]).toMatchObject({
      placements: ['view'],
      actionType: 'custom_function',
      functionDelugeId: '501',
      moduleApiName: 'Orchards',
    });
    for (const code of ['NOT_SUPPORTED', 'NO_PERMISSION'])
      expect(
        await api(async () => Response.json({ code }, { status: 400 })).buttons('Orchards'),
      ).toEqual({ buttons: [], unsupported: true });
    expect(await api().buttons('Orchards')).toEqual({ buttons: [], unsupported: false });
    await expect(
      api(async () => Response.json({ code: 'INVALID_DATA' }, { status: 400 })).buttons('Orchards'),
    ).rejects.toThrow('unavailable');
  });
  it('uses strict function detail identity and treats absent/204 source as unavailable', async () => {
    expect(await api().source(catalogue())).toContain('updateRecord');
    for (const response of [
      new Response(null, { status: 204 }),
      Response.json({ functions: [{ id: '999', script: 'private' }] }),
      Response.json({ functions: [{ id: '501' }] }),
    ])
      expect(await api(async () => response).source(catalogue())).toBeNull();
  });
  it('resolves blueprint actions and stage/during inputs, approval final/rejection/stage actions', async () => {
    const calls: string[] = [];
    const reader = api(
      syntheticFetch((url) => {
        calls.push(url.pathname);
        if (url.pathname.endsWith('/blueprints'))
          return Response.json({
            blueprints: [
              {
                id: '701',
                name: 'Invented blueprint',
                active: true,
                module: { api_name: 'Orchards' },
                field: { api_name: 'Stage' },
              },
            ],
            info: { more_records: false },
          });
        if (url.pathname.endsWith('/701/transitions'))
          return Response.json({ transitions: [{ id: '711' }], info: { more_records: false } });
        if (url.pathname.endsWith('/transitions/711'))
          return Response.json({
            transitions: [
              {
                id: '711',
                name: 'Advance',
                during_inputs: [
                  { type: 'field', field: { api_name: 'Harvest' } },
                  { type: 'notes' },
                ],
                actions: [{ id: '801', type: 'field_updates' }],
              },
            ],
          });
        if (url.pathname.endsWith('/approval_process'))
          return Response.json({
            approval_process: [
              {
                id: '901',
                name: 'Invented approval',
                active: false,
                module: { api_name: 'Orchards' },
              },
            ],
          });
        if (url.pathname.endsWith('/901/rules'))
          return Response.json({
            rules: [
              {
                id: '911',
                actions_upon_final_approval: { actions: [{ id: '801', type: 'field_updates' }] },
                actions_upon_rejection: { actions: [{ id: '802', type: 'tasks' }] },
                approver_stages: [
                  { actions: { on_approval_trigger: [{ rid: '803', type: 'functions' }] } },
                ],
              },
            ],
          });
        if (url.pathname.endsWith('/field_updates/801'))
          return Response.json({
            field_updates: [{ id: '801', field: { api_name: 'Harvest' }, value: 'ready' }],
          });
        if (url.pathname.endsWith('/tasks/802'))
          return Response.json({
            tasks: [
              { id: '802', field_mappings: [{ field: { api_name: 'Subject' }, value: 'Review' }] },
            ],
          });
        if (url.pathname.endsWith('/functions/803'))
          return Response.json({
            functions: [{ id: '803', function: { id: 'different-crm-id', api_name: 'fn_501' } }],
          });
        return undefined;
      }),
    );
    const [transition] = await reader.blueprints(),
      [approval] = await reader.approvals();
    expect(transition).toMatchObject({
      blueprintId: '701',
      transitionId: '711',
      duringInputFields: ['Harvest', 'Stage'],
      actions: [{ kind: 'fieldUpdate', field: { apiName: 'Harvest' }, state: 'loaded' }],
    });
    expect(approval).toMatchObject({
      active: false,
      moduleApiName: 'Orchards',
      actions: [
        { kind: 'fieldUpdate' },
        { kind: 'task', subject: 'Review' },
        { kind: 'function', apiName: 'fn_501', crmFunctionId: 'different-crm-id' },
      ],
    });
    expect(calls.filter((p) => p.endsWith('/field_updates/801'))).toHaveLength(1);
  });
  it('never contacts configured URLs and rejects cross-origin reads', async () => {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({
        webhooks: [{ id: '12', url: 'https://configured.invalid/hook', http_method: 'POST' }],
      }),
    );
    const reader = api(request);
    expect(await reader.action({ id: '12', type: 'webhooks' })).toHaveProperty(
      'url',
      'https://configured.invalid/hook',
    );
    await expect(reader.get('https://configured.invalid/crm/a')).rejects.toThrow('Invalid');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toContain(context.origin);
  });
});

it('continues past an empty post-filter page when more_records is true', async () => {
  const reader = api(
    syntheticFetch((url) =>
      url.pathname.endsWith('/schedules')
        ? Response.json({
            schedules: url.searchParams.get('page') === '1' ? [] : [{ id: '19', name: 'Invented' }],
            info: { more_records: url.searchParams.get('page') === '1' },
          })
        : undefined,
    ),
  );
  expect(await reader.schedules()).toHaveLength(1);
});

// A fetch/bridge may expose an empty stream even for a null-body status. Buffering that
// stream into new Response(bytes, {status: 204}) throws before the adapter sees it.
it('preserves 204 through shared buffering even when transport exposes an empty stream', async () => {
  const response = new Response('');
  Object.defineProperty(response, 'status', { value: 204 });
  expect(await api(async () => response).buttons('Orchards')).toEqual({
    buttons: [],
    unsupported: false,
  });
});

it('spaces every 503/429/5xx retry exponentially with jitter and Retry-After', async () => {
  vi.useFakeTimers();
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const times: number[] = [];
  let attempt = 0;
  const reader = api(async () => {
    times.push(Date.now());
    const status = [503, 429, 502, 204][attempt++];
    return new Response(null, { status, headers: status === 429 ? { 'Retry-After': '2' } : {} });
  });
  try {
    const result = reader.buttons('Orchards');
    await vi.advanceTimersByTimeAsync(624);
    expect(times).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(times).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(times).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(times).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(2125);
    await result;
    expect(times.slice(1).map((t, i) => t - times[i])).toEqual([625, 2000, 2125]);
  } finally {
    random.mockRestore();
    vi.useRealTimers();
  }
});

it('keeps retries and their backoff inside the four shared tab slots', async () => {
  vi.useFakeTimers();
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  const calls: { module: string; time: number }[] = [];
  const attempts = new Map<string, number>();
  const reader = api(async (input) => {
    const module = new URL(String(input)).searchParams.get('module') ?? '';
    calls.push({ module, time: Date.now() });
    const n = attempts.get(module) ?? 0;
    attempts.set(module, n + 1);
    return new Response(null, { status: n === 0 ? 503 : 204 });
  });
  try {
    const result = Promise.all(['A', 'B', 'C', 'D', 'E'].map((m) => reader.buttons(m)));
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toHaveLength(4);
    expect(attempts.has('E')).toBe(false);
    await vi.advanceTimersByTimeAsync(501);
    await result;
    for (const module of attempts.keys()) {
      const times = calls.filter((c) => c.module === module).map((c) => c.time);
      expect(times[1] - times[0]).toBe(500);
    }
  } finally {
    random.mockRestore();
    vi.useRealTimers();
  }
});
