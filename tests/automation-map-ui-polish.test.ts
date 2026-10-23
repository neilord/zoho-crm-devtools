/**
 * Design-review fixes at the integration seam: the real overlay with the real canvas views.
 * Each test pins a behaviour a reviewer hit in the integrated UI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAutomationGraph } from '../src/content/automation-map/graph';
import type {
  AutomationGraph,
  AutomationMapSnapshot,
  MapEdge,
  MapNode,
} from '../src/content/automation-map/types';
import {
  boardControllerFor,
  canvasStyles,
  mountBoardView,
  mountTraceView,
} from '../src/content/automation-map/ui/canvas';
import { createBoard } from '../src/content/automation-map/ui/canvas/board';
import { TITLE_ZONE_H } from '../src/content/automation-map/ui/canvas/geometry';
import type { BoardIsland } from '../src/content/automation-map/ui/canvas/model';
import type {
  MapUiContext,
  MapViewState,
  ViewStore,
} from '../src/content/automation-map/ui/context';
import { drawEdges } from '../src/content/automation-map/ui/fields-view';
import { HOST_ID, mountAutomationMap } from '../src/content/automation-map/ui/overlay';
import {
  attach,
  fire,
  fixturePort,
  installDomStubs,
  makeContext,
  portFor,
  press,
} from './automation-map-canvas-fixtures';
import { canvasCssSource } from './automation-map-css-source';
import { generateLargeInputs } from './fixtures/automation-map';
import { createFixturePort, type FixtureMode } from './fixtures/automation-map-port';

interface Real {
  close(): void;
  shadow: ShadowRoot;
  store(): ViewStore;
  active(): HTMLElement | null;
  press(key: string, init?: KeyboardEventInit): void;
  q<T extends HTMLElement = HTMLElement>(selector: string): T | null;
}

const open: Array<() => void> = [];

function mountReal(
  state: Partial<MapViewState> = {},
  mode: FixtureMode = 'full',
  snapshot?: AutomationMapSnapshot,
): Real {
  let store: ViewStore | null = null;
  const grab = (ctx: MapUiContext) => {
    store = ctx.view;
  };
  const { port: base } = createFixturePort(mode);
  const handle = mountAutomationMap({
    port: snapshot ? { ...base, snapshot: () => snapshot } : base,
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
  open.push(() => handle.close());
  const shadow = (document.getElementById(HOST_ID) as HTMLElement).shadowRoot as ShadowRoot;
  const active = () => shadow.activeElement as HTMLElement | null;
  return {
    close: () => handle.close(),
    shadow,
    store: () => store as ViewStore,
    active,
    // Keys are dispatched at the focused element, as a browser does.
    press(key, init = {}) {
      (active() ?? (document.getElementById(HOST_ID) as HTMLElement)).dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          composed: true,
          cancelable: true,
          ...init,
        }),
      );
    },
    q: (selector) => shadow.querySelector(selector),
  };
}

beforeEach(() => installDomStubs());
afterEach(() => {
  for (const stop of open.splice(0)) stop();
  document.body.replaceChildren();
  history.replaceState(null, '', location.pathname);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('design review: focus survives a view switch', () => {
  it('keeps the keyboard map alive across T, Esc, L, F and B', () => {
    const map = mountReal({ selectedId: 'rule:rule-005', inspectorOpen: true });
    const within = (host: string) => map.q(host)?.contains(map.active()) ?? false;
    // Opening the map focuses the dialog; the first view switch must hand focus to the canvas.
    map.press('t');
    expect(map.store().get().view).toBe('trace');
    expect(within('#am-trace'), 'trace canvas has focus after T').toBe(true);
    map.press('Escape');
    expect(map.store().get().view).toBe('board');
    expect(within('#am-board'), 'board canvas has focus after Esc').toBe(true);
    map.press('l');
    expect(map.store().get().view).toBe('list');
    expect(within('#am-list'), 'list has focus after L').toBe(true);
    map.press('f');
    expect(map.store().get().view).toBe('fields');
    expect(within('#am-fields'), 'fields view has focus after F').toBe(true);
    map.press('b');
    expect(map.store().get().view).toBe('board');
    expect(within('#am-board'), 'board canvas has focus after B').toBe(true);
    // The shortcuts still work from here: trace again, and Esc leaves it.
    map.press('t');
    expect(map.store().get().view).toBe('trace');
    map.press('Escape');
    expect(map.store().get().view).toBe('board');
  });

  it('does not take focus from the search box when a match changes the view', () => {
    const map = mountReal({ view: 'trace', traceRootId: 'rule:rule-005' });
    const input = map.q<HTMLInputElement>('.am-search input') as HTMLInputElement;
    input.focus();
    map.store().set({ query: 'maintain_deals' });
    map.press('Enter');
    expect(map.store().get().view).toBe('board');
    expect(map.active()).toBe(input);
  });
});

describe('design review: Enter in search stays in the current view', () => {
  it('selects a field match on the board instead of jumping to the Fields lens', () => {
    const map = mountReal();
    const input = map.q<HTMLInputElement>('.am-search input') as HTMLInputElement;
    input.focus();
    map.store().set({ query: 'stage' });
    map.press('Enter');
    const s = map.store().get();
    expect(s.view).toBe('board');
    expect(s.field).toBeNull();
    expect(s.selectedId).not.toBeNull();
    expect(s.inspectorOpen).toBe(true);
    expect(map.active()).toBe(input);
    // Enter keeps stepping from the board.
    const first = s.selectedId;
    map.press('Enter');
    expect(map.store().get().selectedId).not.toBe(first);
    expect(map.store().get().view).toBe('board');
  });

  it('stays in the list view too, and still opens the lens for a field: query', () => {
    const map = mountReal();
    map.store().set({ view: 'list' });
    const input = map.q<HTMLInputElement>('.am-search input') as HTMLInputElement;
    input.focus();
    map.store().set({ query: 'stage' });
    map.press('Enter');
    expect(map.store().get().view).toBe('list');
    map.store().set({ query: 'field:Deals.Stage' });
    map.press('Enter');
    expect(map.store().get()).toMatchObject({
      view: 'fields',
      field: { moduleApiName: 'Deals', fieldApiName: 'Stage' },
    });
  });
});

/** The teaser the store builds reveals one rule; a fixture may reveal more. Copy must follow the graph. */
function teaserWith(rules: number): AutomationMapSnapshot {
  const { port } = createFixturePort('teaser');
  const base = port.snapshot();
  const full = createFixturePort('full').port.snapshot().graph;
  const keep: MapNode[] = [];
  let seen = 0;
  for (const node of full.nodes.values()) {
    if (node.kind === 'rule' && node.moduleApiName !== 'Deals') continue;
    if (node.kind === 'rule' && seen++ >= rules) continue;
    if (node.kind === 'module' && node.apiName !== 'Deals') continue;
    keep.push(node);
  }
  const ids = new Set(keep.map((n) => n.id));
  const edges: MapEdge[] = full.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const graph: AutomationGraph = {
    nodes: new Map(keep.map((n) => [n.id, n])),
    edges,
    outgoing: new Map([...ids].map((id) => [id, edges.filter((e) => e.from === id)])),
    incoming: new Map([...ids].map((id) => [id, edges.filter((e) => e.to === id)])),
    modules: full.modules.filter((m) => m.apiName === 'Deals'),
  };
  return { ...base, graph };
}

describe('design review: preview copy follows the snapshot', () => {
  it.each([
    [1, "You're seeing 1 flow.", 'one real flow'],
    [3, "You're seeing 3 flows.", '3 real flows'],
  ])('with %i revealed rules the card, pill, rail and popover agree', (n, title, rail) => {
    const map = mountReal({}, 'teaser', teaserWith(n));
    expect(map.q('.fog-card h3')?.textContent).toContain(title);
    expect(map.q('.rail')?.textContent ?? map.shadow.textContent).toContain(rail);
    // The Deals island on the board says the same number.
    const island = [...map.shadow.querySelectorAll('.amc-isl')].find((i) =>
      i.querySelector('.amc-preview-rib'),
    );
    expect(island?.textContent).toContain(`${n === 1 ? '1 flow' : `${n} flows`} shown`);
    (map.q('[data-fk="fog-later"]') as HTMLElement).click();
    expect(map.q('.fog-pill')?.textContent).toContain(`${n === 1 ? '1 flow' : `${n} flows`} shown`);
  });
});

describe('design review: the lens says it has gaps without a scroll', () => {
  const lens = {
    view: 'fields',
    field: { moduleApiName: 'Deals', fieldApiName: 'Stage' },
  } as const;

  it('puts the gap count in the summary row, matching the coverage statement below', () => {
    const map = mountReal(lens);
    const chip = map.q<HTMLButtonElement>('.lens-sum [data-fk="lens-gap-chip"]');
    expect(chip?.textContent).toMatch(/2 gaps in the map/);
    expect(map.q('.lens-foot')?.textContent).toContain('2 gaps in the map');
    const foot = map.q('.lens-foot') as HTMLElement;
    const scroll = vi.fn();
    foot.scrollIntoView = scroll;
    chip?.click();
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('is absent when every function was analysed, and in the preview', () => {
    const snap = createFixturePort('full').port.snapshot();
    const clean = {
      ...snap,
      coverage: {
        ...snap.coverage,
        gaps: 0,
        functions: {
          ...snap.coverage.functions,
          limited: 0,
          unsupported: 0,
          sourceUnavailable: 0,
          failed: 0,
        },
      },
    };
    const map = mountReal(lens, 'full', clean);
    expect(map.q('[data-fk="lens-gap-chip"]')).toBeNull();
    map.close();
    const preview = mountReal({ view: 'fields', field: lens.field }, 'teaser');
    expect(preview.q('[data-fk="lens-gap-chip"]')).toBeNull();
  });
});

describe('design review: chrome does not cover content', () => {
  const island = (board: ReturnType<typeof boardControllerFor>, id: string) => {
    const I = board?.model().islands.find((x) => x.id === id);
    const cam = board?.camera();
    if (!I || !cam) throw new Error('island missing');
    // Screen rect of an island's body, with its overview title zone above it.
    const sx = (x: number) => (x - cam.x) * cam.zoom;
    const sy = (y: number) => (y - cam.y) * cam.zoom;
    return {
      x: sx(I.x),
      y: sy(I.y - TITLE_ZONE_H),
      w: I.w * cam.zoom,
      h: (I.h + TITLE_ZONE_H) * cam.zoom,
    };
  };
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  it('frames the overview clear of the banner and the minimap', () => {
    const { ctx } = makeContext(fixturePort());
    const container = attach();
    // The shell publishes the banner as a top inset; the board frames below it.
    container.style.setProperty('--am-safe-top', '120px');
    const dispose = mountBoardView(container, ctx);
    const board = boardControllerFor(container);
    board?.fitAll(false);
    board?.flush();
    // jsdom has no layout: the viewport falls back to 1280x800.
    const minimap = { x: 12, y: 800 - 186, w: 186, h: 126 };
    const zoomBar = { x: 12, y: 800 - 52, w: 320, h: 40 };
    for (const I of board?.model().islands ?? []) {
      const r = island(board, I.id);
      expect(r.y, `${I.id} title below the banner`).toBeGreaterThanOrEqual(120 - 1);
      expect(overlaps(r, minimap), `${I.id} under the minimap`).toBe(false);
      expect(overlaps(r, zoomBar), `${I.id} under the zoom bar`).toBe(false);
    }
    dispose();
  });

  it('frames a tall island below the banner when a toolbar entry flies to it', () => {
    const graph = buildAutomationGraph(generateLargeInputs({ rules: 330, functions: 920 }));
    const { ctx } = makeContext(portFor(graph), { focusModuleApiName: 'Deals' });
    const container = attach();
    container.style.setProperty('--am-safe-top', '120px');
    const board = createBoard(container, ctx);
    board.flush();
    const I = board.model().islands.find((x) => x.id === 'Deals') as BoardIsland;
    const cam = board.camera();
    // A 330-rule island cannot be framed whole: it opens at compact zoom, from its top.
    expect(cam.zoom).toBeCloseTo(0.5, 5);
    expect((I.y - 20 - cam.y) * cam.zoom).toBeGreaterThanOrEqual(120 - 1);
    board.dispose();
  });

  /** jsdom has no layout: give the board canvas the size a 1280x657 window leaves it (banner aside). */
  const sizeCanvas = (width: number, height: number) =>
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const box = this.classList.contains('amc-canvas');
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: box ? width : 0,
        bottom: box ? height : 0,
        width: box ? width : 0,
        height: box ? height : 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

  it('frames a 330-rule estate below the banner and clear of the minimap, too big to fit', () => {
    // Live: at real-org scale the overview cannot fit even at the zoom floor. Centring it then put
    // the first row of island titles under the gap banner and the last under the corner chrome.
    sizeCanvas(996, 553);
    const graph = buildAutomationGraph(generateLargeInputs({ rules: 330, functions: 920 }));
    const { ctx } = makeContext(portFor(graph));
    const container = attach();
    container.style.setProperty('--am-safe-top', '75px');
    const dispose = mountBoardView(container, ctx);
    const board = boardControllerFor(container);
    board?.fitAll(false);
    board?.flush();
    expect(
      board?.camera().zoom,
      'the estate is taller than the canvas at the floor zoom',
    ).toBeCloseTo(0.06, 5);
    const minimap = { x: 12, y: 553 - 185, w: 186, h: 126 };
    const zoomBar = { x: 12, y: 553 - 52, w: 320, h: 40 };
    const islands = board?.model().islands ?? [];
    expect(islands.length).toBeGreaterThan(5);
    for (const I of islands) {
      const r = island(board, I.id);
      expect(r.y, `${I.id} title below the banner`).toBeGreaterThanOrEqual(75 - 1);
      expect(overlaps(r, minimap), `${I.id} under the minimap`).toBe(false);
      expect(overlaps(r, zoomBar), `${I.id} under the zoom bar`).toBe(false);
    }
    dispose();
  });

  /** The zoom bar's layout in a real browser (jsdom has none): 355px wide at 12px from the left. */
  const layoutZoomBar = () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('amc-zoom') ? 355 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('amc-zoom') ? 12 : 0;
    });
  };

  it('centres a low-zoom overview in the free area and nudges it only as far as the chrome needs', () => {
    // Live (1280x657): the 6% overview sat in the right 60% of the canvas, because the left
    // reserve took the zoom bar's whole width as a full-height strip.
    sizeCanvas(996, 553);
    layoutZoomBar();
    const graph = buildAutomationGraph(generateLargeInputs({ rules: 330, functions: 920 }));
    const { ctx } = makeContext(portFor(graph));
    const container = attach();
    container.style.setProperty('--am-safe-top', '75px');
    const dispose = mountBoardView(container, ctx);
    const board = boardControllerFor(container);
    board?.fitAll(false);
    board?.flush();
    // The board's own keep-clear rects: the bar (12 + 355 + 12 margin) and the minimap column.
    const notches = [
      { x: 0, y: 553 - 56, w: 379, h: 56 },
      { x: 0, y: 553 - 196, w: 204, h: 196 },
    ];
    const boxes = (board?.model().islands ?? []).map((I) => island(board, I.id));
    expect(boxes.length).toBeGreaterThan(5);
    const under = (dx: number) =>
      boxes.some((b) => notches.some((n) => overlaps({ ...b, x: b.x + dx }, n)));
    expect(under(0), 'no island under the zoom bar or the minimap').toBe(false);
    const left = Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.w));
    const offset = (left + right) / 2 - 996 / 2;
    // Either centred, or 8px closer to the centre would put an island under the chrome.
    if (Math.abs(offset) > 2) expect(under(offset > 0 ? -8 : 8)).toBe(true);
    // Not the old right-hand packing: the board starts well left of the old 364px reserve + pad.
    expect(left).toBeLessThan(364 + 48 - 100);
    dispose();
  });

  it('frames a tall island at compact zoom with no card under the zoom bar or the minimap', () => {
    // Live (Show on board): the island opened at 50% beside the minimap, and its Entry rows sat
    // under the bar, because the bar's column was used only when the whole island width fit.
    sizeCanvas(996, 553);
    layoutZoomBar();
    const graph = buildAutomationGraph(generateLargeInputs({ rules: 330, functions: 920 }));
    const { ctx } = makeContext(portFor(graph));
    const container = attach();
    container.style.setProperty('--am-safe-top', '75px');
    const board = createBoard(container, ctx);
    board.flush();
    const I = board.model().islands.find((x) => x.id === 'Deals') as BoardIsland;
    // A long Entry column, as in a busy module: rows all the way down the window.
    for (const [i, item] of I.items.filter((x) => x.lane === 'entry').entries())
      item.y = 100 + i * 90;
    board.flyToIsland('Deals', false);
    const cam = board.camera();
    expect(cam.zoom).toBeCloseTo(0.5, 5);
    const bar = { x: 12, y: 553 - 52, w: 355, h: 40 };
    const minimap = { x: 12, y: 553 - 185, w: 186, h: 126 };
    const visible = I.items
      .map((it) => ({
        id: it.lane,
        x: (I.x + it.x - cam.x) * cam.zoom,
        y: (I.y + it.y - cam.y) * cam.zoom,
        w: it.w * cam.zoom,
        h: it.h * cam.zoom,
      }))
      .filter((c) => c.y + c.h > 75 && c.y < 553);
    expect(visible.some((c) => c.id === 'entry')).toBe(true);
    for (const c of visible) {
      expect(overlaps(c, bar), `${c.id} card under the zoom bar`).toBe(false);
      expect(overlaps(c, minimap), `${c.id} card under the minimap`).toBe(false);
    }
    board.dispose();
  });

  it('drops the world layer hint at the zoom floor so the backdrop is painted in full', () => {
    // Live: at 6% the will-change layer kept its 1:1 raster scale, ran out of tile memory and left
    // rectangles of the backdrop unpainted (hard seams). Headless: ~20% of the canvas, half the loads.
    const { ctx } = makeContext(fixturePort());
    const container = attach();
    const dispose = mountBoardView(container, ctx);
    const board = boardControllerFor(container);
    const canvas = container.querySelector('.amc-canvas') as HTMLElement;
    board?.setCamera({ x: 0, y: 0, zoom: 0.5 });
    expect(canvas.classList.contains('amc-far')).toBe(false);
    board?.setCamera({ x: 0, y: 0, zoom: 0.1 });
    expect(canvas.classList.contains('amc-far')).toBe(true);
    expect(canvasCssSource('canvas')).toMatch(/\.amc-far \.amc-world\s*\{[^}]*will-change:\s*auto/);
    dispose();
  });

  it('shows the minimap while zoomed out, steps it aside once cards are readable, and lets you bring it back', () => {
    sizeCanvas(996, 553);
    const { ctx } = makeContext(fixturePort());
    const container = attach();
    const dispose = mountBoardView(container, ctx);
    const board = boardControllerFor(container);
    const mini = container.querySelector('.amc-mini') as HTMLElement;
    const toggle = container.querySelector('.amc-zoom [aria-label="Minimap"]') as HTMLElement;
    board?.setCamera({ x: 0, y: 0, zoom: 0.2 });
    board?.flush();
    expect(mini.hidden).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    board?.setCamera({ x: 0, y: 0, zoom: 0.9 });
    board?.flush();
    expect(mini.hidden, 'the minimap would cover readable cards').toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fire(toggle, 'click');
    expect(mini.hidden).toBe(false);
    fire(toggle, 'click');
    expect(mini.hidden).toBe(true);
    // Hiding it holds when zoomed out again.
    board?.setCamera({ x: 0, y: 0, zoom: 0.2 });
    board?.flush();
    expect(mini.hidden).toBe(true);
    dispose();
  });

  it('opens a tall island beside the minimap, not under it', () => {
    sizeCanvas(996, 553);
    const graph = buildAutomationGraph(generateLargeInputs({ rules: 330, functions: 920 }));
    const { ctx } = makeContext(portFor(graph), { focusModuleApiName: 'Deals' });
    const container = attach();
    container.style.setProperty('--am-safe-top', '75px');
    const board = createBoard(container, ctx);
    board.flush();
    const I = board.model().islands.find((x) => x.id === 'Deals') as BoardIsland;
    const cam = board.camera();
    expect(cam.zoom).toBeCloseTo(0.5, 5);
    expect(
      (I.x - cam.x) * cam.zoom,
      'island left edge clears the minimap column',
    ).toBeGreaterThanOrEqual(186 + 12);
    expect((I.y - 20 - cam.y) * cam.zoom).toBeGreaterThanOrEqual(75 - 1);
    board.dispose();
  });

  it('keeps a selected node out from under the inspector', () => {
    const { ctx, store } = makeContext(fixturePort(), { focusModuleApiName: 'Deals' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    // Park a rule against the right edge, then select it: the camera slides it clear.
    const rule = [...board.model().byIid.values()].find(
      (i) => i.kind === 'rule' && i.islandId === 'Deals',
    );
    const item = rule as NonNullable<typeof rule>;
    const I = board.model().islands.find((x) => x.id === 'Deals') as NonNullable<
      ReturnType<typeof board.model>['islands'][number]
    >;
    const cam = board.camera();
    board.setCamera({ x: I.x + item.x - (1280 - 120) / cam.zoom, y: cam.y, zoom: cam.zoom });
    board.flush();
    const card = container.querySelector(`[data-iid="${item.iid}"]`) as HTMLElement;
    fire(card, 'click');
    board.flush();
    const after = board.camera();
    const right = (I.x + item.x + item.w - after.x) * after.zoom;
    expect(store.get().inspectorOpen).toBe(true);
    expect(right).toBeLessThanOrEqual(1280 - 400);
    board.dispose();
  });

  it('starts the upgrade card as the pill at 1100px and narrower', () => {
    const narrow = (matches: boolean) =>
      vi.stubGlobal(
        'matchMedia',
        (query: string) =>
          ({
            matches: query.includes('1100') ? matches : query.includes('reduced-motion'),
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
          }) as unknown as MediaQueryList,
      );
    narrow(true);
    let map = mountReal({}, 'teaser');
    expect(map.q('.fog-card')).toBeNull();
    expect(map.q('.fog-pill')).not.toBeNull();
    map.close();
    narrow(false);
    map = mountReal({}, 'teaser');
    expect(map.q('.fog-card')).not.toBeNull();
    expect(map.q('.fog-pill')).toBeNull();
  });
});

describe('design review: overview flows', () => {
  it('shows one card per hovered island instead of a label on every curve', () => {
    const { ctx } = makeContext(fixturePort());
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    expect(board.tier()).toBe('overview');
    // No text sits on the curves any more; they collided and sank under islands.
    expect(container.querySelectorAll('.amc-flows text').length).toBe(0);
    const card = container.querySelector('.amc-flowcard') as HTMLElement;
    expect(card.hidden).toBe(true);
    const deals = container.querySelector('.amc-isl[data-island="Deals"]') as HTMLElement;
    const sum = deals.querySelector('.amc-sum') as HTMLElement;
    sum.dispatchEvent(new Event('pointerenter'));
    expect(card.hidden).toBe(false);
    expect(container.querySelectorAll('.amc-flowcard').length).toBe(1);
    expect(card.querySelector('b')?.textContent).toBe('Deals');
    expect(card.textContent).toMatch(/Writes into/);
    expect(card.textContent).toMatch(/Written from/);
    // Every row names a module and counts its writes.
    for (const row of card.querySelectorAll('.amc-fr'))
      expect(row.textContent).toMatch(/\d+ writes?$/);
    expect(container.querySelectorAll('.amc-ov.amc-on').length).toBeGreaterThan(0);
    sum.dispatchEvent(new Event('pointerleave'));
    expect(card.hidden).toBe(true);
    expect(container.querySelectorAll('.amc-ov.amc-on').length).toBe(0);
    board.dispose();
  });
});

describe('design review: a large org stays readable and inside the render budget', () => {
  const large = () => {
    const graph = buildAutomationGraph(generateLargeInputs({ rules: 330, functions: 920 }));
    const { ctx } = makeContext(portFor(graph));
    const container = attach();
    return { board: createBoard(container, ctx), container };
  };

  it('draws a cascade to the rule event, not to every rule it starts', () => {
    const { board } = large();
    const cascades = board
      .model()
      .islands.flatMap((I) => I.edges.filter((e) => e.kind === 'cascades').map((e) => ({ I, e })));
    expect(cascades.length).toBeGreaterThan(0);
    for (const { I, e } of cascades)
      expect(I.byIid.get(e.to)?.kind, 'cascade target').toBe('event');
    board.dispose();
  });

  it('still marks a cascade that closes a loop once it ends at the event', () => {
    const { ctx } = makeContext(fixturePort());
    const board = createBoard(attach(), ctx);
    const loops = board
      .model()
      .islands.flatMap((I) => I.edges.filter((e) => e.kind === 'cascades' && e.back && e.loop));
    expect(loops.length).toBeGreaterThan(0);
    board.dispose();
  });

  it('bundles more than eight converging edges into one trunk with a count', () => {
    const { board, container } = large();
    const deals = board.model().islands.find((I) => I.id === 'Deals') as BoardIsland;
    board.setCamera({ x: deals.x - 40, y: deals.y - 120, zoom: 1 });
    board.flush();
    const resting = deals.edges.filter((e) => !e.hover && !e.hub);
    const stage = deals.items.find((i) => i.node?.kind === 'field' && i.node.label === 'Stage');
    const into = resting.filter((e) => e.to === stage?.iid).length;
    expect(into).toBeGreaterThan(8);
    const trunk = container.querySelector('.amc-e-trunk');
    expect(trunk).not.toBeNull();
    expect(container.querySelector('.amc-trunk-n')?.textContent).toMatch(/^×\d+$/);
    // The fifty-odd edges into Stage cost a handful of paths, not one each.
    expect(board.stats().edges).toBeLessThan(resting.length - into / 2);
    board.dispose();
  });

  it('keeps compact zoom inside the ~1,500 element budget, even where it is densest', () => {
    const { board } = large();
    let worst = 0;
    for (const I of board.model().islands) {
      board.setCamera({ x: I.x - 40, y: I.y - 120, zoom: 0.5 });
      board.flush();
      board.setCamera({ x: I.x - 40, y: I.y - 120, zoom: 0.4 });
      board.flush();
      worst = Math.max(worst, board.stats().elements);
    }
    expect(board.tier()).toBe('compact');
    expect(worst).toBeLessThanOrEqual(1500);
    board.dispose();
  });
});

describe('design review: overview summaries', () => {
  it('leads a hub chip with its caller count so truncation cannot hide it', () => {
    const { ctx } = makeContext(fixturePort());
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const chips = [...container.querySelectorAll('.amc-hubchip')];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.querySelector('.amc-hc-n')?.textContent).toMatch(/^\d+$/);
      // Count first, then the (truncatable) name.
      expect(chip.children[1]?.className).toBe('amc-hc-n');
      expect(chip.children[2]?.textContent?.length).toBeGreaterThan(0);
    }
    board.dispose();
  });
});

describe('design review: portal jump', () => {
  it('lands on the written field, in view beside the inspector, with the stub still lit', () => {
    const { ctx, store } = makeContext(fixturePort(), { focusModuleApiName: 'Deals' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const model = board.model();
    const stub = [...model.byIid.values()].find(
      (i) => i.islandId === 'Deals' && i.portal?.dir === 'out' && i.portal.fieldIds.length === 1,
    );
    const fieldId = stub?.portal?.fieldIds[0] as string;
    const partner = model.byIid.get(stub?.portal?.partnerIid ?? '');
    fire(container.querySelector(`[data-iid="${stub?.iid}"]`) as Element, 'click');
    board.flush();
    expect(store.get().selectedId).toBe(fieldId);
    // The field itself is on screen, clear of the 400px inspector.
    const field = model.byNode.get(fieldId)?.find((i) => i.islandId === partner?.islandId);
    const I = model.islands.find((x) => x.id === field?.islandId) as BoardIsland;
    const cam = board.camera();
    const left = (I.x + (field?.x ?? 0) - cam.x) * cam.zoom;
    const right = left + (field?.w ?? 0) * cam.zoom;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(1280 - 400);
    // What it flew to is mounted and selected, not dimmed away; the stub it came through stays lit.
    const fieldEl = container.querySelector(`[data-iid="${field?.iid}"]`);
    expect(fieldEl?.classList.contains('amc-sel')).toBe(true);
    expect(fieldEl?.classList.contains('amc-lit')).toBe(true);
    const stubEl = container.querySelector(`[data-iid="${partner?.iid}"]`);
    if (stubEl) expect(stubEl.classList.contains('amc-lit')).toBe(true);
    board.dispose();
  });
});

describe('design review: edges that would pass under another lane', () => {
  it('collapses an action-to-effect hop behind the resources lane until hover or selection', () => {
    const { ctx, store } = makeContext(fixturePort(), { focusModuleApiName: 'Cases' });
    const container = attach();
    const board = createBoard(container, ctx);
    board.flush();
    const cases = board.model().islands.find((I) => I.id === 'Cases') as BoardIsland;
    const hops = cases.edges.filter((e) => {
      const a = cases.byIid.get(e.from);
      const b = cases.byIid.get(e.to);
      return a?.lane === 'actions' && b?.lane === 'effects' && !e.back && !e.hover;
    });
    expect(hops.length).toBeGreaterThan(0);
    for (const e of hops) {
      expect(e.hub, `${e.id} hidden at rest`).toBe(true);
      expect(cases.byIid.get(e.from)?.port).toBe(true);
    }
    // Nothing drawn at rest runs across a populated lane.
    const lanes = ['entry', 'rules', 'actions', 'resources', 'effects'];
    for (const e of cases.edges) {
      if (e.hub || e.hover || e.back || e.kind === 'trigger' || e.kind === 'cascades') continue;
      const gap =
        lanes.indexOf(cases.byIid.get(e.to)?.lane ?? '') -
        lanes.indexOf(cases.byIid.get(e.from)?.lane ?? '');
      expect(gap, `${e.id} spans lanes`).toBeLessThan(2);
    }
    // The links are still one selection away: selecting the action lights its hop.
    const action = cases.byIid.get(hops[0].from);
    store.set({ selectedId: action?.node?.id ?? null });
    board.flush();
    const lit = container.querySelectorAll('.amc-e-litlayer .amc-e-lit');
    expect(lit.length).toBeGreaterThan(0);
    board.dispose();
  });
});

describe('design review: lens connectors for cards out of view', () => {
  it('draws a short faint stub at the edge of the view instead of a rope', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="lens-bar"></div>
      <div class="lens-grid">
        <svg></svg>
        <div data-col="w">
          <div class="wcard" data-tier="declared" id="near"></div>
          <div class="wcard" data-tier="declared" id="far"></div>
        </div>
        <div data-col="f"><div id="am-fcard"></div></div>
        <div data-col="r"></div>
      </div>`;
    document.body.append(host);
    const rect = (top: number, bottom: number, left = 0, right = 100) =>
      ({
        top,
        bottom,
        left,
        right,
        width: right - left,
        height: bottom - top,
        x: left,
        y: top,
      }) as DOMRect;
    // The view shows 0-600px; the second writer sits 2000px down, far past it.
    const boxes = new Map<Element, DOMRect>([
      [host, rect(0, 600, 0, 1000)],
      [host.querySelector('.lens-bar') as Element, rect(0, 40, 0, 1000)],
      [host.querySelector('.lens-grid') as Element, rect(0, 2400, 0, 1000)],
      [host.querySelector('#am-fcard') as Element, rect(200, 400, 400, 600)],
      [host.querySelector('#near') as Element, rect(100, 160, 0, 300)],
      [host.querySelector('#far') as Element, rect(2000, 2060, 0, 300)],
    ]);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return boxes.get(this) ?? rect(0, 0, 0, 0);
    });
    drawEdges(host);
    const paths = [...host.querySelectorAll('.lens-grid svg path.le')];
    expect(paths).toHaveLength(2);
    expect(paths[0].classList.contains('off')).toBe(false);
    expect(paths[1].classList.contains('off')).toBe(true);
    // Both start inside the visible band (the far one clamped to its bottom edge), never at 2,000.
    for (const path of paths) {
      const startY = Number(/^M[\d.]+,([\d.]+)/.exec(path.getAttribute('d') ?? '')?.[1]);
      expect(startY).toBeLessThanOrEqual(600);
      expect(startY).toBeGreaterThanOrEqual(40);
    }
  });
});

describe('design review: duplicate glyphs and chips', () => {
  it('never repeats a writer card title in its path chips', () => {
    const map = mountReal({
      view: 'fields',
      field: { moduleApiName: 'Deals', fieldApiName: 'Stage' },
    });
    const cards = [...map.shadow.querySelectorAll('.lcol[data-col="w"] .wcard')];
    expect(cards.length).toBeGreaterThan(5);
    let withPath = 0;
    for (const card of cards) {
      const title = card.querySelector('.nm')?.textContent;
      const chips = [...card.querySelectorAll('.path .pc')].map((c) => c.textContent);
      if (chips.length) withPath++;
      expect(chips, `path of "${title}"`).not.toContain(title);
    }
    // Rules still say what starts them.
    expect(withPath).toBeGreaterThan(0);
  });

  it('drops the arrow glyph from portal titles: the icon already points', () => {
    const { ctx } = makeContext(fixturePort(), { focusModuleApiName: 'Deals' });
    const board = createBoard(attach(), ctx);
    const portals = [...board.model().byIid.values()].filter((i) => i.portal);
    expect(portals.length).toBeGreaterThan(0);
    for (const p of portals) expect(p.title, p.title).not.toMatch(/[←→]/);
    board.dispose();
  });
});

describe('design review: list chips', () => {
  it('wraps chip text so a long field name ends in an ellipsis instead of clipping', () => {
    const map = mountReal({ view: 'list' });
    const chips = [...map.shadow.querySelectorAll('.lt-row .fchip:not(.more)')];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      // `text-overflow` does not reach text that is a bare flex child: the text sits in its own box.
      const t = [...chip.children].find((c) => c.classList.contains('fchip-t'));
      expect(t?.textContent?.length, chip.outerHTML).toBeGreaterThan(0);
    }
  });
});

describe('design review: coverage popover', () => {
  it('says "none in this org" instead of "0 loaded" under a full bar', () => {
    const map = mountReal();
    (map.q('[data-fk="coverage-pill"]') as HTMLElement).click();
    const rows = [...map.shadow.querySelectorAll('.wf-pop .cov')];
    const lists = rows.filter((r) => /Buttons|Blueprints/.test(r.textContent ?? ''));
    expect(lists.length).toBe(2);
    for (const r of lists) {
      expect(r.textContent).toContain('none in this org');
      expect(r.textContent).not.toContain('0 loaded');
    }
    // A real "re-map" needs a port capability; the store's retry only replays recorded failures,
    // so no button pretends to do it.
    expect(map.q('.wf-pop [data-fk="remap"]')).toBeNull();
  });
});

describe('design review: legend and preview search', () => {
  it('puts a Legend button on the board that explains kinds and links, and Esc closes it', () => {
    const { ctx } = makeContext(fixturePort());
    const container = attach();
    const board = createBoard(container, ctx);
    const button = container.querySelector('.amc-lgbtn') as HTMLButtonElement;
    const legend = container.querySelector('.amc-legend') as HTMLElement;
    expect(button.textContent).toContain('Legend');
    expect(legend.hidden).toBe(true);
    button.click();
    expect(legend.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const text = legend.textContent ?? '';
    for (const label of ['Workflow rule', 'Function', 'Field', 'Declared', 'Inferred from code'])
      expect(text).toContain(label);
    press(container.querySelector('.amc-root') as Element, 'Escape');
    expect(legend.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    board.dispose();
  });

  it('has no legend button in the preview', () => {
    const map = mountReal({}, 'teaser');
    expect(map.q('.amc-lgbtn')).toBeNull();
  });

  it('asks the preview to search only its flow', () => {
    const preview = mountReal({}, 'teaser');
    expect(preview.q<HTMLInputElement>('.am-search input')?.placeholder).toBe(
      'Search the flow in this preview…',
    );
    const full = mountReal();
    expect(full.q<HTMLInputElement>('.am-search input')?.placeholder).toMatch(/and code/);
  });
});

describe('design review: keyboard path past the filter rail', () => {
  it('offers a skip link that lands in the map, before any rail stop', () => {
    const map = mountReal();
    const skip = map.q<HTMLButtonElement>('.am-skip') as HTMLButtonElement;
    expect(skip.textContent).toBe('Skip to the map');
    // It sits between the header and the rail in tab order.
    const all = [...map.shadow.querySelectorAll('.am-head button, .am-skip, .am-rail button')];
    expect(all.indexOf(skip)).toBeGreaterThan(0);
    expect(all.indexOf(skip)).toBeLessThan(all.indexOf(map.q('.am-rail button') as Element));
    skip.focus();
    skip.click();
    expect(map.q('#am-board')?.contains(map.active())).toBe(true);
    map.store().set({ view: 'list' });
    skip.click();
    expect(map.q('#am-list')?.contains(map.active())).toBe(true);
  });

  it('makes each filter group one tab stop that arrows move within', () => {
    const map = mountReal();
    const buttons = [...map.shadow.querySelectorAll<HTMLButtonElement>('.am-rail button')];
    const stops = buttons.filter((b) => b.tabIndex >= 0);
    // Scope, modules, kinds, triggers and flags: a handful, not one per option.
    expect(buttons.length).toBeGreaterThan(30);
    expect(stops.length).toBeLessThanOrEqual(8);
    const toggles = [...map.shadow.querySelectorAll<HTMLButtonElement>('.mrow > .mtoggle')];
    toggles[0].focus();
    toggles[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }),
    );
    expect(map.active()).toBe(toggles[1]);
    expect(toggles[1].tabIndex).toBe(0);
    expect(toggles[0].tabIndex).toBe(-1);
    // Right reaches the row's "show on board", left comes back.
    toggles[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }),
    );
    expect(map.active()?.classList.contains('fly')).toBe(true);
    map
      .active()
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, composed: true }),
      );
    expect(map.active()).toBe(toggles[1]);
  });
});
