import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AutomationMapSnapshot,
  MapCoverage,
  MapFailure,
} from '../src/content/automation-map/types';
import { coverageView } from '../src/content/automation-map/ui/model';
import { click, key, type MountedMap, mountMap, mountWithStore } from './automation-map-ui-helpers';
import { createFixturePort } from './fixtures/automation-map-port';

let map: MountedMap | null = null;
afterEach(() => {
  map?.handle.close();
  map = null;
  document.body.replaceChildren();
  history.replaceState(null, '', location.pathname);
  vi.useRealTimers();
});
const text = (m: MountedMap, selector: string) => m.q(selector)?.textContent ?? '';
const fullSnapshot = () => createFixturePort('full').port.snapshot();
const withCoverage = (
  patch: Partial<MapCoverage>,
  extra: Partial<AutomationMapSnapshot> = {},
): AutomationMapSnapshot => {
  const base = fullSnapshot();
  return { ...base, ...extra, coverage: { ...base.coverage, ...patch } };
};

describe('rail: facets and filters', () => {
  it('toggles scope and describes it', () => {
    map = mountWithStore({ view: 'list' });
    const store = map.recorded.store();
    expect(text(map, '.am-scope + .help')).toContain(
      'Active rules, buttons, schedules, API functions',
    );
    click(map.q('[data-fk="scope:everything"]'));
    expect(store.get().filters.scope).toBe('everything');
    expect(text(map, '.am-scope + .help')).toContain(
      'Adds inactive rules, unassociated functions and unused templates.',
    );
    expect(map.q('[data-fk="scope:everything"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('filters by module with counts, and the chip removes it again', () => {
    map = mountWithStore({ view: 'list' });
    const store = map.recorded.store();
    const row = map.q('[data-fk="mod:Deals"]') as HTMLElement;
    expect(row.querySelector('.n')?.textContent).toMatch(/^\d+$/);
    click(row);
    expect([...store.get().filters.modules]).toEqual(['Deals']);
    expect(text(map, '.am-state')).toContain('Module: Deals');
    expect(map.q('.am-state')?.classList.contains('on')).toBe(true);
    click(map.q('.am-state .fs-chip button'));
    expect(store.get().filters.modules.size).toBe(0);
    expect(map.q('.am-state')?.classList.contains('on')).toBe(false);
  });

  it('turns the legend into a kind filter where hiding a kind keeps all the others', () => {
    map = mountWithStore({ view: 'list' });
    const store = map.recorded.store();
    click(map.q('[data-fk="kind:action"]'));
    const kinds = [...store.get().filters.kinds];
    expect(kinds).not.toContain('action');
    expect(kinds).toEqual(expect.arrayContaining(['rule', 'function', 'field']));
    expect(map.q('[data-fk="kind:action"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(text(map, '.am-state')).toContain('Hidden: Actions');
    expect(map.qa('.lt-row .kd').some((c) => c.textContent?.includes('Field update'))).toBe(false);
    click(map.q('[data-fk="kind:action"]'));
    expect(store.get().filters.kinds.size).toBe(0);
  });

  it('refuses to hide the last visible kind', () => {
    map = mountWithStore({ view: 'list' });
    const store = map.recorded.store();
    store.set({ filters: { ...store.get().filters, kinds: new Set(['rule']) } });
    click(map.q('[data-fk="kind:rule"]'));
    expect([...store.get().filters.kinds]).toEqual(['rule']);
    expect(text(map, '.toast')).toContain('At least one kind has to stay visible.');
  });

  it('offers only the trigger types that exist, and the flags that the contract can express', () => {
    map = mountWithStore({ view: 'list' });
    const store = map.recorded.store();
    const triggers = map.qa('[data-fk^="trig:"]').map((b) => b.dataset.fk);
    expect(triggers).toContain('trig:field_update');
    expect(triggers.length).toBeLessThan(13);
    click(map.q('[data-fk="trig:field_update"]'));
    expect([...store.get().filters.triggerTypes]).toEqual(['field_update']);
    expect(
      map
        .qa('.lt-row')
        .every(
          (r) => !/Workflow rule/.test(r.textContent ?? '') || /modified/.test(r.textContent ?? ''),
        ),
    ).toBe(true);
    expect(map.qa('[data-fk^="flag:"]').map((b) => b.dataset.fk)).toEqual([
      'flag:writesFields',
      'flag:callsExternal',
      'flag:cascades',
      'flag:restApi',
      'flag:gaps',
    ]);
    click(map.q('[data-fk="flag:gaps"]'));
    expect(store.get().filters.flags.has('gaps')).toBe(true);
    click(map.q('[data-fk="clear-all"]'));
    expect(store.get().filters.triggerTypes.size + store.get().filters.flags.size).toBe(0);
  });

  it('flies to a module on the board from the rail', () => {
    map = mountWithStore({ view: 'list' });
    click(map.q('[data-fk="fly:Deals"]'));
    expect(map.recorded.store().get()).toMatchObject({
      view: 'board',
      focusModuleApiName: 'Deals',
    });
  });

  it('keeps focus on the toggled control when the rail rebuilds', () => {
    map = mountWithStore({ view: 'list' });
    const button = map.q('[data-fk="flag:cascades"]') as HTMLElement;
    button.focus();
    click(button);
    expect((map.shadow.activeElement as HTMLElement | null)?.dataset.fk).toBe('flag:cascades');
  });
});

describe('search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders the first keystroke at once, debounces the burst by about 160 ms, flushes on Enter', () => {
    map = mountWithStore({ view: 'list' });
    const store = map.recorded.store();
    const input = map.q('.am-search input') as HTMLInputElement;
    const type = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    // Leading edge: a single keystroke after idle is not held back.
    type('s');
    expect(store.get().query).toBe('s');
    // The rest of the burst waits for the trailing edge.
    type('st');
    type('stage');
    vi.advanceTimersByTime(120);
    expect(store.get().query).toBe('s');
    vi.advanceTimersByTime(60);
    expect(store.get().query).toBe('stage');
    // After the window has gone quiet the next keystroke is immediate again.
    vi.advanceTimersByTime(200);
    type('stage g');
    expect(store.get().query).toBe('stage g');
    type('stage gate');
    key(input, 'Enter');
    expect(store.get().query).toBe('stage gate');
  });

  it('switches the rail to grouped results with provenance, fields first', () => {
    map = mountWithStore({ view: 'list', query: 'stage' });
    expect(text(map, '.rail-results h4')).toContain('Results for "stage"');
    const groups = map.qa('.rgroup h5').map((h) => h.textContent ?? '');
    expect(groups[0]).toMatch(/^Fields/);
    expect(groups.some((g) => g.startsWith('Functions'))).toBe(true);
    expect(
      map
        .qa('.ritem .prov')
        .some((p) =>
          /in name|in code · line \d+|in criteria|in field update value/.test(p.textContent ?? ''),
        ),
    ).toBe(true);
    expect(map.q('.am-search .cnt')?.textContent).toMatch(/\d+ matches?/);
    expect(map.q('.rail-results .back')).not.toBeNull();
  });

  it('opens a field result in the lens and other results on the board or in place', () => {
    map = mountWithStore({ view: 'list', query: 'stage' });
    const store = map.recorded.store();
    click(map.qa('.rgroup')[0].querySelector('.ritem'));
    expect(store.get().view).toBe('fields');
    expect(store.get().field).not.toBeNull();
    store.set({ view: 'list' });
    const fn = map.qa('.ritem').find((r) => r.dataset.id?.startsWith('function:')) as HTMLElement;
    click(fn);
    expect(store.get()).toMatchObject({
      view: 'list',
      selectedId: fn.dataset.id,
      inspectorOpen: true,
    });
    store.set({ view: 'fields', field: null });
    const rule = map.qa('.ritem').find((r) => r.dataset.id?.startsWith('rule:')) as HTMLElement;
    click(rule);
    expect(store.get().view).toBe('board');
  });

  it('steps through matches on Enter, wrapping, and reports the position', () => {
    map = mountWithStore({ view: 'board', query: 'maintain_deals' });
    const store = map.recorded.store();
    const input = map.q('.am-search input') as HTMLInputElement;
    input.focus();
    const total = Number(map.q('.am-search .cnt')?.textContent?.match(/(\d+)/)?.[1]);
    expect(total).toBeGreaterThan(1);
    key(input, 'Enter');
    const first = store.get().selectedId;
    expect(map.q('.am-search .cnt')?.textContent).toBe(`1 / ${total}`);
    key(input, 'Enter');
    expect(store.get().selectedId).not.toBe(first);
    expect(map.q('.am-search .cnt')?.textContent).toBe(`2 / ${total}`);
    key(input, 'Enter', { shiftKey: true });
    expect(store.get().selectedId).toBe(first);
    key(input, 'Enter', { shiftKey: true });
    expect(map.q('.am-search .cnt')?.textContent).toBe(`${total} / ${total}`);
  });

  it('moves into the results with ArrowDown and back with ArrowUp', () => {
    map = mountWithStore({ view: 'list', query: 'stage' });
    const input = map.q('.am-search input') as HTMLInputElement;
    input.focus();
    key(input, 'ArrowDown');
    const first = map.q('.ritem') as HTMLElement;
    expect(map.shadow.activeElement).toBe(first);
    key(first, 'ArrowUp');
    expect(map.shadow.activeElement).toBe(input);
  });

  it('supports module: and kind: prefixes that narrow the results', () => {
    map = mountWithStore({ view: 'list', query: 'kind:button' });
    const ids = map.qa('.ritem').map((r) => r.dataset.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id?.startsWith('button:'))).toBe(true);
    map.recorded.store().set({ query: 'module:Deals kind:function maintain' });
    const fns = map.qa('.ritem').map((r) => r.dataset.id);
    expect(fns.length).toBeGreaterThan(0);
    expect(fns.every((id) => id?.startsWith('function:'))).toBe(true);
    map.recorded.store().set({ query: 'module:Nowhere' });
    expect(text(map, '.rail-results .lens-empty')).toContain(
      'No module or kind matches that prefix',
    );
  });

  it('opens the lens directly for a field: query on Enter', () => {
    map = mountWithStore({ view: 'board', query: 'field:Deals.Stage' });
    const input = map.q('.am-search input') as HTMLInputElement;
    expect(text(map, '.field-open')).toContain('Open field lens · Deals › Stage');
    input.focus();
    key(input, 'Enter');
    expect(map.recorded.store().get()).toMatchObject({
      view: 'fields',
      field: { moduleApiName: 'Deals', fieldApiName: 'Stage' },
    });
  });

  it('explains an empty result and how coverage affects it', () => {
    map = mountWithStore({ view: 'list', query: 'definitely-nothing' });
    expect(text(map, '.rail-results .lens-empty')).toContain(
      'No matches for "definitely-nothing" in the mapped automation.',
    );
    expect(text(map, '.rail-results .lens-empty')).toMatch(
      /could not be read, so their code is not searchable/,
    );
  });

  it('clears the search from the box, the button and the rail', () => {
    map = mountWithStore({ view: 'list', query: 'stage' });
    const store = map.recorded.store();
    click(map.q('.rail-results .back'));
    expect(store.get().query).toBe('');
    expect((map.q('.am-search input') as HTMLInputElement).value).toBe('');
    expect(map.q('.am-scope')).not.toBeNull();
  });
});

describe('coverage pill, popover and banners', () => {
  it('reports mapped-with-gaps and lists every row in the popover', () => {
    map = mountMap();
    expect(text(map, '.wf-index .wf-pill')).toContain('Mapped · 2 gaps');
    click(map.q('.wf-index .wf-pill'));
    const labels = map.qa('.wf-pop .cov .lbl').map((l) => l.textContent);
    expect(labels).toEqual([
      'Workflow rules',
      'Rule details',
      'Functions',
      'Code analysed',
      'Buttons & schedules',
      'Blueprints & approvals',
    ]);
    expect(text(map, '.wf-pop')).toMatch(/source unavailable/);
    expect(map.qa('.wf-pop [role="progressbar"]').length).toBe(6);
    // outside click closes it
    map.q('.am-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: false }));
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });

  it('closes the popover on a mousedown elsewhere in the panel', () => {
    map = mountMap();
    click(map.q('.wf-index .wf-pill'));
    (map.q('.am-main') as HTMLElement).dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, composed: true }),
    );
    expect(map.q('.wf-pop')).toBeNull();
  });

  it('shows a clean pill when nothing is wrong', () => {
    const base = fullSnapshot();
    const clean = withCoverage({
      functions: {
        ...base.coverage.functions,
        limited: 0,
        unsupported: 0,
        sourceUnavailable: 0,
        failed: 0,
        analyzed: 60,
        pending: 0,
      },
      gaps: 0,
      isComplete: true,
    });
    map = mountMap({ snapshot: clean });
    expect(text(map, '.wf-pill')).toContain('Mapped');
    expect(text(map, '.wf-pill')).not.toContain('gap');
    expect(map.q('.wf-pill')?.classList.contains('ok')).toBe(true);
  });

  it('shows progress while mapping, never 100% before the phase completes, and a progress banner on the board', () => {
    map = mountMap({ mode: 'loading', initialState: { view: 'board' } });
    const pill = text(map, '.wf-pill');
    const percent = Number(pill.match(/Mapping (\d+)%/)?.[1]);
    expect(percent).toBeGreaterThanOrEqual(0);
    expect(percent).toBeLessThan(100);
    expect(map.q('.wf-pill .mini i')).not.toBeNull();
    expect(text(map, '.am-banner')).toContain(`Mapping ${percent}%.`);
    expect(text(map, '.am-foot .footstatus')).toContain('Mapping');
    const view = coverageView(withCoverage({}, { phase: 'enriching' }));
    expect(view.percent).toBeLessThan(100);
    expect(coverageView(withCoverage({}, { phase: 'complete' })).percent).toBe(100);
  });

  it('updates progressively without rebuilding on every snapshot (throttled)', () => {
    vi.useFakeTimers();
    map = mountMap({ mode: 'loading', initialState: { view: 'list' } });
    const before = text(map, '.wf-pill');
    const base = createFixturePort('loading').port.snapshot();
    const advance = (detailed: number) =>
      map?.publish({
        ...base,
        coverage: { ...base.coverage, rules: { ...base.coverage.rules, detailed } },
      });
    advance(10);
    advance(20);
    advance(30);
    expect(text(map, '.wf-pill')).toBe(before);
    vi.advanceTimersByTime(160);
    expect(text(map, '.wf-pill')).not.toBe(before);
    advance(45);
    vi.advanceTimersByTime(160);
    const afterPercent = Number(text(map, '.wf-pill').match(/(\d+)%/)?.[1]);
    expect(afterPercent).toBeGreaterThan(Number(before.match(/(\d+)%/)?.[1]));
  });

  it('announces mapping milestones and the finished map in a live region', () => {
    vi.useFakeTimers();
    map = mountMap({ mode: 'loading', initialState: { view: 'list' } });
    const base = createFixturePort('loading').port.snapshot();
    const at = (detailed: number, analysed: number) =>
      map?.publish({
        ...base,
        phase: 'enriching',
        coverage: {
          ...base.coverage,
          rules: { ...base.coverage.rules, detailed },
          functions: { ...base.coverage.functions, analyzed: analysed },
        },
      });
    const live = () => text(map as MountedMap, '[role="status"].sr-only');
    at(45, 0);
    vi.advanceTimersByTime(200);
    expect(live()).toMatch(/^Mapping (25|50)%$/);
    at(45, 55);
    vi.advanceTimersByTime(200);
    expect(live()).toMatch(/^Mapping (50|75)%$/);
    map.publish({ ...fullSnapshot(), phase: 'complete' });
    vi.advanceTimersByTime(200);
    expect(live()).toBe('Map ready with 2 gaps');
  });

  it('shows the gaps banner on the board and lets the user dismiss it', () => {
    map = mountMap({ initialState: { view: 'board' } });
    expect(text(map, '.am-banner')).toContain('2 gaps in the map.');
    click(map.q('[data-fk="banner-gaps"]'));
    expect(map.q('.wf-pop')).not.toBeNull();
    click(map.q('[data-fk="banner-x"]'));
    expect(map.q('.am-banner')).toBeNull();
  });

  it('retries one failure from the popover and all of them from the footer', () => {
    const failure = (id: string): MapFailure => ({
      id,
      message: `Source for ${id} failed to load`,
      retry: async () => {},
    });
    map = mountMap({
      snapshot: withCoverage({ failures: [failure('a'), failure('b')] }),
    });
    click(map.q('.wf-index .wf-pill'));
    expect(map.qa('.failures li')).toHaveLength(2);
    click(map.q('[data-fk="retry:b"]'));
    expect(map.calls.retries).toEqual(['b']);
    click(map.q('[data-fk="retry-all"]'));
    expect(map.calls.retries).toEqual(['b', undefined]);
  });

  it('shows the failed and empty-org states with a retry that works', () => {
    const empty = {
      nodes: new Map(),
      edges: [],
      outgoing: new Map(),
      incoming: new Map(),
      modules: [],
    };
    map = mountMap({ snapshot: { ...fullSnapshot(), graph: empty, phase: 'failed' } });
    expect(text(map, '.am-cover h3')).toBe("Couldn't load your automation");
    expect(text(map, '.wf-pill')).toContain('Map failed');
    click(map.q('[data-fk="cover-retry"]'));
    expect(map.calls.retries).toEqual([undefined]);
    map.handle.close();
    map = mountMap({ snapshot: { ...fullSnapshot(), graph: empty, phase: 'complete' } });
    expect(text(map, '.am-cover h3')).toBe('No automation yet');
  });

  it('marks background refresh without hiding what is already on screen', () => {
    map = mountMap({ snapshot: withCoverage({ refreshing: true }) });
    expect(text(map, '.am-foot .footstatus')).toContain('refreshing…');
    expect(map.q('.lens-start')).not.toBeNull();
  });

  it('keeps the footer totals and shortcut hints', () => {
    map = mountMap();
    expect(text(map, '.am-foot .footstatus')).toBe('45 rules · 60 functions · 9 modules');
    expect(map.qa('.am-foot .hints .kbd').map((k) => k.textContent)).toEqual(
      expect.arrayContaining(['/', 'F', 'B', 'L', 'T', 'Esc', '?']),
    );
  });
});

describe('deep links', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('restores state from the hash on mount and lets explicit options win', () => {
    history.replaceState(
      null,
      '',
      `${location.pathname}#zcdt-map=v1;view=list;scope=all;sel=rule:rule-003;q=stage`,
    );
    map = mountMap();
    expect(map.q('#am-list')?.hasAttribute('hidden')).toBe(false);
    expect((map.q('.am-search input') as HTMLInputElement).value).toBe('stage');
    expect(map.q('.am-insp.open')).not.toBeNull();
    map.handle.close();
    history.replaceState(null, '', `${location.pathname}#zcdt-map=v1;view=list`);
    map = mountMap({ initialState: { view: 'fields' } });
    expect(map.q('#am-fields')?.hasAttribute('hidden')).toBe(false);
  });

  it('ignores a junk hash instead of half-applying it', () => {
    history.replaceState(null, '', `${location.pathname}#zcdt-map=v1;view=list;sel=<b>`);
    map = mountMap();
    expect(map.q('#am-fields')?.hasAttribute('hidden')).toBe(false);
    expect(map.q('.am-insp.open')).toBeNull();
  });

  it('writes the hash (debounced) as the view changes, and removes it on close', async () => {
    map = mountWithStore({});
    const store = map.recorded.store();
    store.set({ view: 'list', selectedId: 'rule:rule-003', inspectorOpen: true });
    vi.advanceTimersByTime(100);
    expect(location.hash).not.toContain('sel=');
    vi.advanceTimersByTime(250);
    expect(decodeURIComponent(location.hash)).toBe('#zcdt-map=v1;view=list;sel=rule:rule-003');
    // Closing pops the history entry the map pushed; jsdom performs that a (faked) task later.
    map.handle.close();
    await vi.advanceTimersByTimeAsync(10);
    expect(location.hash).toBe('');
  });

  it('leaves a hash that is not ours alone on close', async () => {
    history.replaceState(null, '', `${location.pathname}#other`);
    map = mountMap();
    map.handle.close();
    await vi.advanceTimersByTimeAsync(10);
    expect(location.hash).toBe('#other');
  });

  it('does not rewrite the page on camera movement alone', () => {
    map = mountWithStore({});
    const store = map.recorded.store();
    const replace = vi.spyOn(history, 'replaceState');
    store.set({ camera: { x: 10, y: 20, zoom: 0.5 } });
    store.set({ hoverId: 'rule:rule-003' });
    vi.advanceTimersByTime(400);
    expect(replace.mock.calls.every(([, , url]) => String(url).includes('#zcdt-map='))).toBe(true);
    replace.mockRestore();
  });
});
