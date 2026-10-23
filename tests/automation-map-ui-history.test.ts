/**
 * Browser history and the URL hash (UX spec §11), from live acceptance: view and selection
 * changes did not reach the hash, hash edits and Back did not drive the view, and Back left the
 * Zoho page because history never grew.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, type MountedMap, mountMap, mountWithStore } from './automation-map-ui-helpers';
import { createFixturePort } from './fixtures/automation-map-port';

const MARKER = '__zcdtMap';
const PAGE = '/crm/org1/settings/workflow-rules';
let map: MountedMap | null = null;
let base = 0;

/** Resolves on the next popstate (jsdom performs `history.back()` a task later). */
const popped = () =>
  new Promise<void>((resolve) =>
    window.addEventListener('popstate', () => resolve(), { once: true }),
  );
const hashChanged = () =>
  new Promise<void>((resolve) =>
    window.addEventListener('hashchange', () => resolve(), { once: true }),
  );
const marker = () => (history.state as Record<string, unknown> | null)?.[MARKER];
const decoded = () => decodeURIComponent(location.hash);

beforeEach(() => {
  history.replaceState(null, '', PAGE);
  base = history.length;
});
afterEach(() => {
  map?.handle.close();
  map = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
  history.replaceState(null, '', PAGE);
});

describe('opening the map', () => {
  it('pushes exactly one history entry that carries the hash', () => {
    const push = vi.spyOn(history, 'pushState');
    map = mountMap({ initialState: { view: 'list' } });
    expect(push).toHaveBeenCalledTimes(1);
    expect(history.length).toBe(base + 1);
    expect(decoded()).toBe('#zcdt-map=v1;view=list');
    expect(location.pathname).toBe(PAGE);
    expect(marker()).toEqual(expect.any(String));
  });

  it('keeps whatever state the page router stored on the entry', () => {
    history.replaceState({ router: 'lyte', depth: 3 }, '', PAGE);
    map = mountMap();
    expect(history.state).toMatchObject({ router: 'lyte', depth: 3, [MARKER]: expect.any(String) });
  });

  it('writes only the view until the plan is known', () => {
    const preview = createFixturePort('teaser').port.snapshot();
    map = mountMap({
      initialState: { view: 'board', selectedId: 'rule:rule-003', inspectorOpen: true },
      snapshot: { ...preview, access: { level: 'checking' } },
    });
    expect(decoded()).toBe('#zcdt-map=v1;view=board');
  });

  it('puts the plain page under a map opened from a link, so Back stays on the page', async () => {
    history.replaceState(null, '', `${PAGE}#zcdt-map=v1;view=list;sel=rule:rule-003`);
    map = mountMap();
    expect(map.q('.am-insp.open')).not.toBeNull();
    expect(history.length).toBe(base + 1);
    history.back();
    await popped();
    expect(location.hash).toBe('');
    expect(location.pathname).toBe(PAGE);
    expect(map.closed.count).toBe(1);
  });

  it('does not stack a second entry when a map is replaced', () => {
    map = mountMap({ initialState: { view: 'list' } });
    const first = map;
    const length = history.length;
    const second = mountMap({ initialState: { view: 'board' } });
    expect(history.length).toBe(length);
    expect(first.closed.count).toBe(1);
    map = second;
  });

  it('adopts an entry typed into this tab instead of adding a dead one', () => {
    history.replaceState(null, '', `${PAGE}#zcdt-map=v1;view=list`);
    const entries = [
      { url: `https://crm.zoho.com${PAGE}`, sameDocument: true },
      { url: `https://crm.zoho.com${PAGE}#zcdt-map=v1;view=list`, sameDocument: true },
    ];
    vi.stubGlobal('navigation', { entries: () => entries, currentEntry: { index: 1 } });
    const push = vi.spyOn(history, 'pushState');
    map = mountMap();
    expect(push).not.toHaveBeenCalled();
    expect(history.length).toBe(base);
    expect(marker()).toEqual(expect.any(String));
    vi.unstubAllGlobals();
  });
});

describe('keeping the hash current', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('rewrites the hash, without new entries, as view, selection, field, trace and focus change', () => {
    const push = vi.spyOn(history, 'pushState');
    map = mountWithStore({});
    const store = map.recorded.store();
    push.mockClear();
    const lengthAfterOpen = history.length;
    const settle = () => vi.advanceTimersByTime(350);
    const hash = () => decoded();

    store.set({ view: 'list' });
    settle();
    expect(hash()).toBe('#zcdt-map=v1;view=list');

    store.set({ selectedId: 'rule:rule-003', inspectorOpen: true });
    settle();
    expect(hash()).toBe('#zcdt-map=v1;view=list;sel=rule:rule-003');

    store.set({ view: 'fields', selectedId: null, inspectorOpen: false });
    store.set({ field: { moduleApiName: 'Deals', fieldApiName: 'Stage' } });
    settle();
    expect(hash()).toBe('#zcdt-map=v1;view=fields;field=Deals.Stage');

    store.set({ view: 'board', field: null, focusModuleApiName: 'Deals' });
    settle();
    expect(hash()).toContain('view=board;focus=Deals');

    store.set({
      view: 'trace',
      traceRootId: 'rule:rule-003',
      traceDepth: { upstream: 2, downstream: 3 },
    });
    settle();
    expect(hash()).toContain('view=trace');
    expect(hash()).toContain('trace=rule:rule-003,2,3');

    expect(push).not.toHaveBeenCalled();
    expect(history.length).toBe(lengthAfterOpen);
    expect(marker()).toEqual(expect.any(String));
  });

  it('writes within a second even while snapshots and camera moves keep arriving', () => {
    map = mountWithStore({});
    const store = map.recorded.store();
    store.set({ view: 'list' });
    const snapshot = map.port.snapshot();
    // A trailing debounce alone never fires under a steady stream: it must still surface.
    for (let i = 0; i < 12; i++) {
      map.publish({ ...snapshot });
      store.set({ camera: { x: i, y: i, zoom: 1 } });
      vi.advanceTimersByTime(100);
    }
    expect(decoded()).toContain('view=list');
  });

  it('writes synchronously for Copy link', () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    map = mountWithStore({});
    map.recorded.store().set({ view: 'list', selectedId: 'rule:rule-003', inspectorOpen: true });
    click(map.qa('.ins-acts button').find((b) => b.textContent?.includes('Copy link')));
    expect(decoded()).toBe('#zcdt-map=v1;view=list;sel=rule:rule-003');
    expect(writeText.mock.calls[0][0]).toContain('view=list;sel=rule:rule-003');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('does not write onto a route the page has since moved to', () => {
    map = mountWithStore({});
    history.pushState(null, '', '/crm/org1/settings/other');
    map.recorded.store().set({ view: 'list' });
    vi.advanceTimersByTime(400);
    expect(location.pathname).toBe('/crm/org1/settings/other');
    expect(location.hash).toBe('');
  });

  it('never writes anything but the view and a revealed node in the preview', () => {
    map = mountMap({
      mode: 'teaser',
      initialState: {
        view: 'board',
        query: 'secret',
        field: { moduleApiName: 'Leads', fieldApiName: 'Lead_Status' },
        selectedId: 'rule:9000000000000000991',
        inspectorOpen: true,
      },
    });
    vi.advanceTimersByTime(400);
    expect(decoded()).toBe('#zcdt-map=v1;view=board');
    expect(history.length).toBe(base + 1);
  });
});

describe('Back, Forward and the close button', () => {
  it('closes the map on Back and leaves the page where it was', async () => {
    const push = vi.spyOn(history, 'pushState');
    map = mountMap({ initialState: { view: 'list' } });
    push.mockClear();
    history.back();
    await popped();
    expect(map.closed.count).toBe(1);
    expect(document.getElementById('zcdt-automation-map-overlay')).toBeNull();
    expect(location.pathname).toBe(PAGE);
    expect(location.hash).toBe('');
    // Closing because of Back must not touch history again.
    expect(push).not.toHaveBeenCalled();
  });

  it('pops its own entry when closed from the UI, and Forward comes back to the hash', async () => {
    const back = vi.spyOn(history, 'back');
    map = mountMap({ initialState: { view: 'list' } });
    const length = history.length;
    const done = popped();
    click(map.q('.am-head [aria-label="Close Automation Map"]'));
    expect(back).toHaveBeenCalledTimes(1);
    expect(map.closed.count).toBe(1);
    await done;
    expect(location.hash).toBe('');
    expect(location.pathname).toBe(PAGE);
    expect(history.length).toBe(length);
    history.forward();
    await popped();
    expect(decoded()).toBe('#zcdt-map=v1;view=list');
  });

  it('closes with Escape the same way', async () => {
    const back = vi.spyOn(history, 'back');
    map = mountMap();
    const done = popped();
    map
      .q('.am-panel')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
      );
    expect(back).toHaveBeenCalledTimes(1);
    await done;
    expect(location.hash).toBe('');
  });

  it('only removes the hash when the router replaced its entry', () => {
    const back = vi.spyOn(history, 'back');
    map = mountMap({ initialState: { view: 'list' } });
    // Zoho's router rewrote the state of the entry: it is no longer recognisably ours.
    history.replaceState({ route: 'workflow-rules' }, '', location.href);
    map.handle.close();
    expect(back).not.toHaveBeenCalled();
    expect(location.hash).toBe('');
    expect(location.pathname).toBe(PAGE);
    expect(history.state).toEqual({ route: 'workflow-rules' });
  });

  it('only removes the hash when a hand-edited entry sits above ours', async () => {
    const back = vi.spyOn(history, 'back');
    map = mountMap({ initialState: { view: 'list' } });
    const changed = hashChanged();
    location.hash = '#zcdt-map=v1;view=fields';
    await changed;
    const length = history.length;
    map.handle.close();
    expect(back).not.toHaveBeenCalled();
    expect(location.hash).toBe('');
    expect(history.length).toBe(length);
  });

  it('closes when the hash is edited to something that is not a map hash', async () => {
    map = mountMap();
    const changed = hashChanged();
    location.hash = '#elsewhere';
    await changed;
    expect(map.closed.count).toBe(1);
    expect(location.hash).toBe('#elsewhere');
  });

  it('leaves a native hash alone when it opens and closes', async () => {
    history.replaceState(null, '', `${PAGE}#native`);
    map = mountMap();
    const done = popped();
    map.handle.close();
    await done;
    expect(location.hash).toBe('#native');
  });
});

describe('hash edits while the map is open', () => {
  it('applies the decoded state, and resets what the hash leaves out', async () => {
    map = mountWithStore({
      query: 'stage',
      field: { moduleApiName: 'Deals', fieldApiName: 'Stage' },
    });
    const store = map.recorded.store();
    const changed = hashChanged();
    location.hash = '#zcdt-map=v1;view=list;sel=rule:rule-003;scope=all';
    await changed;
    const s = store.get();
    expect(s.view).toBe('list');
    expect(s.selectedId).toBe('rule:rule-003');
    expect(s.inspectorOpen).toBe(true);
    expect(s.filters.scope).toBe('everything');
    expect(s.query).toBe('');
    expect(s.field).toBeNull();
    expect(map.q('#am-list')?.hasAttribute('hidden')).toBe(false);
    expect(map.q('.am-insp.open')).not.toBeNull();
    expect((map.q('.am-search input') as HTMLInputElement).value).toBe('');
  });

  it('follows Back between two map entries', async () => {
    map = mountWithStore({});
    const store = map.recorded.store();
    store.set({ view: 'list' });
    // Let the debounced write reach the entry before the hand edit pushes another one.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(decoded()).toContain('view=list');
    const changed = hashChanged();
    location.hash = '#zcdt-map=v1;view=fields;field=Deals.Stage';
    await changed;
    expect(store.get().view).toBe('fields');
    expect(store.get().field).toEqual({ moduleApiName: 'Deals', fieldApiName: 'Stage' });
    const back = popped();
    history.back();
    await back;
    expect(map.closed.count).toBe(0);
    expect(store.get().view).toBe('list');
    expect(store.get().field).toBeNull();
  });

  it('ignores a malformed hash instead of half-applying it', async () => {
    map = mountWithStore({ view: 'list' });
    const store = map.recorded.store();
    const changed = hashChanged();
    location.hash = '#zcdt-map=v1;view=board;sel=<b>';
    await changed;
    expect(store.get().view).toBe('list');
    expect(map.closed.count).toBe(0);
  });

  it('keeps the preview boundary: only the view and a revealed node come from a hash', async () => {
    map = mountMap({ mode: 'teaser', initialState: { view: 'board' } });
    const changed = hashChanged();
    location.hash =
      '#zcdt-map=v1;view=trace;sel=rule:9000000000000000991;q=secret;field=Leads.Lead_Status;mods=Leads;trace=rule:9000000000000000991,2,3';
    await changed;
    const state = map.recorded.store().get();
    expect(state).toMatchObject({
      view: 'board',
      selectedId: null,
      traceRootId: null,
      field: null,
      query: '',
    });
    expect(state.filters.modules.size).toBe(0);
    expect(map.shadow.textContent ?? '').not.toContain('9000000000000000991');
    expect(map.closed.count).toBe(0);
  });
});
