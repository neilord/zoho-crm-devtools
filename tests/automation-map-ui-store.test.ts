import { describe, expect, it, vi } from 'vitest';
import {
  cameraFromHash,
  decodeMapHash,
  encodeMapHash,
  HASH_PREFIX,
  isShareableNodeId,
} from '../src/content/automation-map/ui/deep-link';
import {
  createViewStore,
  defaultFilters,
  defaultViewState,
  sameFilters,
} from '../src/content/automation-map/ui/view-store';

describe('view store', () => {
  it('starts from the defaults and merges the initial state', () => {
    const store = createViewStore({ view: 'list', query: 'Stage' });
    expect(store.get()).toMatchObject({ view: 'list', query: 'Stage', selectedId: null });
    expect(store.get().filters.scope).toBe('active');
  });

  it('notifies once per set with next and prev, and skips no-ops', () => {
    const store = createViewStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ view: 'board', selectedId: 'rule:1' });
    expect(listener).toHaveBeenCalledTimes(1);
    const [next, prev] = listener.mock.calls[0];
    expect(next.view).toBe('board');
    expect(prev.view).toBe('fields');
    store.set({ view: 'board' });
    store.set({ camera: { x: 0, y: 0, zoom: 1 } });
    store.set({ filters: defaultFilters() });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe and survives a throwing listener', () => {
    const store = createViewStore();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = vi.fn();
    store.subscribe(() => {
      throw new Error('boom');
    });
    const off = store.subscribe(ok);
    store.set({ query: 'a' });
    expect(ok).toHaveBeenCalledTimes(1);
    off();
    store.set({ query: 'ab' });
    expect(ok).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('clamps trace depth to 0-6', () => {
    const store = createViewStore();
    store.set({ traceDepth: { upstream: 99, downstream: -3 } });
    expect(store.get().traceDepth).toEqual({ upstream: 6, downstream: 0 });
  });

  it('compares filters structurally', () => {
    const a = defaultFilters();
    const b = { ...defaultFilters(), modules: new Set(['Deals']) };
    expect(sameFilters(a, defaultFilters())).toBe(true);
    expect(sameFilters(a, b)).toBe(false);
  });
});

describe('hash codec', () => {
  const state = () => ({
    ...defaultViewState(),
    view: 'board' as const,
    selectedId: 'rule:4823',
    field: { moduleApiName: 'Deals', fieldApiName: 'Stage' },
    query: 'Stage; gate = "a b"',
    focusModuleApiName: 'Deals',
    camera: { x: 100, y: 40, zoom: 0.92 },
    filters: {
      scope: 'everything' as const,
      modules: new Set(['Deals', 'Accounts']),
      kinds: new Set(['rule', 'function'] as const),
      triggerTypes: new Set(['field_update'] as const),
      flags: new Set(['writesFields'] as const),
    },
  });

  it('round-trips every encodable field', () => {
    const hash = encodeMapHash(state(), { viewport: { width: 1000, height: 600 } });
    expect(hash.startsWith(`${HASH_PREFIX}v1;view=board;`)).toBe(true);
    const decoded = decodeMapHash(hash);
    expect(decoded).not.toBeNull();
    const out = decoded?.state;
    expect(out?.view).toBe('board');
    expect(out?.selectedId).toBe('rule:4823');
    expect(out?.inspectorOpen).toBe(true);
    expect(out?.field).toEqual({ moduleApiName: 'Deals', fieldApiName: 'Stage' });
    expect(out?.query).toBe('Stage; gate = "a b"');
    expect(out?.focusModuleApiName).toBe('Deals');
    expect(out?.filters?.scope).toBe('everything');
    expect([...(out?.filters?.modules ?? [])]).toEqual(['Accounts', 'Deals']);
    expect([...(out?.filters?.kinds ?? [])]).toEqual(['function', 'rule']);
    expect([...(out?.filters?.triggerTypes ?? [])]).toEqual(['field_update']);
    expect([...(out?.filters?.flags ?? [])]).toEqual(['writesFields']);
    const camera = cameraFromHash(decoded?.camera as NonNullable<typeof decoded>['camera'] & {}, {
      width: 1000,
      height: 600,
    });
    expect(camera.zoom).toBe(0.92);
    expect(camera.x).toBeCloseTo(100, 0);
    expect(camera.y).toBeCloseTo(40, 0);
  });

  it('round-trips a trace', () => {
    const s = {
      ...defaultViewState(),
      view: 'trace' as const,
      traceRootId: 'function:f-003',
      traceDepth: { upstream: 1, downstream: 4 },
    };
    const decoded = decodeMapHash(encodeMapHash(s));
    expect(decoded?.state.view).toBe('trace');
    expect(decoded?.state.traceRootId).toBe('function:f-003');
    expect(decoded?.state.traceDepth).toEqual({ upstream: 1, downstream: 4 });
  });

  it('omits defaults', () => {
    expect(encodeMapHash(defaultViewState())).toBe('#zcdt-map=v1;view=fields');
  });

  it('falls back to the board when a trace view has no shareable root', () => {
    const s = { ...defaultViewState(), view: 'trace' as const, traceRootId: null };
    expect(encodeMapHash(s)).toContain('view=board');
  });

  it('never writes CRM text other than ids, API names and the typed query', () => {
    const s = {
      ...defaultViewState(),
      selectedId: 'external:urlHost:hooks.example.invalid',
      traceRootId: 'external:connection:partner_sync',
      view: 'trace' as const,
      filters: { ...defaultFilters(), modules: new Set(['Deals', 'Has Space;x=1']) },
    };
    const hash = encodeMapHash(s);
    expect(hash).not.toContain('example.invalid');
    expect(hash).not.toContain('partner_sync');
    expect(hash).not.toContain('Has Space');
    expect(isShareableNodeId('external:urlHost:x')).toBe(false);
    expect(isShareableNodeId('rule:4823')).toBe(true);
    expect(isShareableNodeId('field:*.*')).toBe(true);
  });

  it('writes only the view and the revealed node in a teaser', () => {
    const s = { ...state(), view: 'list' as const };
    expect(encodeMapHash(s, { teaser: true })).toBe('#zcdt-map=v1;view=list;sel=rule:4823');
  });

  it.each([
    ['', 'empty'],
    ['#other=1', 'foreign hash'],
    ['#zcdt-map=', 'no version'],
    ['#zcdt-map=v2;view=board', 'unknown version'],
    ['#zcdt-map=v1;view=nope', 'unknown view'],
    ['#zcdt-map=v1;view=board;view=list', 'duplicate key'],
    ['#zcdt-map=v1;view', 'token without a value'],
    ['#zcdt-map=v1;sel=external:urlHost:evil.example', 'external ids are not shareable'],
    ['#zcdt-map=v1;sel=<img src=x>', 'markup in an id'],
    ['#zcdt-map=v1;sel=rule:1%202', 'encoded junk in an id'],
    ['#zcdt-map=v1;field=Deals', 'field without a module'],
    ['#zcdt-map=v1;field=Deals.Stage.Extra', 'field with extra segments'],
    ['#zcdt-map=v1;scope=maybe', 'unknown scope'],
    ['#zcdt-map=v1;q=%E0%A4%A', 'malformed percent encoding'],
    [`#zcdt-map=v1;q=${'a'.repeat(201)}`, 'oversized query'],
    ['#zcdt-map=v1;mods=Deals,<b>', 'bad module name'],
    ['#zcdt-map=v1;kinds=rule,spaceship', 'unknown kind'],
    ['#zcdt-map=v1;tt=sometimes', 'unknown trigger type'],
    ['#zcdt-map=v1;flags=everything', 'unknown flag'],
    ['#zcdt-map=v1;z=9;c=1,1', 'zoom above range'],
    ['#zcdt-map=v1;z=0.01;c=1,1', 'zoom below range'],
    ['#zcdt-map=v1;z=1', 'zoom without centre'],
    ['#zcdt-map=v1;c=1,1', 'centre without zoom'],
    ['#zcdt-map=v1;z=1;c=abc', 'non-numeric centre'],
    ['#zcdt-map=v1;z=1;c=99999999,1', 'centre out of range'],
    ['#zcdt-map=v1;trace=rule:1,9,1', 'trace depth above 6'],
    ['#zcdt-map=v1;trace=rule:1,1', 'trace missing a depth'],
    ['#zcdt-map=v1;trace=rule:1,1.5,1', 'fractional trace depth'],
    ['#zcdt-map=v1;view=trace', 'trace view without a root'],
  ])('rejects %s (%s)', (hash) => {
    expect(decodeMapHash(hash)).toBeNull();
  });

  it('ignores unknown keys from newer builds', () => {
    const decoded = decodeMapHash('#zcdt-map=v1;view=list;future=1');
    expect(decoded?.state.view).toBe('list');
  });
});
