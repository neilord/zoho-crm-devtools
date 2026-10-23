/**
 * Regressions from live acceptance in a real org (327 rules, 923 functions): each test pins a
 * defect that was observed there. Fixtures stay synthetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeDelugeEffects } from '../src/content/automation-map/analyzer';
import {
  buildAutomationGraph,
  fieldWriterCount,
  fieldWriters,
} from '../src/content/automation-map/graph';
import type {
  AutomationMapSnapshot,
  FunctionInput,
  MapCoverage,
  MapFilters,
} from '../src/content/automation-map/types';
import {
  boardControllerFor,
  canvasStyles,
  mountBoardView,
  mountTraceView,
} from '../src/content/automation-map/ui/canvas';
import type {
  MapDataPort,
  MapUiContext,
  MapViewState,
  ViewStore,
} from '../src/content/automation-map/ui/context';
import { buildLensModel } from '../src/content/automation-map/ui/lens-model';
import { HOST_ID, mountAutomationMap } from '../src/content/automation-map/ui/overlay';
import { installDomStubs } from './automation-map-canvas-fixtures';
import {
  click,
  key,
  type MountedMap,
  mountMap,
  mountWithStore,
  portForInputs,
} from './automation-map-ui-helpers';
import { fixtureInputs, lensDupesInputs } from './fixtures/automation-map';
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
const withCoverage = (patch: Partial<MapCoverage>): AutomationMapSnapshot => {
  const base = fullSnapshot();
  return { ...base, coverage: { ...base.coverage, ...patch } };
};
const filtersFor = (scope: MapFilters['scope']): MapFilters => ({
  scope,
  modules: new Set(),
  kinds: new Set(),
  triggerTypes: new Set(),
  flags: new Set(),
});
const everything = {
  filters: filtersFor('everything'),
} as const;
const stage = { moduleApiName: 'Deals', fieldApiName: 'Stage' } as const;

describe('one gap count everywhere', () => {
  // Live: the pill said 337 while the live region announced 248. The store's `gaps` is the only
  // number any surface may show, whatever the per-category counters add up to.
  it('shows coverage.gaps on the pill, banner, live region, popover and lens chip', () => {
    const snapshot = withCoverage({ gaps: 337 });
    expect(snapshot.coverage.functions.limited).not.toBe(337);
    map = mountMap({ snapshot, initialState: { view: 'board' } });
    expect(text(map, '.wf-index .wf-pill')).toContain('Mapped · 337 gaps');
    expect(text(map, '.am-banner')).toContain('337 gaps in the map.');
    expect(text(map, '[role="status"].sr-only')).toBe('Map ready with 337 gaps');
    click(map.q('.wf-index .wf-pill'));
    expect(text(map, '.wf-pop .foot .footnote')).toContain('337 gaps');
    map.handle.close();

    map = mountMap({ snapshot, initialState: { view: 'fields', field: stage } });
    expect(text(map, '[data-fk="lens-gap-chip"]')).toContain('337 gaps in the map');
    expect(text(map, '.lens-foot')).toContain('337 gaps in the map');
  });

  it('does not invent gaps when the store reports none', () => {
    map = mountMap({ snapshot: withCoverage({ gaps: 0, isComplete: true }) });
    expect(text(map, '.wf-index .wf-pill')).not.toContain('gap');
    expect(map.q('[data-fk="lens-gap-chip"]')).toBeNull();
  });
});

describe('coverage popover', () => {
  const open = (patch: Partial<MapCoverage> = {}) => {
    map = mountMap({ snapshot: withCoverage({ gaps: 2, ...patch }) });
    click(map.q('.wf-index .wf-pill'));
    return map;
  };

  it('says how old the map is and refreshes on request', () => {
    const m = open({ lastRevalidatedAt: Date.now() - 4 * 60_000 - 5_000 });
    expect(text(m, '.wf-pop .fresh .footnote')).toBe('Updated 4 min ago');
    const refresh = m.q<HTMLButtonElement>('[data-fk="refresh-now"]');
    expect(refresh?.textContent).toContain('Refresh now');
    expect(refresh?.disabled).toBe(false);
    click(refresh);
    expect(m.calls.refreshes).toBe(1);
  });

  it('is honest when nothing has been revalidated, and while a refresh runs', () => {
    expect(text(open({ lastRevalidatedAt: null }), '.wf-pop .fresh .footnote')).toBe(
      'Not refreshed yet',
    );
    map?.handle.close();
    const m = open({ refreshing: true, lastRevalidatedAt: Date.now() });
    expect(text(m, '.wf-pop .fresh .footnote')).toBe('Refreshing…');
    expect(m.q<HTMLButtonElement>('[data-fk="refresh-now"]')?.disabled).toBe(true);
  });

  it('counts unsupported reads next to loaded and failed ones', () => {
    const m = open({
      buttons: { loaded: 65, failed: 4, unsupported: 12, state: 'failed' },
      schedules: { loaded: 2, failed: 0, unsupported: 0, state: 'loaded' },
      blueprints: { loaded: 0, failed: 0, unsupported: 9, state: 'unsupported' },
      approvals: { loaded: 0, failed: 0, unsupported: 1, state: 'unsupported' },
    });
    const rows = m.qa('.wf-pop .cov');
    const row = (label: string) => rows.find((r) => r.textContent?.startsWith(label))?.textContent;
    expect(row('Buttons & schedules')).toContain('67 loaded');
    expect(row('Buttons & schedules')).toContain('4 could not be loaded');
    expect(row('Buttons & schedules')).toContain('12 not supported by Zoho');
    expect(row('Blueprints & approvals')).toContain('none loaded');
    expect(row('Blueprints & approvals')).toContain('10 not supported by Zoho');
    expect(row('Blueprints & approvals')).not.toContain('could not be loaded');
  });

  it('keeps a long failure list from burying the footer', () => {
    const failures = Array.from({ length: 109 }, (_, i) => ({
      id: `dep:${i}`,
      message: 'Zoho configuration could not be read. Retry this dependency.',
      retry: async () => {},
    }));
    const m = open({ failures, gaps: 109 });
    expect(m.qa('.wf-pop .failures li:not(.more)')).toHaveLength(3);
    expect(text(m, '.wf-pop .failures .more')).toContain('106 more could not be read');
    expect(m.q('[data-fk="refresh-now"]')).not.toBeNull();
    expect(m.q('[data-fk="retry-all"]')).not.toBeNull();
  });
});

describe('start-screen most-written fields equal the lens', () => {
  it.each([
    ['active' as const],
    ['everything' as const],
  ])('every chip shows its lens writer count (%s scope)', (scope) => {
    map = mountMap({ initialState: scope === 'everything' ? everything : {} });
    const chips = map.qa('.hotchip');
    expect(chips.length).toBe(6);
    for (const chip of chips) {
      const shown = Number(chip.querySelector('.n')?.textContent);
      click(chip);
      expect(Number(text(map, '.fcard .fstat b'))).toBe(shown);
      expect(text(map, '.lens-sum b')).toBe(String(shown));
      click(map.q('[data-fk="lens-back"]'));
    }
  });

  it('ranks with the same union and scope as the lens for every field', () => {
    const { port } = createFixturePort('full');
    const graph = port.snapshot().graph;
    for (const scope of ['active', 'everything'] as const) {
      const filters = filtersFor(scope);
      const ranked = port.mostWrittenFields(filters, Number.MAX_SAFE_INTEGER);
      expect(ranked.length).toBeGreaterThan(6);
      for (const { field, count } of ranked) {
        const lens = port.fieldLens(field.moduleApiName as string, field.fieldApiName, filters);
        const model = buildLensModel(
          graph,
          lens,
          field.moduleApiName as string,
          field.fieldApiName,
          { scope, teaser: false },
        );
        expect(fieldWriterCount(lens, scope)).toBe(count);
        expect(model.writerCount).toBe(count);
      }
    }
  });

  it('counts the same writers in the picker', () => {
    map = mountMap();
    const input = map.q<HTMLInputElement>('[data-fk="field-picker"]') as HTMLInputElement;
    input.value = 'Deals Stage';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const option = map
      .qa('[role="option"]')
      .find((o) => o.querySelector('b')?.textContent === 'Stage');
    const lens = fieldWriters(fullSnapshot().graph, 'Deals', 'Stage', filtersFor('active'));
    const n = fieldWriterCount(lens, 'active');
    expect(option?.querySelector('.wc')?.textContent).toBe(`${n} writers`);
  });

  it('asks the port for the ranking and lens with the current filters', () => {
    const { port } = createFixturePort('full');
    const ranking = vi.spyOn(port, 'mostWrittenFields');
    const lens = vi.spyOn(port, 'fieldLens');
    map = mountMap({ port, initialState: everything });
    expect(ranking).toHaveBeenCalled();
    expect(ranking.mock.calls[0][0].scope).toBe('everything');
    click(map.qa('.hotchip')[0]);
    expect(lens).toHaveBeenCalled();
    expect(lens.mock.calls.at(-1)?.[2]?.scope).toBe('everything');
  });
});

/** The fixture plus one function that only deletes Deals records (a record change, not a write). */
function withRecordChange() {
  const base = fixtureInputs();
  const source = 'zoho.crm.invokeConnector("crm.delete",{"module":"Deals","id":recordId});';
  const template = base.functions[5] as FunctionInput;
  const extra: FunctionInput = {
    ...template,
    delugeId: 'f-900',
    summary: { ...template.summary, id: 'f-900', api_name: 'purge_deals', display_name: 'Purge' },
    places: [],
    sourceText: source,
    effects: analyzeDelugeEffects(source, {
      functionId: 'f-900',
      parameters: ['recordId'],
      catalogue: [],
    }),
  };
  return { ...base, functions: [...base.functions, extra] };
}

describe('field-lens noise is collapsed', () => {
  const lensEverything = () =>
    mountMap({ initialState: { field: stage, filters: filtersFor('everything') } });

  it('folds unresolved writers into one summary that expands on demand', () => {
    map = lensEverything();
    const group = '.lgrp[data-g="unresolved"]';
    const lens = fieldWriters(fullSnapshot().graph, 'Deals', 'Stage', filtersFor('everything'));
    const n = new Set(lens.unresolvedWriters.map((e) => e.from)).size;
    expect(n).toBeGreaterThan(0);
    expect(text(map, `${group} .lgrp-sum`)).toContain(
      `${n} ${n === 1 ? 'function writes' : 'functions write'} records in a module we couldn't resolve.`,
    );
    expect(text(map, `${group} .lgrp-sum`)).toMatch(/(They|It) may affect this field\./);
    expect(text(map, `${group} .lgrp-h .n`)).toBe(String(n));
    expect(map.qa(`${group} .wcard`)).toHaveLength(0);
    const writers = text(map, '.fcard .fstat b');

    const toggle = map.q<HTMLButtonElement>(`${group} .lgrp-toggle`) as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    click(toggle);
    const opened = map.q<HTMLButtonElement>(`${group} .lgrp-toggle`) as HTMLButtonElement;
    expect(opened.getAttribute('aria-expanded')).toBe('true');
    expect(map.qa(`${group} .wcard`).length).toBeGreaterThanOrEqual(n);
    // Opening it reveals cards; it never changes how many writers the field has.
    expect(text(map, '.fcard .fstat b')).toBe(writers);
    click(opened);
    expect(map.qa(`${group} .wcard`)).toHaveLength(0);
  });

  it('lists other record changes after the writers, collapsed, and never counts them', () => {
    const inputs = withRecordChange();
    const before = portForInputs(fixtureInputs());
    const { port } = portForInputs(inputs);
    const filters = filtersFor('everything');
    const baseline = fieldWriterCount(
      before.port.fieldLens('Deals', 'Stage', filters),
      'everything',
    );
    map = mountMap({
      port,
      snapshot: port.snapshot(),
      initialState: { field: stage, filters },
    });
    const groups = map.qa('.lcol[data-col="w"] .lgrp').map((g) => g.dataset.g);
    expect(groups.at(-1)).toBe('recordChanges');
    expect(groups.indexOf('recordChanges')).toBeGreaterThan(groups.indexOf('declared'));
    const group = '.lgrp[data-g="recordChanges"]';
    expect(text(map, `${group} .lgrp-h`)).toContain('Other record changes');
    expect(text(map, `${group} .lgrp-sum`)).toMatch(
      /delete, relate, attach or tag Deals records\. (They do|It does) not set Stage/,
    );
    expect(map.qa(`${group} .wcard`)).toHaveLength(0);
    expect(Number(text(map, '.fcard .fstat b'))).toBe(baseline);

    click(map.q(`${group} .lgrp-toggle`));
    const cards = map.qa(`${group} .wcard`);
    expect(cards).toHaveLength(1);
    // Listed for context: no connector to the field card, no re-trigger annotation.
    expect(cards[0].classList.contains('nolink')).toBe(true);
    expect(cards[0].textContent).toContain('Changes the record without setting field values');
    expect(cards[0].querySelector('.cascnote')).toBeNull();
    expect(Number(text(map, '.fcard .fstat b'))).toBe(baseline);
  });
});

describe('writes are labelled by what declares them', () => {
  it('reads "Task created (field mapping)" for a task, not "Workflow field update"', () => {
    map = mountMap({
      initialState: { field: { moduleApiName: 'Tasks', fieldApiName: 'Subject' } },
    });
    const notes = map.qa('.lcol[data-col="w"] .cascnote').map((n) => n.textContent);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes).toContain('Task created (field mapping) · re-trigger behaviour unverified');
    expect(notes.join('|')).not.toContain('Workflow field update');
  });

  it('still calls a real field update a workflow field update', () => {
    map = mountMap({ initialState: { field: stage } });
    const notes = map.qa('.lcol[data-col="w"] .cascnote').map((n) => n.textContent);
    expect(notes).toContain('Workflow field update · re-trigger behaviour unverified');
  });

  it('labels the inspector rows of a rule with a task by the edge note', () => {
    const { graph } = fullSnapshot();
    const rule = [...graph.nodes.values()].find(
      (n) =>
        n.kind === 'rule' &&
        n.rule.conditions.some((c) => c.instantActions.some((a) => a.kind === 'task')),
    );
    expect(rule).toBeDefined();
    map = mountMap({
      initialState: { view: 'list', selectedId: rule?.id, inspectorOpen: true },
    });
    const via = map.qa('.am-insp .wrow .via').map((v) => v.textContent);
    expect(via).toContain('Task created (field mapping)');
    expect(via).toContain('via field update');
  });
});

/* ---------- Show on map: the graph arrives after the map opens ---------- */

interface Late {
  shadow: ShadowRoot;
  publish(snapshot: AutomationMapSnapshot): void;
  board(): NonNullable<ReturnType<typeof boardControllerFor>>;
  store(): ViewStore;
  full: AutomationMapSnapshot;
  close(): void;
}

const emptyInputs = {
  modules: [],
  fields: new Map(),
  rules: [],
  functions: [],
  buttons: [],
  schedules: [],
  transitions: [],
  approvals: [],
};

/** The real overlay and canvases over a port whose graph is empty until `publish` is called. */
function mountLate(state: Partial<MapViewState>): Late {
  installDomStubs();
  const { port: base } = createFixturePort('full');
  const full = base.snapshot();
  let snapshot: AutomationMapSnapshot = {
    ...full,
    graph: buildAutomationGraph(emptyInputs),
    phase: 'loading',
  };
  const listeners = new Set<(s: AutomationMapSnapshot) => void>();
  const port: MapDataPort = {
    ...base,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  let store: ViewStore | null = null;
  const grab = (ctx: MapUiContext) => {
    store = ctx.view;
  };
  const handle = mountAutomationMap({
    port,
    views: {
      board: (c, ctx) => {
        grab(ctx);
        return mountBoardView(c, ctx);
      },
      trace: (c, ctx) => {
        grab(ctx);
        return mountTraceView(c, ctx);
      },
      styles: canvasStyles,
    },
    initialState: { view: 'board', ...state },
  });
  const shadow = (document.getElementById(HOST_ID) as HTMLElement).shadowRoot as ShadowRoot;
  return {
    shadow,
    full,
    publish(next) {
      snapshot = next;
      for (const l of [...listeners]) l(next);
    },
    board: () =>
      boardControllerFor(shadow.querySelector('#am-board') as HTMLElement) as NonNullable<
        ReturnType<typeof boardControllerFor>
      >,
    store: () => store as ViewStore,
    close: () => handle.close(),
  };
}

describe('Show on map frames its target once the graph has loaded', () => {
  let late: Late | null = null;
  afterEach(() => {
    late?.close();
    late = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const rule = 'rule:rule-003';
  const target = { view: 'board', selectedId: rule, inspectorOpen: true } as const;
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(400);
  };
  const cardOf = (l: Late) =>
    l.shadow.querySelector<HTMLElement>(`.amc-nd[aria-label^="Workflow rule: Review large"]`);

  it.each([
    ['a selection', target],
    ['a selection and its module', { ...target, focusModuleApiName: 'Deals' }],
  ])('flies to the selected rule at a readable zoom and highlights it (%s)', async (_name, state) => {
    vi.useFakeTimers();
    late = mountLate(state);
    const l = late;
    // Nothing is loaded yet: the rule cannot be shown, and the inspector says so honestly.
    expect(l.shadow.querySelector('.am-insp.open')).not.toBeNull();
    expect(l.shadow.querySelector('.ins-head h2')?.textContent).toBe('Loading…');
    l.publish({ ...l.full, phase: 'enriching' });
    await settle();
    const camera = l.board().camera();
    expect(camera.zoom).toBeGreaterThanOrEqual(0.6);
    const item = l.board().model().byNode.get(rule)?.[0];
    expect(item).toBeDefined();
    const island = l
      .board()
      .model()
      .islands.find((i) => i.id === item?.islandId);
    // The rule sits inside the part of the world that is on screen.
    const cx = (island?.x ?? 0) + (item?.x ?? 0) + (item?.w ?? 0) / 2;
    const cy = (island?.y ?? 0) + (item?.y ?? 0) + (item?.h ?? 0) / 2;
    expect((cx - camera.x) * camera.zoom).toBeGreaterThan(0);
    expect((cx - camera.x) * camera.zoom).toBeLessThan(1280);
    expect((cy - camera.y) * camera.zoom).toBeGreaterThan(0);
    expect((cy - camera.y) * camera.zoom).toBeLessThan(800);
    const card = cardOf(l);
    expect(card?.classList.contains('amc-sel')).toBe(true);
    expect(l.shadow.querySelector('.ins-head h2')?.textContent).toContain('Review large');
    expect(l.shadow.querySelector('.am-insp.open')).not.toBeNull();
  });

  it('widens the scope for an inactive rule, which the active board does not show', async () => {
    vi.useFakeTimers();
    // rule-008 is inactive: the default (active) scope leaves it off the board entirely.
    late = mountLate({ view: 'board', selectedId: 'rule:rule-008', inspectorOpen: true });
    const l = late;
    l.publish({ ...l.full, phase: 'enriching' });
    await settle();
    expect(l.store().get().filters.scope).toBe('everything');
    expect(l.board().camera().zoom).toBeGreaterThanOrEqual(0.6);
    expect(l.board().model().byNode.has('rule:rule-008')).toBe(true);
    const card = l.shadow.querySelector<HTMLElement>('.amc-nd.amc-sel');
    expect(card?.getAttribute('aria-label')).toContain('Workflow rule');
    expect(card?.classList.contains('amc-inactive')).toBe(true);
    expect(l.shadow.querySelector('.am-insp.open')).not.toBeNull();
    expect(l.shadow.querySelector('[role="status"].sr-only')?.textContent).toContain('not active');
  });

  it('keeps the active scope for an active rule', async () => {
    vi.useFakeTimers();
    late = mountLate(target);
    const l = late;
    l.publish({ ...l.full, phase: 'complete' });
    await settle();
    expect(l.store().get().filters.scope).toBe('active');
  });

  it('does not stay at overview with nothing highlighted (the live defect)', async () => {
    vi.useFakeTimers();
    late = mountLate(target);
    const l = late;
    const overview = l.board().camera().zoom;
    l.publish({ ...l.full, phase: 'complete' });
    await settle();
    expect(l.board().camera().zoom).toBeGreaterThan(overview);
    expect(l.board().tier()).not.toBe('overview');
  });

  it('frames an island that is not loaded yet when no node is selected', async () => {
    vi.useFakeTimers();
    late = mountLate({ view: 'board', focusModuleApiName: 'Deals' });
    const l = late;
    l.publish({ ...l.full, phase: 'complete' });
    await settle();
    const deals = l
      .board()
      .model()
      .islands.find((i) => i.id === 'Deals');
    expect(deals).toBeDefined();
    const camera = l.board().camera();
    // Camera x/y is the world point at the top-left of the view.
    const left = ((deals?.x ?? 0) - camera.x) * camera.zoom;
    const right = left + (deals?.w ?? 0) * camera.zoom;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(1280);
    expect(l.board().tier()).not.toBe('overview');
  });

  it('leaves a camera that came from the link alone', async () => {
    vi.useFakeTimers();
    history.replaceState(
      null,
      '',
      `${location.pathname}#zcdt-map=v1;view=board;sel=${rule};z=0.2;c=900,500`,
    );
    late = mountLate({});
    const l = late;
    const before = l.board().camera();
    expect(before.zoom).toBeCloseTo(0.2, 2);
    l.publish({ ...l.full, phase: 'complete' });
    await settle();
    expect(l.board().camera()).toEqual(before);
  });

  it('gives up when the user has already moved the camera', async () => {
    vi.useFakeTimers();
    late = mountLate(target);
    const l = late;
    l.store().set({ camera: { x: -40, y: -40, zoom: 0.3 } });
    l.publish({ ...l.full, phase: 'complete' });
    await settle();
    expect(l.board().camera().zoom).toBeCloseTo(0.3, 2);
  });

  it('drops the target when another node is selected first', async () => {
    vi.useFakeTimers();
    late = mountLate(target);
    const l = late;
    l.store().set({ selectedId: null, inspectorOpen: false });
    l.publish({ ...l.full, phase: 'complete' });
    await settle();
    // Nothing selected: the automatic fit of the whole map is all that applies.
    expect(l.board().tier()).toBe('overview');
  });
});

/* ---------- the inspector follows the selection and closes with it ---------- */

describe('inspector follows the selection', () => {
  const open = () => map?.q('.am-insp.open') ?? null;
  const heading = () => text(map as MountedMap, '.ins-head h2');
  const withoutNode = (snapshot: AutomationMapSnapshot, id: string): AutomationMapSnapshot => ({
    ...snapshot,
    graph: {
      ...snapshot.graph,
      nodes: new Map([...snapshot.graph.nodes].filter(([key]) => key !== id)),
    },
  });
  const modulesOnly = (...mods: string[]): MapFilters => ({
    ...filtersFor('active'),
    modules: new Set(mods),
  });

  it('closes when a module filter hides the selected node', () => {
    map = mountWithStore({ view: 'board', selectedId: 'rule:rule-003', inspectorOpen: true });
    const store = map.recorded.store();
    expect(open()).not.toBeNull();
    // rule-003 belongs to Deals; filtering to Accounts leaves it off the map.
    store.set({ filters: modulesOnly('Accounts') });
    expect(open()).toBeNull();
    expect(store.get()).toMatchObject({ selectedId: null, inspectorOpen: false });
    expect(text(map, '[role="status"].sr-only')).toContain('no longer shown');
  });

  it('keeps it open while the node stays visible', () => {
    map = mountWithStore({ view: 'board', selectedId: 'rule:rule-003', inspectorOpen: true });
    map.recorded.store().set({ filters: modulesOnly('Deals') });
    expect(open()).not.toBeNull();
    expect(heading()).toContain('Review large opportunities');
  });

  it('closes when switching back to the active scope hides an inactive rule', () => {
    map = mountWithStore({
      view: 'board',
      selectedId: 'rule:rule-008',
      inspectorOpen: true,
      filters: filtersFor('everything'),
    });
    expect(open()).not.toBeNull();
    click(map.q('[data-fk="scope:active"]'));
    expect(open()).toBeNull();
    expect(map.recorded.store().get().selectedId).toBeNull();
  });

  it('closes when a search leaves the selected row out of the list, not on the board', () => {
    map = mountWithStore({ view: 'list', selectedId: 'rule:rule-003', inspectorOpen: true });
    const store = map.recorded.store();
    store.set({ query: 'Review large' });
    expect(open()).not.toBeNull();
    store.set({ query: 'Qualify new enquiries' });
    expect(open()).toBeNull();
    map.handle.close();

    map = mountWithStore({ view: 'board', selectedId: 'rule:rule-003', inspectorOpen: true });
    map.recorded.store().set({ query: 'Qualify new enquiries' });
    // The board only dims what does not match: the node is still there.
    expect(open()).not.toBeNull();
  });

  it('closes when a refresh removes the node, but not while still loading', () => {
    vi.useFakeTimers();
    map = mountWithStore({ view: 'list', selectedId: 'rule:rule-003', inspectorOpen: true });
    const snapshot = map.port.snapshot();
    map.publish({ ...withoutNode(snapshot, 'rule:rule-003'), phase: 'enriching' });
    vi.advanceTimersByTime(300);
    expect(open()).not.toBeNull();
    expect(heading()).toBe('Loading…');
    map.publish(snapshot);
    vi.advanceTimersByTime(300);
    expect(heading()).toContain('Review large opportunities');
    map.publish({ ...withoutNode(snapshot, 'rule:rule-003'), phase: 'complete' });
    vi.advanceTimersByTime(300);
    expect(open()).toBeNull();
    expect(map.recorded.store().get().selectedId).toBeNull();
  });

  it('still says "Not in the map" for a link to a node that never existed', () => {
    map = mountMap({
      initialState: { view: 'list', selectedId: 'rule:never-was', inspectorOpen: true },
    });
    expect(heading()).toBe('Not in the map');
  });

  it('follows a search that selects another result with Enter', () => {
    map = mountWithStore({ view: 'list', selectedId: 'rule:rule-003', inspectorOpen: true });
    expect(heading()).toContain('Review large opportunities');
    const input = map.q<HTMLInputElement>('.am-search input') as HTMLInputElement;
    input.focus();
    input.value = 'Qualify new enquiries';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    map.recorded.store().set({ query: 'Qualify new enquiries' });
    key(input, 'Enter');
    expect(open()).not.toBeNull();
    expect(heading()).toContain('Qualify new enquiries');
    expect(heading()).not.toContain('Review large');
  });

  it('closes the previous selection when a search result opens another field lens', () => {
    map = mountWithStore({ view: 'board', selectedId: 'rule:rule-003', inspectorOpen: true });
    const store = map.recorded.store();
    const input = map.q<HTMLInputElement>('.am-search input') as HTMLInputElement;
    input.focus();
    input.value = 'field:Deals.Stage';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    store.set({ query: 'field:Deals.Stage' });
    key(input, 'Enter');
    expect(store.get().view).toBe('fields');
    expect(store.get().field).toEqual(stage);
    expect(open()).toBeNull();
    expect(store.get().selectedId).toBeNull();
  });

  it('closes the writer details when a reactor chip pivots to another field', () => {
    map = mountMap({ initialState: { field: stage } });
    click(map.qa('.lcol[data-col="w"] .wcard')[0]);
    expect(open()).not.toBeNull();
    const chip = map.qa('.rcard .eff').find((c) => c.tagName === 'BUTTON');
    expect(chip).toBeDefined();
    click(chip);
    expect(map.q('.lens-start')).toBeNull();
    expect(open()).toBeNull();
  });

  it('keeps the details when the lens opens for the field that is selected', () => {
    map = mountMap({
      initialState: { view: 'board', selectedId: 'field:Deals.Stage', inspectorOpen: true },
    });
    map.recorded.store().set({ view: 'board' });
    click(map.q('.ins-foot [data-fk]') ?? map.qa('.ins-foot button')[0]);
    expect(open()).not.toBeNull();
  });
});

/* ---------- long trigger labels stay readable ---------- */

describe('entry cards keep long trigger text reachable', () => {
  const fields = ['Closing_Date', 'Expected_Revenue_Total', 'Contract_Renewal_Window', 'Stage'];
  const label = `Field changed: ${[...fields].sort().join(', ')}`;
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('gives the event card the full text as a tooltip and as its accessible name', () => {
    installDomStubs();
    const inputs = fixtureInputs();
    const watching = inputs.rules.map((rule) =>
      rule.id === 'rule-003' && rule.trigger?.type === 'field_update'
        ? {
            ...rule,
            trigger: {
              ...rule.trigger,
              criteria: {
                kind: 'group' as const,
                operator: 'OR' as const,
                raw: null,
                children: fields.map((apiName) => ({
                  kind: 'predicate' as const,
                  field: { apiName, label: apiName },
                  comparator: 'is_modified',
                  value: null,
                  raw: null,
                })),
              },
            },
          }
        : rule,
    );
    const { port } = portForInputs({ ...inputs, rules: watching });
    const handle = mountAutomationMap({
      port,
      views: {
        board: mountBoardView,
        trace: mountTraceView,
        styles: canvasStyles,
      },
      initialState: { view: 'board', focusModuleApiName: 'Deals' },
    });
    close = () => handle.close();
    const shadow = (document.getElementById(HOST_ID) as HTMLElement).shadowRoot as ShadowRoot;
    const board = boardControllerFor(shadow.querySelector('#am-board') as HTMLElement);
    const island = board?.model().islands.find((i) => i.id === 'Deals');
    expect(island).toBeDefined();
    board?.setCamera({ x: (island?.x ?? 0) - 20, y: (island?.y ?? 0) - 20, zoom: 1 });
    board?.flush();
    const event = [...shadow.querySelectorAll<HTMLElement>('.amc-k-event')].find((card) =>
      card.getAttribute('aria-label')?.includes('Closing_Date'),
    );
    expect(event).toBeDefined();
    expect(event?.querySelector('.amc-t1')?.getAttribute('title')).toBe(label);
    expect(event?.getAttribute('aria-label')).toContain(label);
  });
});

describe('field lens counts distinct writer entities', () => {
  // Live (Task.Subject): the header said 38 and the group labels summed to 39, while the cards
  // came from 34 distinct rules and functions. A rule with two writing actions is one writer, and
  // a function that writes through several tiers counts only in the strongest one.
  const dupes = portForInputs(lensDupesInputs());
  const lensOf = (scope: MapFilters['scope']) =>
    buildLensModel(
      dupes.graph,
      dupes.port.fieldLens('Deals', 'Stage', filtersFor(scope)),
      'Deals',
      'Stage',
      { scope, teaser: false },
    );
  const entityOf = (entry: { source: { kind: string; ownerId?: string; id: string } }) =>
    entry.source.kind === 'action' ? (entry.source.ownerId as string) : entry.source.id;

  for (const scope of ['active', 'everything'] as const) {
    it(`makes the group labels add up to the header in ${scope} scope`, () => {
      const lens = lensOf(scope);
      const writerGroups = lens.groups.filter((g) => g.key !== 'recordChanges');
      expect(lens.writerCount).toBeGreaterThan(0);
      expect(writerGroups.reduce((n, g) => n + g.sources, 0)).toBe(lens.writerCount);
    });
  }

  it('counts a rule that writes twice once, and shows both writes', () => {
    const declared = lensOf('everything').groups.find((g) => g.key === 'declared');
    const rules = new Set(declared?.items.map(entityOf));
    expect(declared?.items.length).toBeGreaterThan(rules.size);
    expect(declared?.sources).toBe(rules.size);
  });

  it('lists an entity once, in its strongest group', () => {
    const lens = lensOf('everything');
    const seen = new Map<string, string>();
    for (const group of lens.groups)
      for (const item of group.items)
        if (group.key !== 'recordChanges' && !group.collapsible) {
          const entity = entityOf(item);
          // Several cards of one entity stay in its one group; never in a second group.
          expect(seen.get(entity) ?? group.key, `${entity} in two groups`).toBe(group.key);
          seen.set(entity, group.key);
        }
    // Stage gate 2 writes Stage exactly and other Deals fields unknown: exact wins.
    expect(seen.get('function:f-201')).toBe('exact');
    // Stage gate 3 also writes an unresolved module: still exact.
    expect(seen.get('function:f-202')).toBe('exact');
  });

  it('prints the same numbers in the DOM: header, field card and group labels', () => {
    map = mountMap({
      port: dupes.port,
      initialState: {
        view: 'fields',
        field: stage,
        filters: filtersFor('everything'),
      },
    });
    const header = Number(map.q('.lens-sum b')?.textContent);
    const labels = map
      .qa('.lcol[data-col="w"] .lgrp:not([data-g="recordChanges"]) .lgrp-h .n')
      .map((n) => Number(n.textContent));
    expect(header).toBeGreaterThan(0);
    expect(labels.reduce((a, b) => a + b, 0)).toBe(header);
    expect(map.q('.fstat b')?.textContent).toBe(String(header));
    // The two-writes hint only appears where cards outnumber writers.
    expect(map.q('.lgrp[data-g="declared"] [data-fk="sites"]')?.textContent).toMatch(
      /^\d+ writes · one card each$/,
    );
  });
});

describe('live region reads the settled gap count only', () => {
  // Live: a reopen painted the cached map (248 gaps), the ready announcement fired at once, and the
  // refresh then climbed to 271. The chip was right; the screen reader had been told 248.
  const settledAt = (gaps: number, patch: Partial<MapCoverage> = {}) =>
    withCoverage({ gaps, refreshing: false, gapsProvisional: false, ...patch });
  const during = (gaps: number, patch: Partial<MapCoverage> = {}): AutomationMapSnapshot => ({
    ...withCoverage({ gaps, refreshing: true, ...patch }),
    phase: 'enriching',
  });

  it('skips the cached count and every progressive tick, then announces the settled one once', () => {
    vi.useFakeTimers();
    map = mountMap({ snapshot: during(248), initialState: { view: 'board' } });
    const live = map.q('[role="status"].sr-only') as HTMLElement;
    // The cached count is on the chip but must not be spoken.
    expect(text(map, '.wf-index .wf-pill')).toContain('248 gaps');
    expect(live.textContent).toBe('');
    const watcher = new MutationObserver(() => {});
    watcher.observe(live, { childList: true, characterData: true, subtree: true });
    const writes: string[] = [];
    const log = () => {
      if (watcher.takeRecords().length) writes.push(live.textContent ?? '');
    };
    const publish = (snapshot: AutomationMapSnapshot) => {
      map?.publish(snapshot);
      vi.advanceTimersByTime(200);
      log();
    };
    log();
    expect(writes).toEqual([]);
    for (const gaps of [249, 254, 260, 267, 270]) publish(during(gaps));
    // The pass finishes but dependency discovery can still add gaps: provisional is not ready.
    publish({ ...settledAt(270, { gapsProvisional: true }), phase: 'complete' });
    expect(writes).toEqual([]);
    publish({ ...settledAt(271), phase: 'complete' });
    expect(writes).toEqual(['Map ready with 271 gaps']);
    expect(text(map, '.wf-index .wf-pill')).toContain('271 gaps');

    // Neither a view switch nor the same snapshot again says it twice.
    map.recorded.store().set({ view: 'list' });
    vi.advanceTimersByTime(200);
    publish({ ...settledAt(271), phase: 'complete' });
    log();
    expect(writes).toEqual(['Map ready with 271 gaps']);

    // A later refresh stays quiet while it runs and speaks once when it settles on a new count.
    publish(during(271));
    publish(during(268));
    expect(writes).toHaveLength(1);
    publish({ ...settledAt(268), phase: 'complete' });
    expect(writes).toEqual(['Map ready with 271 gaps', 'Map updated, 268 gaps']);
    watcher.disconnect();
  });

  it('does not repeat itself when a refresh settles on the same count', () => {
    vi.useFakeTimers();
    map = mountMap({ snapshot: settledAt(7), initialState: { view: 'board' } });
    const live = map.q('[role="status"].sr-only') as HTMLElement;
    expect(live.textContent).toBe('Map ready with 7 gaps');
    const watcher = new MutationObserver(() => {});
    watcher.observe(live, { childList: true, characterData: true, subtree: true });
    map.publish(during(7));
    vi.advanceTimersByTime(200);
    map.publish({ ...settledAt(7), phase: 'complete' });
    vi.advanceTimersByTime(200);
    expect(watcher.takeRecords()).toHaveLength(0);
    watcher.disconnect();
  });
});

describe('module totals', () => {
  // Live: the full map said 183 modules in the footer while the inventory held fewer; islands
  // built only from source or action targets are not part of the org's module list.
  it('shows the store inventory in the footer and on the Fields start screen', () => {
    const snapshot = withCoverage({ modules: 41 });
    expect(snapshot.graph.modules.length).not.toBe(41);
    map = mountMap({ snapshot });
    expect(text(map, '.am-foot .footstatus')).toContain('41 modules');
    expect(text(map, '.lens-start .estate')).toContain('41 modules');
  });

  it('falls back to the graph when the store reports no inventory', () => {
    map = mountMap({ snapshot: fullSnapshot() });
    const n = fullSnapshot().graph.modules.length;
    expect(text(map, '.am-foot .footstatus')).toContain(`${n} modules`);
  });
});
