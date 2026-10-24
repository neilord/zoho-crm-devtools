import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAutomationGraph } from '../src/content/automation-map/graph';
import { boardControllerFor, mountBoardView } from '../src/content/automation-map/ui/canvas';
import { createBoard, MAX_CARDS } from '../src/content/automation-map/ui/canvas/board';
import { nextTier, TITLE_ZONE_H } from '../src/content/automation-map/ui/canvas/geometry';
import { countsText } from '../src/content/automation-map/ui/canvas/islands-dom';
import { layoutModel } from '../src/content/automation-map/ui/canvas/layout';
import { buildBoardModel } from '../src/content/automation-map/ui/canvas/model';
import {
  computeVisibility,
  scopeOnlyFilters,
} from '../src/content/automation-map/ui/canvas/visibility';
import {
  attach,
  defaultFilters,
  fire,
  fixturePort,
  installDomStubs,
  makeContext,
  portFor,
  press,
} from './automation-map-canvas-fixtures';
import { fixtureInputs, generateLargeInputs } from './fixtures/automation-map';

const fixtureGraph = () => buildAutomationGraph(fixtureInputs());
const largeGraph = () => buildAutomationGraph(generateLargeInputs({ rules: 330, functions: 920 }));

function modelFor(graph = fixtureGraph(), scope: 'active' | 'everything' = 'active') {
  const filters = { ...defaultFilters(), scope };
  const model = buildBoardModel(graph, computeVisibility(graph, filters), {
    includeLoose: scope === 'everything',
  });
  const anchors = layoutModel(model);
  return { model, anchors, graph };
}

const snapshotOf = (model: ReturnType<typeof modelFor>['model']) =>
  JSON.stringify(
    model.islands.map((I) => ({
      id: I.id,
      x: I.x,
      y: I.y,
      w: I.w,
      h: I.h,
      items: I.items.map((i) => [i.iid, i.x, i.y, i.w, i.h, i.col]),
    })),
  );

beforeEach(() => {
  installDomStubs();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.textContent = '';
});

describe('board layout', () => {
  it('is deterministic for the same graph and filters', () => {
    expect(snapshotOf(modelFor().model)).toBe(snapshotOf(modelFor().model));
    expect(snapshotOf(modelFor(largeGraph(), 'everything').model)).toBe(
      snapshotOf(modelFor(largeGraph(), 'everything').model),
    );
  });

  for (const [name, graph, scope] of [
    ['fixture, active', fixtureGraph(), 'active'],
    ['fixture, everything', fixtureGraph(), 'everything'],
    ['large org, active', largeGraph(), 'active'],
    ['large org, everything', largeGraph(), 'everything'],
  ] as const) {
    it(`never overlaps islands or their overview titles (${name})`, () => {
      const { model } = modelFor(graph, scope);
      // Each island owns its rect plus the title zone the overview frame title occupies.
      const outer = model.islands.map((I) => ({
        id: I.id,
        x: I.x,
        y: I.y - TITLE_ZONE_H,
        w: I.w,
        h: I.h + TITLE_ZONE_H,
      }));
      for (let a = 0; a < outer.length; a++)
        for (let b = a + 1; b < outer.length; b++) {
          const A = outer[a];
          const B = outer[b];
          const overlap = A.x < B.x + B.w && A.x + A.w > B.x && A.y < B.y + B.h && A.y + A.h > B.y;
          expect(overlap, `${A.id} vs ${B.id}`).toBe(false);
        }
    });
  }

  it('keeps lane columns apart so lane labels cannot collide or clip', () => {
    const { model } = modelFor(largeGraph(), 'everything');
    for (const I of model.islands) {
      let end = -1;
      for (const lane of I.present) {
        const x = I.laneX[lane] ?? 0;
        expect(x).toBeGreaterThan(end);
        // The label is no wider than its lane (10px caps, longest label "Resources").
        end = x + (I.laneCols[lane] ?? 1) * 216 - 100;
      }
      for (const item of I.items) {
        expect(item.x + item.w).toBeLessThanOrEqual(I.w);
        expect(item.y + item.h).toBeLessThanOrEqual(I.h);
      }
    }
  });

  it('keeps the title shorter than the vertical gap between islands', () => {
    // Overview titles render at min(15/z, 120) world px with an 8/z (max 40) margin.
    const titleHeight = 120 * 1.1 + 40;
    expect(titleHeight).toBeLessThanOrEqual(TITLE_ZONE_H);
  });

  it('does not move islands when filters remove nodes', () => {
    const graph = fixtureGraph();
    const base = modelFor(graph).anchors;
    const board = (filters: Parameters<typeof computeVisibility>[1]) => {
      const model = buildBoardModel(graph, computeVisibility(graph, filters), {
        includeLoose: false,
      });
      layoutModel(model, base);
      return model;
    };
    const kinds = board({ ...defaultFilters(), kinds: new Set(['rule', 'function'] as const) });
    const unfiltered = board(defaultFilters());
    for (const I of kinds.islands) {
      const full = unfiltered.islands.find((x) => x.id === I.id);
      expect(full).toBeDefined();
      expect(I.x).toBe(full?.x);
      expect(I.y).toBe(full?.y);
      expect(I.items.length).toBeLessThanOrEqual(full?.items.length ?? 0);
    }
    const onlyDeals = board({ ...defaultFilters(), modules: new Set(['Deals']) });
    expect(onlyDeals.islands.map((I) => I.id)).toContain('Deals');
    expect(onlyDeals.islands.find((I) => I.id === 'Deals')?.x).toBe(
      unfiltered.islands.find((I) => I.id === 'Deals')?.x,
    );
    // Shared functions keep their island instances under a module filter.
    expect(
      onlyDeals.islands.find((I) => I.id === 'Deals')?.items.some((i) => i.kind === 'function'),
    ).toBe(true);
  });

  it('derives record events and REST API entry stubs', () => {
    const { model } = modelFor();
    const deals = model.islands.find((I) => I.id === 'Deals');
    expect(deals?.items.filter((i) => i.kind === 'event').length).toBeGreaterThan(0);
    const org = model.islands.find((I) => I.org);
    expect(org?.items.some((i) => i.kind === 'api')).toBe(true);
    expect(org?.items.some((i) => i.kind === 'schedule')).toBe(true);
  });
});

describe('hubs and portals', () => {
  it('collapses hub callers into a "Called by N" badge with port dots, hiding their edges', () => {
    const { model, graph } = modelFor();
    const hubs = [...model.byIid.values()].filter((i) => i.hub);
    expect(hubs.length).toBeGreaterThan(0);
    for (const hub of hubs) {
      expect(hub.hub?.callers).toBeGreaterThanOrEqual(model.hubThreshold);
      const I = model.islands.find((x) => x.id === hub.islandId);
      const incoming = I?.edges.filter((e) => e.to === hub.iid && e.kind !== 'trigger') ?? [];
      expect(incoming.every((e) => e.hub)).toBe(true);
      for (const e of incoming) expect(I?.byIid.get(e.from)?.port).toBe(true);
    }
    const hubNode = hubs[0].node;
    expect(hubNode?.kind === 'function' && hubNode.inDegree).toBe(hubs[0].hub?.callers);
    expect(graph.nodes.has(hubNode?.id ?? '')).toBe(true);
  });

  it('draws hub edges only while the hub is hovered', () => {
    const port = fixturePort();
    const { ctx } = makeContext(port, { focusModuleApiName: 'Deals' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const hub = [...board.model().byIid.values()].find((i) => i.hub && i.islandId === 'Deals');
    expect(hub).toBeDefined();
    const card = container.querySelector(`[data-iid="${hub?.iid}"]`) as HTMLElement;
    expect(card.textContent).toContain(`Called by ${hub?.hub?.callers}`);
    const resting = container.querySelectorAll('.amc-e-local .amc-e').length;
    expect(resting).toBeGreaterThan(0);
    const litBefore = container.querySelectorAll('.amc-e-lit').length;
    fire(card, 'pointerover');
    const litAfter = container.querySelectorAll('.amc-e-lit').length;
    expect(litAfter).toBeGreaterThan(litBefore);
    fire(card, 'pointerout');
    expect(container.querySelectorAll('.amc-e-lit').length).toBe(litBefore);
    board.dispose();
  });

  it('gives every portal a partner stub in the target island', () => {
    const { model } = modelFor();
    const outs = [...model.byIid.values()].filter((i) => i.portal?.dir === 'out');
    expect(outs.length).toBeGreaterThan(5);
    for (const stub of outs) {
      const p = stub.portal;
      expect(p?.partnerIid).toBeTruthy();
      const partner = model.byIid.get(p?.partnerIid ?? '');
      expect(partner?.portal?.dir).toBe('in');
      expect(partner?.islandId).toBe(p?.otherIslandId);
      expect(partner?.portal?.otherIslandId).toBe(stub.islandId);
    }
    // Write-only modules (Tasks) still get an island so their portals have a target.
    expect(model.islands.some((I) => I.id === 'Tasks')).toBe(true);
  });

  it('flies to the partner when a portal is clicked', () => {
    const { ctx, store } = makeContext(fixturePort(), { focusModuleApiName: 'Deals' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const stub = [...board.model().byIid.values()].find(
      (i) => i.islandId === 'Deals' && i.portal?.dir === 'out' && i.portal.partnerIid,
    );
    expect(stub).toBeDefined();
    const partnerIsland = board.model().islands.find((I) => I.id === stub?.portal?.otherIslandId);
    fire(container.querySelector(`[data-iid="${stub?.iid}"]`) as Element, 'click');
    board.flush();
    const cam = board.camera();
    // The inspector (opened for a one-field portal) covers the right 400px: fly-to centres in the rest.
    const free = 1280 - (store.get().inspectorOpen ? 400 : 0);
    const view = { x: cam.x, y: cam.y, w: free / cam.zoom, h: 800 / cam.zoom };
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    expect(partnerIsland).toBeDefined();
    if (!partnerIsland) return;
    expect(cx).toBeGreaterThan(partnerIsland.x);
    expect(cx).toBeLessThan(partnerIsland.x + partnerIsland.w);
    expect(cy).toBeGreaterThan(partnerIsland.y);
    expect(cy).toBeLessThan(partnerIsland.y + partnerIsland.h);
    if (stub?.portal?.fieldIds.length === 1)
      expect(store.get().selectedId).toBe(stub.portal.fieldIds[0]);
    board.dispose();
  });

  it('builds module flows from portal writes', () => {
    const { model } = modelFor();
    expect(model.flows.length).toBeGreaterThan(5);
    for (const f of model.flows) {
      expect(f.count).toBeGreaterThan(0);
      expect(model.islands.some((I) => I.id === f.from)).toBe(true);
      expect(model.islands.some((I) => I.id === f.to)).toBe(true);
    }
  });
});

describe('semantic zoom and culling', () => {
  it('uses the spec thresholds with hysteresis', () => {
    expect(nextTier(0.3, null)).toBe('overview');
    expect(nextTier(0.5, null)).toBe('compact');
    expect(nextTier(0.9, null)).toBe('detail');
    expect(nextTier(0.43, 'overview')).toBe('overview');
    expect(nextTier(0.46, 'overview')).toBe('compact');
    expect(nextTier(0.41, 'compact')).toBe('compact');
    expect(nextTier(0.38, 'compact')).toBe('overview');
    expect(nextTier(0.79, 'detail')).toBe('detail');
    expect(nextTier(0.76, 'detail')).toBe('compact');
    expect(nextTier(0.81, 'compact')).toBe('compact');
    expect(nextTier(0.84, 'compact')).toBe('detail');
  });

  it('renders no node cards at overview and bounds the DOM when zoomed in (large org)', () => {
    const graph = largeGraph();
    const { ctx } = makeContext(portFor(graph));
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    expect(board.tier()).toBe('overview');
    const overview = board.stats();
    expect(overview.cards).toBe(0);
    expect(overview.items).toBeGreaterThan(1000);
    // Overview shells use one canvas per island, never one element per node.
    expect(overview.elements).toBeLessThan(1500);

    board.flyToIsland('Deals', false);
    board.flush();
    // A tall island is framed at readable (compact) zoom, from its top.
    expect(board.tier()).toBe('compact');
    const deals = board.model().islands.find((I) => I.id === 'Deals');
    board.setCamera({ x: (deals?.x ?? 0) - 40, y: (deals?.y ?? 0) - 40, zoom: 1 });
    board.flush();
    const close = board.stats();
    expect(board.tier()).toBe('detail');
    expect(close.cards).toBeGreaterThan(20);
    expect(close.cards).toBeLessThan(overview.items / 2);
    expect(close.cards).toBeLessThanOrEqual(MAX_CARDS);
    expect(close.mountedIslands).toBeLessThan(close.islands);
    expect(close.elements).toBeLessThan(2500);
    board.dispose();
  });

  it('keeps the focused island the only one with resting edges', () => {
    const { ctx } = makeContext(fixturePort(), { focusModuleApiName: 'Deals' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    expect(board.tier()).toBe('detail');
    const paths = [...container.querySelectorAll('.amc-e-local .amc-e')];
    expect(paths.length).toBeGreaterThan(0);
    const deals = board.model().islands.find((I) => I.id === 'Deals');
    expect(deals).toBeDefined();
    // Resting edges of other islands are not in the DOM (spec: drawn within the focused island).
    expect(board.stats().edges).toBeLessThanOrEqual(deals?.edges.length ?? 0);
    board.dispose();
  });

  it('removes cards and shells that scroll out of the viewport', () => {
    const { ctx } = makeContext(fixturePort(), { focusModuleApiName: 'Deals' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const before = new Set(
      [...container.querySelectorAll('[data-iid]')].map((e) => e.getAttribute('data-iid')),
    );
    board.flyToIsland('Leads', false);
    board.flush();
    const after = new Set(
      [...container.querySelectorAll('[data-iid]')].map((e) => e.getAttribute('data-iid')),
    );
    expect([...after].some((iid) => iid?.startsWith('Leads|'))).toBe(true);
    expect([...before].some((iid) => !after.has(iid))).toBe(true);
    board.dispose();
  });
});

describe('selection, search and keyboard', () => {
  it('selects on click, traces on double-click and clears on empty canvas', () => {
    const { ctx, store } = makeContext(fixturePort(), { focusModuleApiName: 'Deals' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const rule = [...board.model().byIid.values()].find(
      (i) => i.kind === 'rule' && i.islandId === 'Deals',
    );
    const card = container.querySelector(`[data-iid="${rule?.iid}"]`) as HTMLElement;
    fire(card, 'click');
    expect(store.get().selectedId).toBe(rule?.node?.id);
    expect(card.classList.contains('amc-sel')).toBe(true);
    expect(container.querySelector('.amc-world')?.classList.contains('amc-focusing')).toBe(true);
    fire(card, 'dblclick');
    expect(store.get().traceRootId).toBe(rule?.node?.id);
    expect(store.get().view).toBe('trace');
    fire(container.querySelector('.amc-canvas') as Element, 'click');
    expect(store.get().selectedId).toBeNull();
    board.dispose();
  });

  it('opens the inspector on click and Enter, and closes it on an empty-canvas click', () => {
    const { ctx, store } = makeContext(fixturePort(), { focusModuleApiName: 'Deals' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const rule = [...board.model().byIid.values()].find(
      (i) => i.kind === 'rule' && i.islandId === 'Deals',
    );
    const card = container.querySelector(`[data-iid="${rule?.iid}"]`) as HTMLElement;
    expect(store.get().inspectorOpen).toBe(false);
    fire(card, 'click');
    expect(store.get()).toMatchObject({ selectedId: rule?.node?.id, inspectorOpen: true });
    fire(container.querySelector('.amc-canvas') as Element, 'click');
    expect(store.get()).toMatchObject({ selectedId: null, inspectorOpen: false });
    // Enter on the keyboard cursor does the same.
    card.focus();
    press(container.querySelector('.amc-root') as Element, 'Enter');
    expect(store.get()).toMatchObject({ selectedId: rule?.node?.id, inspectorOpen: true });
    board.dispose();
  });

  it('opens the inspector for a portal that lands on one field', () => {
    const { ctx, store } = makeContext(fixturePort(), { focusModuleApiName: 'Deals' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const stub = [...board.model().byIid.values()].find(
      (i) => i.islandId === 'Deals' && i.portal?.dir === 'out' && i.portal.fieldIds.length === 1,
    );
    expect(stub).toBeDefined();
    fire(container.querySelector(`[data-iid="${stub?.iid}"]`) as Element, 'click');
    expect(store.get()).toMatchObject({
      selectedId: stub?.portal?.fieldIds[0],
      inspectorOpen: true,
    });
    board.dispose();
  });

  it('moves selection with arrow keys without popping the inspector open', () => {
    const { ctx, store } = makeContext(fixturePort(), { focusModuleApiName: 'Deals' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const rule = [...board.model().byIid.values()].find(
      (i) => i.kind === 'rule' && i.islandId === 'Deals',
    );
    fire(container.querySelector(`[data-iid="${rule?.iid}"]`) as Element, 'click');
    store.set({ inspectorOpen: false });
    press(container.querySelector('.amc-root') as Element, 'ArrowRight');
    expect(store.get().selectedId).not.toBe(rule?.node?.id);
    expect(store.get().selectedId).not.toBeNull();
    expect(store.get().inspectorOpen).toBe(false);
    // With the inspector open, it follows the keyboard.
    store.set({ inspectorOpen: true });
    const before = store.get().selectedId;
    press(container.querySelector('.amc-root') as Element, 'ArrowLeft');
    expect(store.get().selectedId).not.toBe(before);
    expect(store.get().inspectorOpen).toBe(true);
    board.dispose();
  });

  it('dims non-matches on search and badges islands', () => {
    const port = fixturePort();
    const { ctx, store } = makeContext(port, { focusModuleApiName: 'Deals' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    expect(container.querySelector('.amc-world')?.classList.contains('amc-searching')).toBe(false);
    store.set({ query: 'update_sales_health' });
    board.flush();
    const world = container.querySelector('.amc-world') as HTMLElement;
    expect(world.classList.contains('amc-searching')).toBe(true);
    const matches = container.querySelectorAll('.amc-nd.amc-match');
    const cards = container.querySelectorAll('.amc-nd');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThan(cards.length);
    // Non-matches carry no match class: the stylesheet dims exactly those (.amc-searching).
    const hits = new Set(
      port.search('update_sales_health', store.get().filters).map((hit) => hit.nodeId),
    );
    for (const card of cards) {
      const item = board.model().byIid.get(card.getAttribute('data-iid') ?? '');
      const expected = !!item?.node && hits.has(item.node.id);
      if (item?.node) expect(card.classList.contains('amc-match')).toBe(expected);
    }
    // Islands with no match are dimmed and badged "0".
    const empty = container.querySelectorAll('.amc-isl.amc-nomatch .amc-ismatch');
    for (const badge of empty) expect(badge.textContent).toBe('0');
    expect(container.querySelector('.amc-isl .amc-ismatch')?.textContent).toMatch(/^\d+$/);
    store.set({ query: '' });
    board.flush();
    expect(world.classList.contains('amc-searching')).toBe(false);
    expect(container.querySelectorAll('.amc-nd.amc-match').length).toBe(0);
    board.dispose();
  });

  it('moves selection along edges with the arrow keys', () => {
    const { ctx, store } = makeContext(fixturePort(), { focusModuleApiName: 'Deals' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const model = board.model();
    const deals = model.islands.find((I) => I.id === 'Deals');
    const rule = deals?.items.find((i) => i.kind === 'rule');
    expect(rule).toBeDefined();
    const ruleCard = container.querySelector(`[data-iid="${rule?.iid}"]`) as HTMLElement;
    fire(ruleCard, 'click');
    const root = container.querySelector('.amc-root') as HTMLElement;
    const focused = () => (document.activeElement as HTMLElement | null)?.getAttribute('data-iid');
    press(root, 'ArrowRight');
    const firstDown = deals?.edges.find((e) => e.from === rule?.iid && !e.back && !e.hover);
    expect(firstDown).toBeDefined();
    expect(focused()).toBe(firstDown?.to);
    // The selection (and so the inspector) follows the keyboard.
    expect(store.get().selectedId).toBe(model.byIid.get(firstDown?.to ?? '')?.node?.id);
    press(root, 'ArrowLeft');
    expect(focused()).toBe(rule?.iid);
    expect(store.get().selectedId).toBe(rule?.node?.id);
    // Up/down walk the lane.
    press(root, 'ArrowDown');
    const lane =
      deals?.items
        .filter((i) => i.lane === 'rules' && i.col === rule?.col)
        .sort((a, b) => a.y - b.y) ?? [];
    expect(focused()).toBe(lane[lane.indexOf(rule as (typeof lane)[number]) + 1]?.iid);
    press(root, 'ArrowUp');
    expect(focused()).toBe(rule?.iid);
    // T traces from the selection.
    press(root, 't');
    expect(store.get().traceRootId).toBe(store.get().selectedId);
    expect(store.get().view).toBe('trace');
    board.dispose();
  });

  it('zooms with + - 0 keys', () => {
    const { ctx } = makeContext(fixturePort());
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const root = container.querySelector('.amc-root') as HTMLElement;
    const z0 = board.camera().zoom;
    press(root, '+');
    expect(board.camera().zoom).toBeGreaterThan(z0);
    press(root, '-');
    press(root, '-');
    expect(board.camera().zoom).toBeLessThan(z0);
    press(root, '0');
    expect(board.camera().zoom).toBeCloseTo(z0, 5);
    board.dispose();
  });
});

describe('camera and store sync', () => {
  it('frames the focused module on mount', () => {
    const { ctx } = makeContext(fixturePort(), { focusModuleApiName: 'Deals' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const deals = board.model().islands.find((I) => I.id === 'Deals');
    const cam = board.camera();
    const cx = cam.x + 1280 / cam.zoom / 2;
    const cy = cam.y + 800 / cam.zoom / 2;
    expect(deals).toBeDefined();
    if (!deals) return;
    expect(cx).toBeGreaterThan(deals.x);
    expect(cx).toBeLessThan(deals.x + deals.w);
    expect(cy).toBeGreaterThan(deals.y);
    expect(cy).toBeLessThan(deals.y + deals.h);
    board.dispose();
  });

  it('writes the camera back to the store, throttled, and ignores its own echo', () => {
    vi.useFakeTimers();
    try {
      const { ctx, store } = makeContext(fixturePort(), { camera: { x: 100, y: 200, zoom: 0.5 } });
      const container = attach();
      const board = createBoard(container, ctx);
      board.flush();
      // An explicit camera is restored as is.
      expect(board.camera()).toEqual({ x: 100, y: 200, zoom: 0.5 });
      store.sets.length = 0;
      for (let i = 0; i < 20; i++) board.setCamera({ x: 100 + i * 10, y: 200, zoom: 0.5 });
      expect(store.sets.filter((s) => s.camera).length).toBe(0);
      vi.advanceTimersByTime(300);
      const writes = store.sets.filter((s) => s.camera);
      expect(writes.length).toBe(1);
      expect(writes[0].camera).toEqual(board.camera());
      // The echo of our own write does not move the camera or write again.
      vi.advanceTimersByTime(1000);
      expect(store.sets.filter((s) => s.camera).length).toBe(1);
      // An external camera change is applied.
      store.set({ camera: { x: 900, y: 40, zoom: 0.8 } });
      expect(board.camera()).toEqual({ x: 900, y: 40, zoom: 0.8 });
      board.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reserves the inspector width when centring a selection', () => {
    const { ctx, store } = makeContext(fixturePort(), { inspectorOpen: true });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    // Zoomed in somewhere else, so the selection is off-screen and must be flown to.
    board.setCamera({ x: 0, y: 0, zoom: 1 });
    board.flush();
    const rule = [...board.model().byIid.values()].find(
      (i) => i.kind === 'rule' && i.islandId === 'Quotes',
    );
    store.set({ selectedId: rule?.node?.id ?? null });
    board.flush();
    const cam = board.camera();
    const item = rule as NonNullable<typeof rule>;
    const island = board.model().islands.find((I) => I.id === item.islandId);
    // The island is framed in the area left of a 400px inspector (1280 - 400 = 880), and the
    // selected node sits inside it.
    const left = ((island?.x ?? 0) - cam.x) * cam.zoom;
    const right = ((island?.x ?? 0) + (island?.w ?? 0) - cam.x) * cam.zoom;
    const nodeRight = ((island?.x ?? 0) + item.x + item.w - cam.x) * cam.zoom;
    expect(nodeRight).toBeLessThanOrEqual(880);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right <= 880 || cam.zoom <= 0.5 + 1e-6).toBe(true);
    board.dispose();
  });

  it('disposes cleanly', () => {
    const { ctx, store } = makeContext(fixturePort());
    const container = attach();
    const board = createBoard(container, ctx);
    board.dispose();
    expect(container.querySelector('.amc-root')).toBeNull();
    expect(() => store.set({ query: 'x', selectedId: 'rule:rule-000' })).not.toThrow();
  });
});

describe('store patches and snapshots', () => {
  it('applies focus, selection and camera from the same patch as a filter change', () => {
    const { ctx, store } = makeContext(fixturePort());
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    expect(board.tier()).toBe('overview');
    // The "What runs when a Deal is edited?" card: one patch, several fields.
    store.set({
      focusModuleApiName: 'Deals',
      filters: { ...defaultFilters(), triggerTypes: new Set(['field_update'] as const) },
    });
    board.flush();
    const deals = board.model().islands.find((I) => I.id === 'Deals');
    const cam = board.camera();
    expect(deals).toBeDefined();
    if (!deals) return;
    const cx = cam.x + 1280 / cam.zoom / 2;
    expect(cx).toBeGreaterThan(deals.x);
    expect(cx).toBeLessThan(deals.x + deals.w);
    expect(board.tier()).not.toBe('overview');
    board.dispose();
  });

  it('keeps cards and keyboard focus when only coverage changes', () => {
    const port = fixturePort();
    const { ctx, store } = makeContext(port, { focusModuleApiName: 'Deals' });
    const container = attach();
    const dispose = mountBoardView(container, ctx);
    const board = boardControllerFor(container);
    board?.flush();
    const rule = [...(board?.model().byIid.values() ?? [])].find(
      (i) => i.kind === 'rule' && i.islandId === 'Deals',
    );
    fire(container.querySelector(`[data-iid="${rule?.iid}"]`) as Element, 'click');
    press(container.querySelector('.amc-root') as HTMLElement, 'ArrowRight');
    const focused = document.activeElement;
    expect(focused?.getAttribute('data-iid')).toBeTruthy();
    const cards = [...container.querySelectorAll('.amc-nd')];
    const selected = store.get().selectedId;
    // Progressive loading: new snapshot objects, same graph.
    port.publish({ ...port.snapshot(), phase: 'enriching' });
    port.publish({ ...port.snapshot(), phase: 'complete' });
    expect(document.activeElement).toBe(focused);
    expect([...container.querySelectorAll('.amc-nd')]).toEqual(cards);
    expect(store.get().selectedId).toBe(selected);
    // A new graph does rebuild.
    port.publish({ ...port.snapshot(), graph: buildAutomationGraph(fixtureInputs()) });
    expect([...container.querySelectorAll('.amc-nd')].some((c) => cards.includes(c))).toBe(false);
    dispose();
  });

  it('brings a selection that is off-screen into view on mount', () => {
    const graph = fixtureGraph();
    const rule = [...graph.nodes.values()].find(
      (n) => n.kind === 'rule' && n.moduleApiName === 'Quotes',
    );
    const { ctx } = makeContext(portFor(graph), {
      selectedId: rule?.id ?? null,
      inspectorOpen: true,
    });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    // "Show on map": readable zoom on the rule, not the whole-estate overview.
    expect(board.tier()).not.toBe('overview');
    const item = board.model().byNode.get(rule?.id ?? '')?.[0];
    const island = board.model().islands.find((I) => I.id === item?.islandId);
    const cam = board.camera();
    const nodeRight = ((island?.x ?? 0) + (item?.x ?? 0) + (item?.w ?? 0) - cam.x) * cam.zoom;
    const nodeLeft = ((island?.x ?? 0) + (item?.x ?? 0) - cam.x) * cam.zoom;
    // Inside the area a 400px inspector leaves free (1280 - 400).
    expect(nodeRight).toBeLessThanOrEqual(880);
    expect(nodeLeft).toBeGreaterThanOrEqual(0);
    board.dispose();
  });
});

describe('island header text', () => {
  it('describes write-only islands by who writes to them', () => {
    const { model } = modelFor();
    const tasks = model.islands.find((I) => I.id === 'Tasks');
    expect(tasks?.stats.rules).toBe(0);
    expect(tasks?.stats.writtenFrom).toBeGreaterThan(3);
    expect(countsText(tasks as NonNullable<typeof tasks>)).toBe(
      `written from ${tasks?.stats.writtenFrom} modules`,
    );
    const deals = model.islands.find((I) => I.id === 'Deals');
    expect(countsText(deals as NonNullable<typeof deals>)).toMatch(/^\d+ rules · \d+ active/);
  });
});

describe('filters', () => {
  it('rebuilds when filters change and shows an empty state when nothing matches', () => {
    const { ctx, store } = makeContext(fixturePort());
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const all = board.stats().items;
    store.set({ filters: { ...defaultFilters(), modules: new Set(['Deals']) } });
    board.flush();
    expect(board.stats().islands).toBeLessThan(10);
    expect(board.stats().items).toBeLessThan(all);
    store.set({ filters: { ...defaultFilters(), modules: new Set(['Nowhere']) } });
    board.flush();
    expect(container.querySelector('.amc-empty')?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('.amc-empty')?.textContent).toContain('Nothing matches');
    (container.querySelector('.amc-empty button') as HTMLElement).click();
    expect(store.get().filters.modules.size).toBe(0);
    board.dispose();
  });

  it('scopeOnlyFilters drops everything but the scope', () => {
    const f = scopeOnlyFilters({
      ...defaultFilters(),
      modules: new Set(['A']),
      kinds: new Set(['rule']),
    });
    expect(f.modules.size + f.kinds.size + f.triggerTypes.size + f.flags.size).toBe(0);
  });
});
