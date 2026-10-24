/**
 * Board canvas controller (UX spec §6): pan/zoom world of module islands with semantic zoom,
 * viewport culling, hub collapse, portals, dimming, minimap and keyboard navigation.
 *
 * Render budget: only islands intersecting the viewport have a shell, only nodes intersecting it
 * have a card (none at overview, where a canvas silhouette stands in), and the edge layer holds
 * the focused island's edges plus hover/selection chains. Pan and zoom write one transform; DOM
 * work happens in a single rAF-batched `reconcile`.
 */
import type { AutomationGraph, MapFilters, MapNodeId } from '../../types';
import type { Camera, MapUiContext, MapViewState } from '../context';
import { createCard } from './cards';
import {
  clear,
  cssPx,
  h,
  type IconSprite,
  IconSprite as IconSpriteImpl,
  reducedMotion,
  s,
} from './dom';
import {
  createDefs,
  drawEdge,
  drawTrunk,
  type EdgeMarkers,
  markerIds,
  pathBack,
  pathFwd,
  pathSide,
} from './edges';
import { type FlowLayer, renderFlows } from './flows';
import {
  clamp,
  inflate,
  nextTier,
  type Rect,
  rectsIntersect,
  TITLE_ZONE_H,
  type Tier,
  unionRects,
  ZOOM_MAX,
  ZOOM_MIN,
} from './geometry';
import {
  createIslandShell,
  drawSilhouettes,
  type IslandShell,
  type Palette,
  resolvePalette,
  setMatchBadges,
} from './islands-dom';
import { KIND_ICON, KIND_LABEL } from './kinds';
import { type Anchor, type LayoutHooks, layoutModel, type PackBlock } from './layout';
import { Minimap, type MiniRect } from './minimap';
import {
  type BoardEdge,
  type BoardIsland,
  type BoardItem,
  type BoardModel,
  buildBoardModel,
} from './model';
import { Viewport } from './viewport';
import { computeVisibility, scopeOnlyFilters } from './visibility';

/** Hard ceiling on cards in the DOM (UX spec §18: ≤ 1,500 board nodes at any zoom). */
export const MAX_CARDS = 1500;
const CAMERA_WRITE_MS = 160;
/** Overview <-> cards crossfade; matches `--am-dur-3` in canvas.css. */
const LEAVE_MS = 340;
const CULL_MARGIN_PX = 90;
const INSPECTOR_W = 400;
/** Board DOM nodes the render budget aims for (UX spec §18), and what a mounted island costs. */
const ELEMENT_BUDGET = 1500;
const SHELL_ESTIMATE = 460;
const MIN_CARDS = 150;
/** More than this many resting edges into one node are drawn as a trunk (and only the trunk). */
const TRUNK_MIN = 8;
/** Horizontal run of a trunk in front of its target. */
const TRUNK_RUN = 26;
/** Bottom-left chrome (minimap above the zoom bar) that a fit keeps island content out from under. */
const NOTCH = {
  /** Minimap: 152x103 above the zoom bar. */
  map: { w: 176, h: 176 },
  /** Zoom bar with minimap toggle, tier label and Legend button: wide and short. */
  bar: { w: 364, h: 56 },
};
/** Framing an island never goes below compact tier, so what you fly to is readable. */
const COMPACT_MIN_ZOOM = 0.5;
const COMPACT_ACTION_W = 30;
/** Below this the cards are too small to read: showing a node there means moving in. */
const READABLE_ZOOM = 0.6;

export interface FogHandle {
  /** Fog islands as plain rects: minimap, world bounds. */
  rects: readonly MiniRect[];
  update(view: Rect, zoom: number, tier: Tier): void;
  dispose(): void;
}

/** Teaser hook: everything the fog needs, and nothing it must not see (no graph, no names). */
export interface BoardPlugin {
  /** Locked modules are never named by the real renderer. */
  redact?: { keep: string | null };
  /** Blocks packed alongside the real islands. */
  blocks(): PackBlock[];
  attach(env: {
    layer: HTMLElement;
    anchors: ReadonlyMap<string, Anchor>;
    sprite: IconSprite;
    onUpgrade: () => void;
  }): FogHandle;
  decorateIsland?(el: HTMLElement, island: BoardIsland, sprite: IconSprite): void;
  /** Layout hooks: grow the revealed island for its fog, rank it by its real size. */
  layout?: LayoutHooks;
  /** One line about the fog's quiet modules (a count), shown as a small chip in the corner. */
  note?(): string | null;
  /** Teaser arrival: after the board opens at fit-all, fly to the top-left of this rect. */
  arrival?(islands: readonly BoardIsland[]): { rect: Rect; zoom: number; delayMs: number } | null;
  /** Module flows and the legend are Pro-only. */
  flows: boolean;
}

export interface BoardStats {
  cards: number;
  islands: number;
  mountedIslands: number;
  edges: number;
  /** Every element under the board root. */
  elements: number;
  layoutMs: number;
  items: number;
}

export interface BoardController {
  dispose(): void;
  /** Re-read the port snapshot and view filters (progressive loading, refresh). */
  refresh(): void;
  /** Run pending frame work now (tests; the app relies on rAF). */
  flush(): void;
  camera(): Camera;
  setCamera(c: Camera): void;
  tier(): Tier;
  model(): BoardModel;
  stats(): BoardStats;
  flyToIsland(id: string, animate?: boolean): void;
  fitAll(animate?: boolean): void;
  root: HTMLElement;
}

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const sameCamera = (a: Camera, b: Camera) =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.zoom - b.zoom) < 0.0005;

const defaultDepth = (kind: string | undefined) =>
  kind === 'field' ? { upstream: 3, downstream: 2 } : { upstream: 2, downstream: 3 };

interface EdgeGeo {
  d: string;
  route: 'fwd' | 'side' | 'back';
  from: { x: number; y: number };
  to: { x: number; y: number };
  badge: { x: number; y: number };
  mid: number;
  box: Rect;
}

interface IslandIndex {
  out: Map<string, BoardEdge[]>;
  in: Map<string, BoardEdge[]>;
}

class Board implements BoardController {
  readonly root = h('div', 'amc-root');
  private readonly canvas = h('div', 'amc-canvas amc-tier-detail', {
    role: 'group',
    'aria-roledescription': 'automation map',
    'aria-label': 'Automation map board',
    tabindex: '0',
    'data-focus-target': 'canvas',
  });
  private readonly world = h('div', 'amc-world');
  private readonly flowsSvg = s('svg', { width: 1, height: 1 }, 'amc-svg amc-flows');
  private readonly fogLayer = h('div', 'amc-layer amc-fog-layer');
  private readonly islandLayer = h('div', 'amc-layer amc-islands');
  private readonly edgesSvg = s('svg', { width: 1, height: 1 }, 'amc-svg amc-edges');
  private readonly localEdges = s('g', undefined, 'amc-e-local');
  private readonly litEdges = s('g', undefined, 'amc-e-litlayer');
  private readonly nodeLayer = h('div', 'amc-layer amc-nodes');
  private readonly tip = h('div', 'amc-tip');
  private readonly flowCard = h('div', 'amc-flowcard');
  private readonly legend = h('div', 'amc-legend', {
    role: 'dialog',
    'aria-label': 'Map legend',
    id: 'amc-legend',
  });
  private legendButton: HTMLButtonElement | null = null;
  private readonly live = h('div', 'amc-sr', { 'aria-live': 'polite', 'aria-atomic': 'true' });
  private miniWas: boolean | null = null;
  private readonly pct = h('span', 'amc-pct', null, '100%');
  private readonly tierLabel = h('span', 'amc-tierlbl', null, 'Detail');
  private readonly empty = h('div', 'amc-empty');
  private readonly sprite = new IconSpriteImpl();
  private readonly markers: EdgeMarkers = markerIds(this.sprite);
  private readonly minimap: Minimap;
  private readonly vp: Viewport;
  private readonly palette: Palette;
  private readonly cleanups: Array<() => void> = [];

  private snapshotGraph: AutomationGraph | null = null;
  private mdl: BoardModel = {
    islands: [],
    byIid: new Map(),
    byNode: new Map(),
    hubThreshold: 8,
    flows: [],
  };
  private anchors: ReadonlyMap<string, Anchor> = new Map();
  private baseKey: { graph: AutomationGraph; scope: string } | null = null;
  private baseAnchors: ReadonlyMap<string, Anchor> | null = null;
  private fog: FogHandle | null = null;
  private bounds: Rect = { x: 0, y: 0, w: 1, h: 1 };
  /** World y of the topmost island (a button zoom keeps its title row below the banner). */
  private contentTop: number | null = null;
  private version = 0;
  private layoutMs = 0;
  private currentTier: Tier | null = null;
  private cardTier: Tier | null = null;
  private shells = new Map<string, IslandShell>();
  private cards = new Map<string, HTMLElement>();
  private indexes = new Map<string, IslandIndex>();
  private flowLayer: FlowLayer | null = null;
  private flowsVersion = -1;

  private focusedIsland: string | null = null;
  private edgeKey = '';
  private edgeCull: Rect | null = null;
  private edgeCount = 0;
  private selIids = new Set<string>();
  private litIids = new Set<string>();
  private litEdgeIds = new Set<string>();
  private localSel: string | null = null;
  /** The stub a portal jump flew from stays lit while its field is selected. */
  private litExtra = new Set<string>();
  /** Card to flash once it exists (the fly-to mounts it a frame later). */
  private pendingFlash: string | null = null;
  private hoverIids: string[] = [];
  private matchNodeIds: ReadonlySet<MapNodeId> | null = null;
  private matchIids = new Set<string>();
  private focusIid: string | null = null;

  private rafId = 0;
  private leaveCardsTimer = 0;
  private leaveFlowsTimer = 0;
  private cameraTimer = 0;
  private lastWritten: Camera | null = null;
  private userMoved = false;
  private autoFit = false;
  /**
   * The minimap sits in the bottom-left corner with the zoom bar. In `auto` it shows while the
   * board is zoomed out far enough to orient you, and steps aside once the cards are readable,
   * where it would only cover them; the toggle in the zoom bar overrides that.
   */
  private miniMode: 'auto' | 'shown' | 'hidden' = 'auto';
  private miniButton: HTMLButtonElement | null = null;
  private zoomBar: HTMLElement | null = null;
  private framed = false;
  /**
   * A landing the graph could not satisfy yet ("Show on map" opens before the rule list has
   * loaded): frame it the moment the node, or its island, exists.
   */
  private pendingFrame: { nodeId: MapNodeId | null; island: string | null } | null = null;
  private ownSelection: MapNodeId | null | undefined;
  private arrivalTimer = 0;
  private disposed = false;

  constructor(
    container: HTMLElement,
    private readonly ctx: MapUiContext,
    private readonly plugin?: BoardPlugin,
  ) {
    const { view } = ctx;
    this.palette = resolvePalette(container);
    this.edgesSvg.append(createDefs(this.markers), this.localEdges, this.litEdges);
    this.world.append(
      this.flowsSvg,
      this.fogLayer,
      this.islandLayer,
      this.edgesSvg,
      this.nodeLayer,
    );
    this.canvas.append(this.world);
    this.tip.hidden = true;
    this.flowCard.hidden = true;
    this.legend.hidden = true;
    this.empty.hidden = true;
    if (plugin) this.canvas.classList.add('amc-teaser');

    const skip = h('a', 'amc-sr amc-skip', { href: '#' }, 'Skip to list view');
    skip.addEventListener('click', (e) => {
      e.preventDefault();
      view.set({ view: 'list' });
    });

    this.vp = new Viewport(this.canvas, this.world, {
      // The fog is a continuous haze: a dot grid showing through it reads as a texture glitch.
      grid: !plugin,
      onChange: () => this.scheduleReconcile(),
      // The shell publishes the live inspector width and the banner height as CSS variables.
      safeRight: () =>
        view.get().inspectorOpen ? cssPx(this.canvas, '--am-insp-w') || INSPECTOR_W : 0,
      safeTop: () => cssPx(this.canvas, '--am-safe-top') ?? 0,
      avoid: () => this.notchRects(this.vp.z),
      contentTop: () => this.contentTop,
      isInteractive: (el) =>
        !!el.closest('.amc-nd, .amc-head, .amc-sum, .amc-ttl, .amc-fog-hit, button, .amc-chrome'),
      onUserMove: () => {
        this.userMoved = true;
        window.clearTimeout(this.arrivalTimer);
      },
    });
    this.minimap = new Minimap((wx, wy) => {
      this.userMoved = true;
      this.vp.centerOn(wx, wy, this.vp.z, false);
    });

    const quietNote = plugin?.note?.();
    this.root.append(
      skip,
      this.canvas,
      this.buildZoom(),
      this.minimap.el,
      ...(quietNote ? [h('div', 'amc-chrome amc-quiet', null, quietNote)] : []),
      this.tip,
      this.flowCard,
      this.legend,
      this.empty,
      this.live,
      this.sprite.el,
    );
    container.append(this.root);

    this.bindEvents();
    // The shell's chrome (gap banner) changed size: an automatic frame follows it.
    const onInsets = () => this.onResize();
    container.addEventListener('am:insets', onInsets);
    this.cleanups.push(() => container.removeEventListener('am:insets', onInsets));
    this.cleanups.push(view.subscribe((next, prev) => this.onViewState(next, prev)));
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => this.onResize());
      ro.observe(container);
      this.cleanups.push(() => ro.disconnect());
    }
    this.rebuild(false);
    this.initialFrame();
    this.reconcile();
  }

  /* ------------------------------------------------------------------ build */

  private rebuild(reconcile = true) {
    const t0 = performance.now();
    const snapshot = this.ctx.port.snapshot();
    const graph = snapshot.graph;
    const filters = this.ctx.view.get().filters;
    this.snapshotGraph = graph;
    const vis = computeVisibility(graph, filters);
    const options = {
      includeLoose: filters.scope === 'everything' && !this.plugin,
      redact: this.plugin?.redact,
    };
    const model = buildBoardModel(graph, vis, options);
    const extra = this.plugin?.blocks() ?? [];
    const unfiltered =
      !filters.modules.size &&
      !filters.kinds.size &&
      !filters.triggerTypes.size &&
      !filters.flags.size;
    if (unfiltered || this.plugin) {
      this.anchors = layoutModel(model, undefined, extra, this.plugin?.layout);
      this.baseKey = { graph, scope: filters.scope };
      this.baseAnchors = this.anchors;
    } else {
      if (
        !this.baseAnchors ||
        this.baseKey?.graph !== graph ||
        this.baseKey.scope !== filters.scope
      ) {
        const baseModel = buildBoardModel(
          graph,
          computeVisibility(graph, scopeOnlyFilters(filters)),
          options,
        );
        this.baseAnchors = layoutModel(baseModel, undefined, extra);
        this.baseKey = { graph, scope: filters.scope };
      }
      this.anchors = layoutModel(model, this.baseAnchors);
    }
    this.mdl = model;
    this.layoutMs = performance.now() - t0;
    this.version++;
    this.indexes.clear();

    // New model: every shell, card and edge is stale.
    this.disposeFog();
    for (const shell of this.shells.values()) shell.el.remove();
    this.shells.clear();
    for (const el of this.cards.values()) el.remove();
    this.cards.clear();
    this.edgeKey = '';
    this.edgeCull = null;
    this.focusedIsland = null;
    clear(this.localEdges);
    clear(this.litEdges);
    if (this.plugin) {
      this.fog = this.plugin.attach({
        layer: this.fogLayer,
        anchors: this.anchors,
        sprite: this.sprite,
        onUpgrade: () => this.ctx.port.requestUpgrade(),
      });
    }
    const rects: Rect[] = [...(this.fog?.rects ?? [])];
    this.bounds = this.worldBounds(rects);
    this.contentTop = this.mdl.islands.length
      ? Math.min(...this.mdl.islands.map((I) => I.y))
      : null;
    this.updateMatches();
    this.updateSelection();
    this.updateEmptyState(snapshot.phase, filters);
    this.flowsVersion = -1;
    if (reconcile) this.reconcile();
  }

  private worldBounds(extra: readonly Rect[]): Rect {
    const rects: Rect[] = [
      ...this.mdl.islands.map((I) => ({
        x: I.x,
        y: I.y - TITLE_ZONE_H,
        w: I.w,
        h: I.h + TITLE_ZONE_H,
      })),
      ...extra.map((r) => ({
        x: r.x,
        y: r.y - TITLE_ZONE_H / 2,
        w: r.w,
        h: r.h + TITLE_ZONE_H / 2,
      })),
    ];
    return rects.length ? unionRects(rects) : { x: 0, y: 0, w: 1200, h: 800 };
  }

  private updateEmptyState(phase: string, filters: MapFilters) {
    const none = this.mdl.islands.length === 0 && !(this.fog?.rects.length ?? 0);
    this.empty.hidden = !none;
    if (!none) return;
    clear(this.empty);
    const filtered = !!(
      filters.modules.size ||
      filters.kinds.size ||
      filters.triggerTypes.size ||
      filters.flags.size
    );
    if (phase === 'loading' || phase === 'idle') {
      this.empty.append(
        h('h3', null, null, 'Mapping your automation…'),
        h('p', null, null, 'Rules appear here as they load.'),
      );
    } else if (filtered) {
      this.empty.append(h('h3', null, null, 'Nothing matches these filters'));
      const btn = h('button', 'amc-btn', { type: 'button' }, 'Clear filters');
      btn.style.pointerEvents = 'auto';
      btn.addEventListener('click', () =>
        this.ctx.view.set({
          filters: {
            scope: filters.scope,
            modules: new Set(),
            kinds: new Set(),
            triggerTypes: new Set(),
            flags: new Set(),
          },
        }),
      );
      this.empty.append(btn);
    } else {
      this.empty.append(
        h('h3', null, null, 'No automation yet'),
        h(
          'p',
          null,
          null,
          'This org has no workflow rules, buttons, schedules or API functions to map.',
        ),
      );
    }
  }

  private disposeFog() {
    this.fog?.dispose();
    this.fog = null;
    clear(this.fogLayer);
  }

  /** Camera on first display: explicit camera, else the focused island, else everything. */
  private initialFrame() {
    const state = this.ctx.view.get();
    const cam = state.camera;
    const focus = state.focusModuleApiName;
    const island = focus ? this.mdl.islands.find((I) => I.id === focus) : null;
    const explicitCamera = !!cam && !(cam.x === 0 && cam.y === 0 && cam.zoom === 1);
    if (island) this.flyToIsland(island.id, false);
    else if (explicitCamera) this.vp.setCamera(cam);
    else {
      this.fitAll(false);
      // Still the automatic frame: keep fitting as the map grows and the window resizes.
      this.autoFit = true;
    }
    // Landing with a selection ("Show on map"): bring it into view, at readable zoom.
    if (state.selectedId && this.mdl.byNode.has(state.selectedId)) {
      const before = this.vp.camera();
      // A restored camera that already shows the node is left alone; an automatic one is not.
      if (this.autoFit) {
        this.focusNode(state.selectedId, false);
        this.pendingFlash = this.mdl.byNode.get(state.selectedId)?.[0]?.iid ?? null;
      } else this.focusNodeIfOffscreen(state.selectedId);
      if (!sameCamera(before, this.vp.camera())) this.autoFit = false;
    }
    // Whatever the graph cannot show yet is framed when it arrives, unless a camera was given.
    const waitNode =
      state.selectedId && !this.mdl.byNode.has(state.selectedId) ? state.selectedId : null;
    const waitIsland = focus && !island ? focus : null;
    if ((waitNode || waitIsland) && !explicitCamera && !this.plugin)
      this.pendingFrame = { nodeId: waitNode, island: waitIsland };
    this.framed = true;
    this.lastWritten = this.vp.camera();
    const arrival = this.plugin?.arrival?.(this.mdl.islands);
    if (arrival && !island) {
      this.arrivalTimer = window.setTimeout(
        () => {
          if (this.userMoved || this.disposed) return;
          const z = arrival.zoom;
          this.vp.flyTo({ x: 48 - arrival.rect.x * z, y: 72 - arrival.rect.y * z, z }, true);
        },
        reducedMotion() ? 0 : arrival.delayMs,
      );
    }
  }

  /**
   * Frames the landing target once the graph has it. Returns true when the camera moved, so the
   * caller does not also refit the whole map over it. Dropped as soon as the user takes the
   * camera, selects something else or moves to another island, and when loading ends without it.
   */
  private applyPendingFrame(): boolean {
    const wait = this.pendingFrame;
    if (!wait) return false;
    const state = this.ctx.view.get();
    if (this.userMoved) {
      this.pendingFrame = null;
      return false;
    }
    if (wait.nodeId && state.selectedId !== wait.nodeId) wait.nodeId = null;
    if (wait.island && state.focusModuleApiName !== wait.island) wait.island = null;
    let moved = false;
    if (wait.island && this.mdl.islands.some((I) => I.id === wait.island)) {
      this.flyToIsland(wait.island, false);
      wait.island = null;
      moved = true;
    }
    const items = wait.nodeId ? this.mdl.byNode.get(wait.nodeId) : undefined;
    if (wait.nodeId && items?.length) {
      this.focusNode(wait.nodeId, false);
      this.pendingFlash = items[0].iid;
      wait.nodeId = null;
      moved = true;
    }
    if (moved) {
      this.autoFit = false;
      this.updateSelection();
      this.applyStates();
    }
    const phase = this.ctx.port.snapshot().phase;
    if ((!wait.nodeId && !wait.island) || phase === 'complete' || phase === 'failed')
      this.pendingFrame = null;
    return moved;
  }

  private onResize() {
    if (this.disposed) return;
    if (this.autoFit && !this.userMoved) this.fitAll(false);
    this.scheduleReconcile();
  }

  /* -------------------------------------------------------------- reconcile */

  private scheduleReconcile() {
    if (this.rafId || this.disposed) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.reconcile();
    });
  }

  flush() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.reconcile();
    if (this.cameraTimer) {
      window.clearTimeout(this.cameraTimer);
      this.cameraTimer = 0;
      this.writeCamera();
    }
  }

  private reconcile() {
    if (this.disposed) return;
    const z = this.vp.z;
    const tier = nextTier(z, this.currentTier);
    if (tier !== this.currentTier) this.setTier(tier);
    const view = this.vp.view();
    const cull = inflate(view, CULL_MARGIN_PX / z);

    for (const I of this.mdl.islands) {
      const outer: Rect = { x: I.x, y: I.y - TITLE_ZONE_H, w: I.w, h: I.h + TITLE_ZONE_H };
      const shell = this.shells.get(I.id);
      if (rectsIntersect(outer, cull)) {
        if (!shell) this.mountShell(I);
      } else if (shell) {
        this.unmountShell(I.id);
      }
    }

    if (tier === 'overview') {
      this.leaveCards();
      for (const shell of this.shells.values()) drawSilhouettes(shell, this.palette);
      this.syncFlows(z);
    } else {
      this.cancelLeave();
      this.syncCards(view, cull);
      if (this.pendingFlash) {
        const el = this.cards.get(this.pendingFlash);
        if (el) {
          this.flash(el);
          this.pendingFlash = null;
        }
      }
      // The module flows are an overview-only layer: leaving them in the DOM costs ~50 elements.
      this.leaveFlows();
    }
    this.fog?.update(view, z, tier);
    this.refreshEdges(view);
    this.syncPct();
    this.syncMinimap();
    this.drawMinimap(view);
    this.scheduleCameraWrite();
  }

  /**
   * Cards and flow curves outlive a tier change by the crossfade (their layers fade out over
   * LEAVE_MS under CSS), then go: the DOM stays inside its budget while the swap reads as one
   * soft dissolve instead of a cut.
   */
  private leaveCards() {
    if (!this.cards.size || this.leaveCardsTimer) return;
    if (reducedMotion()) {
      this.removeCards(() => true);
      return;
    }
    this.leaveCardsTimer = window.setTimeout(() => {
      this.leaveCardsTimer = 0;
      if (this.currentTier === 'overview') this.removeCards(() => true);
    }, LEAVE_MS);
  }

  private leaveFlows() {
    if (!this.flowLayer || this.leaveFlowsTimer) return;
    const drop = () => {
      this.leaveFlowsTimer = 0;
      if (this.currentTier === 'overview' || !this.flowLayer) return;
      clear(this.flowsSvg);
      this.flowLayer = null;
      this.flowsVersion = -1;
    };
    if (reducedMotion()) drop();
    else this.leaveFlowsTimer = window.setTimeout(drop, LEAVE_MS);
  }

  private cancelLeave() {
    window.clearTimeout(this.leaveCardsTimer);
    this.leaveCardsTimer = 0;
  }

  /** The percentage shows where a gliding button zoom is headed, so repeated presses read true. */
  private syncPct() {
    const text = `${Math.round(this.vp.goalZoom() * 100)}%`;
    if (this.pct.textContent !== text) this.pct.textContent = text;
  }

  private setTier(tier: Tier) {
    this.currentTier = tier;
    this.flowCard.hidden = true;
    this.canvas.classList.remove('amc-tier-overview', 'amc-tier-compact', 'amc-tier-detail');
    this.canvas.classList.add(`amc-tier-${tier}`);
    this.tierLabel.textContent = { overview: 'Overview', compact: 'Compact', detail: 'Detail' }[
      tier
    ];
    // Compact cards are a lighter variant (and action chips are narrower, which moves edge
    // anchors), so cards and edges are rebuilt when crossing between the two card tiers.
    if (tier !== 'overview' && this.cardTier !== tier) {
      this.removeCards(() => true);
      this.cardTier = tier;
    }
    this.edgeKey = '';
  }

  private mountShell(I: BoardIsland) {
    const shell = createIslandShell(I, {
      sprite: this.sprite,
      decorate: (el, island) => this.plugin?.decorateIsland?.(el, island, this.sprite),
    });
    this.shells.set(I.id, shell);
    this.islandLayer.append(shell.el);
    const flyTo = () => this.flyToIsland(I.id);
    shell.el.querySelector('.amc-head')?.addEventListener('click', flyTo);
    shell.el.querySelector('.amc-ttl')?.addEventListener('click', flyTo);
    shell.el.querySelector('.amc-sum')?.addEventListener('click', flyTo);
    for (const target of [shell.el.querySelector('.amc-sum'), shell.el.querySelector('.amc-ttl')]) {
      target?.addEventListener('pointerenter', () => this.highlightFlows(I.id, true, shell.el));
      target?.addEventListener('pointerleave', () => this.highlightFlows(I.id, false, shell.el));
    }
    setMatchBadges(shell, this.matchNodeIds ? this.matchCount(I) : null);
    this.canvas.classList.toggle('amc-searching', !!this.matchNodeIds);
  }

  private unmountShell(id: string) {
    const shell = this.shells.get(id);
    if (!shell) return;
    shell.el.remove();
    this.shells.delete(id);
    this.flowCard.hidden = true;
    this.removeCards((iid) => iid.startsWith(`${id}|`));
  }

  private removeCards(pred: (iid: string) => boolean) {
    for (const [iid, el] of this.cards) {
      if (!pred(iid)) continue;
      el.remove();
      this.cards.delete(iid);
    }
  }

  private syncCards(view: Rect, cull: Rect) {
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    const wanted: Array<{ item: BoardItem; d: number }> = [];
    for (const I of this.mdl.islands) {
      if (!this.shells.has(I.id)) continue;
      for (const item of I.items) {
        const r: Rect = { x: I.x + item.x, y: I.y + item.y, w: item.w, h: item.h };
        if (!rectsIntersect(r, cull)) continue;
        wanted.push({ item, d: (r.x + r.w / 2 - cx) ** 2 + (r.y + r.h / 2 - cy) ** 2 });
      }
    }
    let list = wanted;
    // Render budget (UX spec §18: ~1,500 DOM nodes): a card costs ~5 elements, so the cap follows
    // the edges already drawn. The nearest to the view centre win; a floor keeps the screen full.
    const budget = clamp(
      Math.floor((ELEMENT_BUDGET - SHELL_ESTIMATE - this.edgeCount * 1.1) / 5.2),
      MIN_CARDS,
      MAX_CARDS,
    );
    if (list.length > budget) {
      list = [...list].sort((a, b) => a.d - b.d).slice(0, budget);
    }
    const keep = new Set(list.map((w) => w.item.iid));
    // The keyboard cursor and selection stay mounted even if just off-screen.
    if (this.focusIid) keep.add(this.focusIid);
    for (const [iid, el] of this.cards) {
      if (keep.has(iid)) continue;
      el.remove();
      this.cards.delete(iid);
    }
    const frag = document.createDocumentFragment();
    for (const iid of keep) {
      if (this.cards.has(iid)) continue;
      const item = this.mdl.byIid.get(iid);
      if (!item) continue;
      const I = this.mdl.islands.find((x) => x.id === item.islandId);
      if (!I || !this.shells.has(I.id)) continue;
      const compact = this.currentTier === 'compact';
      const el = createCard(item, {
        sprite: this.sprite,
        moduleLabel: I.org ? null : I.label,
        x: I.x + item.x,
        y: I.y + item.y,
        w: compact && item.kind === 'action' ? COMPACT_ACTION_W : item.w,
        h: item.h,
        compact,
      });
      this.styleCard(el, iid);
      this.cards.set(iid, el);
      frag.append(el);
    }
    this.nodeLayer.append(frag);
  }

  private styleCard(el: HTMLElement, iid: string) {
    el.classList.toggle('amc-sel', this.selIids.has(iid));
    el.classList.toggle('amc-lit', this.litIids.has(iid));
    el.classList.toggle('amc-match', this.matchIids.has(iid));
    if (this.hoverIids.length) el.classList.toggle('amc-hv-dim', this.isHoverDimmed(iid));
    if (iid === this.focusIid) el.tabIndex = 0;
  }

  /* ----------------------------------------------------------------- flows */

  private syncFlows(z: number) {
    if (!this.plugin?.flows && this.plugin) return;
    const stale =
      this.flowsVersion !== this.version ||
      !this.flowLayer ||
      Math.abs(Math.log(z / this.flowLayer.builtZoom)) > 0.35;
    if (!stale) return;
    this.flowLayer = renderFlows(this.flowsSvg, this.mdl, z);
    this.flowsVersion = this.version;
  }

  private highlightFlows(id: string, on: boolean, anchor: HTMLElement) {
    for (const el of this.flowLayer?.byIsland.get(id) ?? []) el.classList.toggle('amc-on', on);
    this.showFlowCard(on ? id : null, anchor);
  }

  /** One card for the hovered island: where it writes to and where it is written from. */
  private showFlowCard(id: string | null, anchor: HTMLElement) {
    this.flowCard.hidden = true;
    if (!id || this.currentTier !== 'overview' || (this.plugin && !this.plugin.flows)) return;
    const I = this.mdl.islands.find((x) => x.id === id);
    const label = (islandId: string) =>
      this.mdl.islands.find((x) => x.id === islandId)?.label ?? islandId;
    const to = this.mdl.flows.filter((f) => f.from === id);
    const from = this.mdl.flows.filter((f) => f.to === id);
    if (!I || (!to.length && !from.length)) return;
    clear(this.flowCard);
    this.flowCard.append(h('b', null, null, I.label));
    const section = (title: string, rows: Array<{ other: string; count: number }>) => {
      if (!rows.length) return;
      this.flowCard.append(h('h6', null, null, title));
      for (const r of rows) {
        const row = h('div', 'amc-fr');
        row.append(
          h('span', null, null, label(r.other)),
          h('span', null, null, `${r.count} write${r.count === 1 ? '' : 's'}`),
        );
        this.flowCard.append(row);
      }
    };
    section(
      'Writes into',
      to.map((f) => ({ other: f.to, count: f.count })),
    );
    section(
      'Written from',
      from.map((f) => ({ other: f.from, count: f.count })),
    );
    if (to.some((f) => from.some((g) => g.from === f.to)))
      this.flowCard.append(h('div', 'amc-loopnote', null, '↻ Some of these write both ways.'));
    this.flowCard.hidden = false;
    const r = anchor.getBoundingClientRect();
    const c = this.canvas.getBoundingClientRect();
    const w = this.flowCard.offsetWidth || 256;
    const height = this.flowCard.offsetHeight || 120;
    let left = r.right - c.left + 12;
    if (left + w > c.width - 8) left = r.left - c.left - w - 12;
    this.flowCard.style.left = `${clamp(left, 8, Math.max(8, c.width - w - 8))}px`;
    this.flowCard.style.top = `${clamp(r.top - c.top, 8, Math.max(8, c.height - height - 8))}px`;
  }

  /* ----------------------------------------------------------------- edges */

  private indexOf(I: BoardIsland): IslandIndex {
    let idx = this.indexes.get(I.id);
    if (idx) return idx;
    idx = { out: new Map(), in: new Map() };
    for (const e of I.edges) {
      const o = idx.out.get(e.from);
      if (o) o.push(e);
      else idx.out.set(e.from, [e]);
      const i = idx.in.get(e.to);
      if (i) i.push(e);
      else idx.in.set(e.to, [e]);
    }
    this.indexes.set(I.id, idx);
    return idx;
  }

  private islandOfIid(iid: string): BoardIsland | undefined {
    const item = this.mdl.byIid.get(iid);
    return item ? this.mdl.islands.find((I) => I.id === item.islandId) : undefined;
  }

  /**
   * The island the viewer is looking at: the one nearest the viewport centre (0 when the centre
   * is inside it). Hysteresis keeps the current island until another is clearly nearer.
   */
  private chooseFocused(view: Rect): string | null {
    if (this.currentTier === 'overview') return null;
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    let best: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    let currentDist = Number.POSITIVE_INFINITY;
    for (const I of this.mdl.islands) {
      if (!rectsIntersect(I, view)) continue;
      const dx = Math.max(I.x - cx, 0, cx - (I.x + I.w));
      const dy = Math.max(I.y - cy, 0, cy - (I.y + I.h));
      const dist = Math.hypot(dx, dy);
      if (I.id === this.focusedIsland) currentDist = dist;
      if (dist < bestDist) {
        best = I.id;
        bestDist = dist;
      }
    }
    return Number.isFinite(currentDist) && currentDist <= bestDist + view.h * 0.08
      ? this.focusedIsland
      : best;
  }

  private rightX(I: BoardIsland, item: BoardItem): number {
    return (
      I.x +
      item.x +
      (this.currentTier === 'compact' && item.kind === 'action' ? COMPACT_ACTION_W : item.w)
    );
  }

  private edgePath(I: BoardIsland, e: BoardEdge): EdgeGeo | null {
    const a = I.byIid.get(e.from);
    const b = I.byIid.get(e.to);
    if (!a || !b) return null;
    const ay = I.y + a.y + a.h / 2;
    const by = I.y + b.y + b.h / 2;
    const bx = I.x + b.x;
    const ax = this.rightX(I, a);
    let d: string;
    let bottom = Math.max(ay, by);
    let route: EdgeGeo['route'] = 'fwd';
    if (e.back) {
      d = pathBack(ax, ay, bx, by, I.y + I.h - 12);
      bottom = I.y + I.h;
      route = 'back';
    } else if (b.x <= a.x) {
      d = pathSide(ax, ay, this.rightX(I, b), by);
      route = 'side';
    } else d = pathFwd(ax, ay, bx, by);
    const x0 = Math.min(ax, bx) - 60;
    const y0 = Math.min(ay, by);
    return {
      d,
      route,
      from: { x: ax, y: ay },
      to: { x: bx, y: by },
      badge: { x: bx - 22, y: by - 6 },
      mid: (ax + bx) / 2,
      box: { x: x0, y: y0, w: Math.max(ax, bx) + 60 - x0, h: bottom - y0 },
    };
  }

  /**
   * Resting edges: the focused island's, limited to what is near the viewport. They are rebuilt
   * when the focus or tier changes, or when the view leaves the region they were built for.
   */
  private refreshEdges(view: Rect) {
    const focused = this.chooseFocused(view);
    const key = `${focused}|${this.currentTier}|${this.version}`;
    const covered =
      this.edgeCull !== null &&
      view.x >= this.edgeCull.x &&
      view.y >= this.edgeCull.y &&
      view.x + view.w <= this.edgeCull.x + this.edgeCull.w &&
      view.y + view.h <= this.edgeCull.y + this.edgeCull.h;
    if (key === this.edgeKey && covered) return;
    this.edgeKey = key;
    this.focusedIsland = focused;
    this.edgeCull = inflate(view, Math.max(view.w, view.h) * 0.25);
    clear(this.localEdges);
    this.edgeCount = 0;
    const I = focused ? this.mdl.islands.find((x) => x.id === focused) : undefined;
    if (I && this.currentTier !== 'overview') {
      const drawn: Array<{ e: BoardEdge; geo: EdgeGeo }> = [];
      for (const e of I.edges) {
        if (e.hover || e.hub) continue;
        const geo = this.edgePath(I, e);
        if (!geo || !rectsIntersect(geo.box, this.edgeCull)) continue;
        drawn.push({ e, geo });
      }
      const trunked = this.drawTrunks(I, drawn);
      for (const { e, geo } of drawn) {
        if (trunked.has(e.id)) continue;
        drawEdge(this.localEdges, geo.d, e, this.markers, '', geo.badge);
        this.edgeCount++;
        if (e.loop) {
          const t = s(
            'text',
            { x: geo.mid, y: I.y + I.h - 18, 'text-anchor': 'middle' },
            'amc-elabel',
          );
          t.textContent = '↻ possible loop';
          this.localEdges.append(t);
        }
      }
    }
    this.drawLit();
  }

  /**
   * More than TRUNK_MIN forward edges into one node (fifty writers into one field) become one
   * trunk: the sources curve into a shared point and a single edge carries on. Returns the edges
   * it replaced. Selection and hover still draw the individual edges (`drawLit`).
   */
  private drawTrunks(I: BoardIsland, drawn: Array<{ e: BoardEdge; geo: EdgeGeo }>): Set<string> {
    const replaced = new Set<string>();
    const byTarget = new Map<string, Array<{ e: BoardEdge; geo: EdgeGeo }>>();
    for (const item of drawn) {
      const { e, geo } = item;
      if (geo.route !== 'fwd' || e.kind === 'cascades' || e.evidence === 'unresolved') continue;
      const list = byTarget.get(e.to);
      if (list) list.push(item);
      else byTarget.set(e.to, [item]);
    }
    for (const [to, list] of byTarget) {
      if (list.length <= TRUNK_MIN) continue;
      const target = I.byIid.get(to);
      if (!target) continue;
      const bx = I.x + target.x;
      const by = I.y + target.y + target.h / 2;
      const mergeX = bx - TRUNK_RUN;
      const sources = list.filter(({ geo }) => geo.from.x + 10 < mergeX);
      if (sources.length <= TRUNK_MIN) continue;
      const declared = sources.find(({ e }) => e.evidence === 'declared');
      const lead = declared ?? sources[0];
      drawTrunk(
        this.localEdges,
        { from: { x: mergeX, y: by }, to: { x: bx, y: by } },
        sources.map(({ e, geo }) => ({
          d: pathFwd(geo.from.x, geo.from.y, mergeX, by),
          evidence: e.evidence,
        })),
        lead.e,
        this.markers,
        sources.length,
      );
      this.edgeCount++;
      for (const { e } of sources) replaced.add(e.id);
    }
    return replaced;
  }

  /** Accent edges for the selection chain and for the hovered node's own links. */
  private drawLit() {
    clear(this.litEdges);
    if (this.currentTier === 'overview') return;
    const drawn = new Set<string>();
    const draw = (I: BoardIsland, e: BoardEdge) => {
      if (drawn.has(e.id)) return;
      drawn.add(e.id);
      const geo = this.edgePath(I, e);
      if (!geo) return;
      // A wide faint underlay gives the lit chain its glow without a thick hard stroke.
      if (e.evidence !== 'unresolved' || e.kind === 'cascades')
        this.litEdges.append(
          s('path', { d: geo.d }, `amc-e amc-e-glow${e.kind === 'cascades' ? ' amc-e-casc' : ''}`),
        );
      const els = drawEdge(this.litEdges, geo.d, e, this.markers, 'amc-e-lit', geo.badge);
      for (const el of els) {
        if (el.getAttribute('marker-end') === `url(#${this.markers.arrow})`)
          el.setAttribute('marker-end', `url(#${this.markers.arrowHl})`);
      }
    };
    for (const I of this.mdl.islands) {
      if (!this.litEdgeIds.size) break;
      for (const e of I.edges) if (this.litEdgeIds.has(`${I.id}|${e.id}`)) draw(I, e);
    }
    for (const iid of this.hoverIids) {
      const I = this.islandOfIid(iid);
      if (!I) continue;
      const idx = this.indexOf(I);
      for (const e of idx.out.get(iid) ?? []) draw(I, e);
      for (const e of idx.in.get(iid) ?? []) draw(I, e);
      const item = this.mdl.byIid.get(iid);
      if (item?.portal) this.drawPortalGhost(item);
    }
  }

  private drawPortalGhost(item: BoardItem) {
    const partner = item.portal?.partnerIid ? this.mdl.byIid.get(item.portal.partnerIid) : null;
    if (!partner) return;
    const A = this.islandOfIid(item.iid);
    const B = this.islandOfIid(partner.iid);
    if (!A || !B) return;
    const out = item.portal?.dir === 'out';
    const x1 = A.x + item.x + (out ? item.w : 0);
    const y1 = A.y + item.y + item.h / 2;
    const x2 = B.x + partner.x + (out ? 0 : partner.w);
    const y2 = B.y + partner.y + partner.h / 2;
    const path = s('path', { d: pathFwd(x1, y1, x2, y2) }, 'amc-e amc-e-ghost');
    this.litEdges.append(path);
    const partnerEl = this.cards.get(partner.iid);
    if (partnerEl) this.flash(partnerEl);
  }

  private flash(el: HTMLElement) {
    el.classList.remove('amc-flash');
    void el.offsetWidth;
    el.classList.add('amc-flash');
    window.setTimeout(() => el.classList.remove('amc-flash'), 1300);
  }

  /* ------------------------------------------------- selection and search */

  private updateMatches() {
    const { query, filters } = this.ctx.view.get();
    const q = query.trim();
    this.matchIids = new Set();
    if (!q) {
      this.matchNodeIds = null;
    } else {
      const hits = this.ctx.port.search(q, filters);
      this.matchNodeIds = new Set(hits.map((h) => h.nodeId));
      for (const id of this.matchNodeIds)
        for (const item of this.mdl.byNode.get(id) ?? []) this.matchIids.add(item.iid);
      for (const I of this.mdl.islands)
        for (const item of I.items) {
          if (item.kind === 'event' && item.members.some((m) => this.matchNodeIds?.has(m)))
            this.matchIids.add(item.iid);
          if (item.kind === 'api' && item.members.some((m) => this.matchNodeIds?.has(m)))
            this.matchIids.add(item.iid);
        }
    }
  }

  private matchCount(I: BoardIsland): number {
    let n = 0;
    for (const item of I.items) if (item.node && this.matchIids.has(item.iid)) n++;
    return n;
  }

  private updateSelection() {
    const { selectedId } = this.ctx.view.get();
    this.selIids = new Set();
    if (selectedId)
      for (const item of this.mdl.byNode.get(selectedId) ?? []) this.selIids.add(item.iid);
    if (this.localSel && this.mdl.byIid.has(this.localSel)) this.selIids.add(this.localSel);
    this.litIids = new Set();
    this.litEdgeIds = new Set();
    for (const iid of this.selIids) {
      const I = this.islandOfIid(iid);
      if (!I) continue;
      const idx = this.indexOf(I);
      for (const dir of ['out', 'in'] as const) {
        const seen = new Set([iid]);
        const queue = [iid];
        for (let i = 0; i < queue.length; i++) {
          for (const e of (dir === 'out' ? idx.out : idx.in).get(queue[i]) ?? []) {
            // Reactor links are 1-hop context, not part of a chain.
            if (e.hover && queue[i] !== iid) continue;
            const next = dir === 'out' ? e.to : e.from;
            this.litEdgeIds.add(`${I.id}|${e.id}`);
            this.litIids.add(next);
            if (!seen.has(next) && !e.hover) {
              seen.add(next);
              queue.push(next);
            }
          }
        }
      }
      this.litIids.add(iid);
    }
    if (this.selIids.size) for (const iid of this.litExtra) this.litIids.add(iid);
  }

  private applyStates() {
    const focusing = this.selIids.size > 0;
    this.world.classList.toggle('amc-focusing', focusing);
    this.world.classList.toggle('amc-searching', !!this.matchNodeIds);
    this.canvas.classList.toggle('amc-searching', !!this.matchNodeIds);
    for (const [iid, el] of this.cards) this.styleCard(el, iid);
    for (const shell of this.shells.values())
      setMatchBadges(shell, this.matchNodeIds ? this.matchCount(shell.island) : null);
    this.world.classList.toggle('amc-hovering', this.hoverIids.length > 0);
    this.drawLit();
    this.drawMinimap(this.vp.view());
  }

  private isHoverDimmed(iid: string): boolean {
    if (!this.hoverIids.length) return false;
    const item = this.mdl.byIid.get(iid);
    if (!item) return false;
    for (const h of this.hoverIids) {
      if (this.mdl.byIid.get(h)?.islandId !== item.islandId) continue;
      if (h === iid) return false;
      const I = this.islandOfIid(h);
      if (!I) continue;
      const idx = this.indexOf(I);
      if (
        (idx.out.get(h) ?? []).some((e) => e.to === iid) ||
        (idx.in.get(h) ?? []).some((e) => e.from === iid)
      )
        return false;
    }
    // Only the hovered node's own island dims (calm: no global dim on hover).
    return this.hoverIids.some((h) => this.mdl.byIid.get(h)?.islandId === item.islandId);
  }

  private setHover(iids: string[], writeStore: boolean) {
    const same =
      iids.length === this.hoverIids.length && iids.every((v, i) => v === this.hoverIids[i]);
    if (same) return;
    this.hoverIids = iids;
    this.applyStates();
    this.showTip(iids[0] ? this.mdl.byIid.get(iids[0]) : undefined);
    if (writeStore) {
      const node = iids[0] ? this.mdl.byIid.get(iids[0])?.node : null;
      const id = node?.id ?? null;
      if (this.ctx.view.get().hoverId !== id) this.ctx.view.set({ hoverId: id });
    }
  }

  /* ------------------------------------------------------------- tooltips */

  private showTip(item: BoardItem | undefined) {
    this.tip.hidden = true;
    if (!item) return;
    const el = this.cards.get(item.iid);
    if (!el) return;
    clear(this.tip);
    const line = (...parts: Array<string | HTMLElement>) => {
      const d = h('div');
      d.append(...parts);
      this.tip.append(d);
    };
    const b = (t: string) => h('b', null, null, t);
    const mut = (t: string) => h('span', 'amc-mut', null, t);
    let any = true;
    if (item.hub) {
      line(
        b('Hub function'),
        ` · called by ${item.hub.callers} automations${item.hub.here ? `, ${item.hub.here} here` : ''}.`,
      );
      line(mut('Links are hidden to keep the map readable. Hover to show them.'));
    } else if (item.portal) {
      const p = item.portal;
      if (p.dir === 'out')
        line(
          'Writes ',
          b(
            p.fieldLabels.length === 1
              ? `${p.otherLabel}.${p.unknownFields ? 'unknown fields' : p.fieldLabels[0]}`
              : `${p.fieldLabels.length} ${p.otherLabel} fields`,
          ),
          p.partnerIid ? '. Click to fly there.' : '.',
        );
      else
        line('Writes from ', b(p.otherLabel), `: ${p.fieldLabels.join(', ')}. Click to fly there.`);
    } else if (this.currentTier === 'compact' && item.kind === 'action') {
      line(b(item.title));
      if (item.subtitle) line(mut(item.subtitle));
    } else if (item.gap) {
      line(b(item.title), ' ', mut(item.subtitle));
    } else any = false;
    if (!any) return;
    this.tip.hidden = false;
    const r = el.getBoundingClientRect();
    const c = this.canvas.getBoundingClientRect();
    const left = clamp(r.left - c.left, 8, Math.max(8, c.width - 310));
    let top = r.top - c.top - this.tip.offsetHeight - 10;
    if (top < 4) top = r.bottom - c.top + 10;
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${top}px`;
  }

  /* ------------------------------------------------------------ navigation */

  /** The floating upgrade card / pill (bottom-right), in canvas coordinates; null when absent. */
  private floatRect(): Rect | null {
    const w = cssPx(this.canvas, '--am-safe-br-w') ?? 0;
    const h = cssPx(this.canvas, '--am-safe-br-h') ?? 0;
    if (w <= 0 || h <= 0) return null;
    const size = this.vp.size();
    return { x: size.w - w, y: size.h - h, w, h };
  }

  /**
   * `t` moved up (or left) by the least that takes the revealed islands out from under the
   * floating upgrade card. The fog may sit under it; real content may not. Unchanged when the
   * islands are clear or no move keeps them on screen.
   */
  private clearFloat<T extends { zoom: number; tx: number; ty: number; x: number; y: number }>(
    t: T,
  ): T {
    const fl = this.floatRect();
    if (!fl || !this.mdl.islands.length) return t;
    const boxes: Rect[] = this.mdl.islands.map((I) => ({
      x: I.x,
      y: I.y - 30,
      w: I.w,
      h: I.h + TITLE_ZONE_H,
    }));
    const on = (b: Rect, dx = 0, dy = 0): Rect => ({
      x: b.x * t.zoom + t.tx + dx,
      y: b.y * t.zoom + t.ty + dy,
      w: b.w * t.zoom,
      h: b.h * t.zoom,
    });
    const hits = (dx: number, dy: number) => boxes.some((b) => rectsIntersect(on(b, dx, dy), fl));
    if (!hits(0, 0)) return t;
    const under = boxes.map((b) => on(b)).filter((r) => rectsIntersect(r, fl));
    const dy = fl.y - Math.max(...under.map((r) => r.y + r.h)) - 4;
    const dx = fl.x - Math.max(...under.map((r) => r.x + r.w)) - 4;
    const minTop = this.vp.safeTopPx() + 8;
    const topMost = Math.min(...boxes.map((b) => on(b).y));
    const leftMost = Math.min(...boxes.map((b) => on(b).x));
    const options = [
      { dx: 0, dy },
      { dx, dy: 0 },
    ].filter((o) => topMost + o.dy >= minTop && leftMost + o.dx >= 8 && !hits(o.dx, o.dy));
    if (!options.length) return t;
    const best = options.reduce((a, b) =>
      Math.abs(a.dx) + Math.abs(a.dy) <= Math.abs(b.dx) + Math.abs(b.dy) ? a : b,
    );
    const tx = t.tx + best.dx;
    const ty = t.ty + best.dy;
    return { ...t, tx, ty, x: -tx / t.zoom, y: -ty / t.zoom };
  }

  fitAll(animate = true) {
    const best = this.clearFloat(this.frame(this.bounds, 48, 1, this.contentBoxes()));
    this.vp.flyTo({ x: best.tx, y: best.ty, z: best.zoom }, animate);
  }

  /** Is the minimap on screen at this zoom? */
  private miniShownAt(zoom: number): boolean {
    return this.miniMode === 'shown' || (this.miniMode === 'auto' && zoom < READABLE_ZOOM);
  }

  /** Bottom-left chrome at `zoom`, in canvas coordinates: the zoom bar, and the minimap when shown. */
  private notchRects(zoom: number): Rect[] {
    const { h: height } = this.vp.size();
    // The bar's real width follows its buttons and tier label; the constant is the floor (and what
    // a layout-less test environment sees).
    const bar = this.zoomBar;
    const barW = Math.max(NOTCH.bar.w, bar ? bar.offsetLeft + bar.offsetWidth + 12 : 0);
    const rects: Rect[] = [{ x: 0, y: height - NOTCH.bar.h, w: barW, h: NOTCH.bar.h }];
    if (this.miniShownAt(zoom))
      rects.push({ x: 0, y: height - NOTCH.map.h, w: NOTCH.map.w, h: NOTCH.map.h });
    return rects;
  }

  /** Every island (and the solid core of every fog area): what a whole-board frame must keep clear. */
  private contentBoxes(): Rect[] {
    const boxes: Rect[] = this.mdl.islands.map((I) => ({
      x: I.x,
      y: I.y - TITLE_ZONE_H,
      w: I.w,
      h: I.h + TITLE_ZONE_H,
    }));
    // Fog is feathered: only its solid core counts.
    for (const r of this.fog?.rects ?? [])
      boxes.push({ x: r.x + r.w * 0.15, y: r.y + r.h * 0.15, w: r.w * 0.7, h: r.h * 0.7 });
    return boxes;
  }

  /**
   * Camera that frames `rect` below the banner and beside the inspector and keeps `boxes` out from
   * under the bottom-left chrome. The reserve decides the zoom: give up whichever of height or
   * width costs less, preferring a candidate that actually clears it. (Choosing by zoom alone picks
   * a candidate that still covers content whenever the estate is too big to fit and both sit at
   * the zoom floor.) The placement does not follow the reserve: reserving the chrome's whole width
   * packed a small, low-zoom board into the right 60% of the canvas. It is centred in the whole
   * free area and moved only as far as it takes to clear the chrome.
   */
  private frame(rect: Rect, pad: number, maxZ: number, boxes: readonly Rect[]) {
    const plain = this.vp.target(rect, pad, maxZ);
    if (!this.hitsNotch(plain, boxes)) return plain;
    const notches = this.notchRects(plain.zoom);
    const candidates = [
      this.vp.target(rect, pad, maxZ, { bottom: Math.max(...notches.map((n) => n.h)) }),
      this.vp.target(rect, pad, maxZ, { left: Math.max(...notches.map((n) => n.w)) }),
    ];
    const clear = candidates.filter((c) => !this.hitsNotch(c, boxes));
    const picked = (clear.length ? clear : candidates).reduce((a, b) => (b.zoom > a.zoom ? b : a));
    return this.nudgeClear(this.vp.place(rect, picked.zoom, pad), rect, pad, boxes) ?? picked;
  }

  /**
   * `t` (a camera that centres `rect`), moved right and/or up by the least that takes every box
   * out from under the bottom-left chrome, or `t` itself when none is under it. Null when no such
   * move keeps `rect` inside the free area: the caller falls back to reserving room instead.
   */
  private nudgeClear<T extends { zoom: number; tx: number; ty: number }>(
    t: T,
    rect: Rect,
    pad: number,
    boxes: readonly Rect[],
  ): T | null {
    const { w } = this.vp.size();
    const edge = Math.min(pad, 24);
    const minTop = this.vp.safeTopPx() + edge;
    const maxRight = w - this.vp.safeRightPx() - edge;
    const notches = this.notchRects(t.zoom);
    const onScreen = (b: Rect, dx = 0, dy = 0): Rect => ({
      x: b.x * t.zoom + t.tx + dx,
      y: b.y * t.zoom + t.ty + dy,
      w: b.w * t.zoom,
      h: b.h * t.zoom,
    });
    const hits = (dx: number, dy: number) =>
      boxes.some((b) => notches.some((n) => rectsIntersect(onScreen(b, dx, dy), n)));
    if (!hits(0, 0)) return t;
    // Each notch offers one move out of its way: right past its edge or up above it.
    const dxs = [0];
    const dys = [0];
    for (const n of notches) {
      const under = boxes.map((b) => onScreen(b)).filter((r) => rectsIntersect(r, n));
      if (!under.length) continue;
      dxs.push(n.x + n.w - Math.min(...under.map((r) => r.x)) + 0.5);
      dys.push(n.y - Math.max(...under.map((r) => r.y + r.h)) - 0.5);
    }
    const frame = onScreen(rect);
    let best: { dx: number; dy: number } | null = null;
    for (const dx of dxs)
      for (const dy of dys) {
        if (dx > 0 && frame.x + frame.w + dx > maxRight) continue;
        if (dy < 0 && frame.y + dy < minTop) continue;
        if (hits(dx, dy)) continue;
        if (!best || dx - dy < best.dx - best.dy) best = { dx, dy };
      }
    if (!best) return null;
    const tx = t.tx + best.dx;
    const ty = t.ty + best.dy;
    return { ...t, tx, ty, x: -tx / t.zoom, y: -ty / t.zoom };
  }

  /** Would any of `boxes` sit under the bottom-left chrome at this camera? */
  private hitsNotch(t: { zoom: number; tx: number; ty: number }, boxes: readonly Rect[]): boolean {
    const notches = this.notchRects(t.zoom);
    return boxes.some((b) =>
      notches.some((notch) =>
        rectsIntersect(
          { x: b.x * t.zoom + t.tx, y: b.y * t.zoom + t.ty, w: b.w * t.zoom, h: b.h * t.zoom },
          notch,
        ),
      ),
    );
  }

  /** Shows or hides the minimap for the current zoom and mode. */
  private syncMinimap() {
    const shown = this.miniShownAt(this.vp.z);
    // Runs every camera frame: touch the DOM only when the answer changes.
    if (this.minimap.el.hidden === !shown && this.miniWas === shown) return;
    this.miniWas = shown;
    this.minimap.el.hidden = !shown;
    this.miniButton?.setAttribute('aria-pressed', String(shown));
    this.miniButton?.setAttribute('title', shown ? 'Hide minimap' : 'Show minimap');
  }

  /**
   * Screen x for the left edge of a tall island framed from its top at `z` (its world y maps to
   * screen `y`). Cards are what must stay readable, not the island's box, so each candidate is
   * scored by the card area it leaves under the bar or the minimap (counted four times: the
   * chrome blocks the card, while a card cut by the right edge or the inspector can be panned to),
   * under the inspector, or off screen. Candidates: centred, right of the minimap, right of the
   * bar, and the left edge. Clearing the bar by pushing the island's last lane past the right
   * edge therefore wins over leaving rows under the bar; ties go to the more centred one.
   */
  private compactLeft(I: BoardIsland, z: number, y: number): number {
    const { w, h } = this.vp.size();
    const free = w - this.vp.safeRightPx();
    const top = this.vp.safeTopPx();
    const far = 1e5;
    const chrome: Array<{ rect: Rect; weight: number }> = [
      ...this.notchRects(z).map((rect) => ({ rect, weight: 4 })),
      { rect: { x: free, y: -far, w: far, h: far * 2 }, weight: 1 },
      { rect: { x: -far, y: -far, w: far, h: far * 2 }, weight: 1 },
    ];
    // Only cards in the visible window count; the rest of a tall island is scrolled to later.
    const cards = I.items
      .map((c) => ({ x: c.x * z, y: y + (I.y + c.y) * z, w: c.w * z, h: c.h * z }))
      .filter((c) => c.y + c.h > top && c.y < h);
    const hidden = (left: number) => {
      let cost = 0;
      for (const c of cards)
        for (const { rect: k, weight } of chrome) {
          const dx = Math.min(left + c.x + c.w, k.x + k.w) - Math.max(left + c.x, k.x);
          const dy = Math.min(c.y + c.h, k.y + k.h) - Math.max(c.y, k.y);
          if (dx > 0 && dy > 0) cost += dx * dy * weight;
        }
      return cost;
    };
    const candidates = [
      (free - I.w * z) / 2,
      ...[...new Set(this.notchRects(z).map((n) => n.w + 12))].sort((a, b) => a - b),
      40,
    ].map((left) => Math.max(40, left));
    let best = candidates[0];
    let bestCost = hidden(best);
    for (const left of candidates.slice(1)) {
      const cost = hidden(left);
      if (cost < bestCost) {
        best = left;
        bestCost = cost;
      }
    }
    return best;
  }

  flyToIsland(id: string, animate = true) {
    const I = this.mdl.islands.find((x) => x.id === id);
    if (!I) return;
    this.userMoved ||= animate;
    const rect = { x: I.x, y: I.y - 20, w: I.w, h: I.h + 20 };
    const fit = this.frame(rect, 40, 1, [rect]);
    if (fit.zoom >= COMPACT_MIN_ZOOM) {
      this.vp.flyTo({ x: fit.tx, y: fit.ty, z: fit.zoom }, animate);
    } else {
      // A very tall island would frame at overview zoom, where nothing can be read: show its
      // top (header and first rows) at compact zoom instead, below the banner.
      const z = COMPACT_MIN_ZOOM;
      const y = this.vp.safeTopPx() + 40 - rect.y * z;
      this.vp.flyTo({ x: this.compactLeft(I, z, y) - I.x * z, y, z }, animate);
    }
    const shell = this.shells.get(id);
    if (shell && animate) {
      shell.el.classList.remove('amc-flash');
      void shell.el.offsetWidth;
      shell.el.classList.add('amc-flash');
    }
  }

  private itemRect(item: BoardItem): Rect {
    const I = this.islandOfIid(item.iid);
    return { x: (I?.x ?? 0) + item.x, y: (I?.y ?? 0) + item.y, w: item.w, h: item.h };
  }

  private flyToItem(item: BoardItem, zoom?: number, animate = true) {
    const r = this.itemRect(item);
    if (this.frameSelectedIsland(item, r, zoom, animate)) return;
    const z = clamp(zoom ?? Math.max(this.vp.z, 0.95), ZOOM_MIN, ZOOM_MAX);
    const { w, h } = this.vp.size();
    const top = this.vp.safeTopPx();
    const free = w - this.vp.safeRightPx();
    let tx = free / 2 - (r.x + r.w / 2) * z;
    let ty = top + (h - top) / 2 - (r.y + r.h / 2) * z;
    // Centring alone can leave the island's heading under the banner and its left edge off the
    // canvas. When the node stays clear of the inspector and the bottom edge, slide so that the
    // heading and the first lane are in view as well (the node is what you asked for; the island
    // is where it is).
    const I = this.islandOfIid(item.iid);
    if (I) {
      const edge = 16;
      const headTop = I.y * z + ty;
      if (headTop < top + edge) {
        const dy = top + edge - headTop;
        if ((r.y + r.h) * z + ty + dy <= h - edge - 40) ty += dy;
      }
      const headLeft = I.x * z + tx;
      if (headLeft < edge) {
        const dx = edge - headLeft;
        if ((r.x + r.w) * z + tx + dx <= free - edge) tx += dx;
      }
    }
    this.vp.flyTo({ x: tx, y: ty, z }, animate);
    this.reconcileSoon();
  }

  /**
   * With the inspector open, a jump to a node frames its whole island in the area the inspector
   * leaves free (zooming out a little, never below 45% or past 70%) instead of centring
   * the node at 90-100% with half the island under the panel. The node itself stays on screen.
   * False when no inspector covers the canvas or the island already fits at the asked zoom.
   */
  private frameSelectedIsland(
    item: BoardItem,
    r: Rect,
    zoom: number | undefined,
    animate: boolean,
  ) {
    if (!this.ctx.view.get().inspectorOpen || this.vp.safeRightPx() <= 0) return false;
    const I = this.islandOfIid(item.iid);
    if (!I) return false;
    const want = clamp(zoom ?? Math.max(this.vp.z, 0.95), ZOOM_MIN, ZOOM_MAX);
    const rect = { x: I.x, y: I.y - 24, w: I.w, h: I.h + 24 };
    const fit = this.vp.target(rect, 24, Math.min(want, 0.7));
    const z = Math.max(fit.zoom, Math.min(want, 0.45));
    const cam = this.vp.place(rect, z, 24);
    let { tx, ty } = cam;
    const { w, h } = this.vp.size();
    const free = w - this.vp.safeRightPx();
    const top = this.vp.safeTopPx();
    // A tall island starts at its top; keep the node itself clear of every edge.
    const bottom = (r.y + r.h) * z + ty;
    if (bottom > h - 24) ty -= bottom - (h - 24);
    if (r.y * z + ty < top + 16) ty = top + 16 - r.y * z;
    const right = (r.x + r.w) * z + tx;
    if (right > free - 24) tx -= right - (free - 24);
    if (r.x * z + tx < 16) tx = 16 - r.x * z;
    this.userMoved = true;
    this.vp.flyTo({ x: tx, y: ty, z }, animate);
    this.reconcileSoon();
    return true;
  }

  private reconcileSoon() {
    // Arrival is animated; the cards for the destination mount as frames advance.
    this.scheduleReconcile();
  }

  /** True when the world rect is on screen and clear of the inspector and the top chrome. */
  private isClear(r: Rect): boolean {
    const { dx, dy } = this.vp.shiftIntoView(r, 0);
    return Math.abs(dx) < 1 && Math.abs(dy) < 1;
  }

  private ensureVisible(item: BoardItem) {
    if (!this.isClear(this.itemRect(item)) || this.vp.z < 0.6)
      this.flyToItem(item, Math.max(this.vp.z, 0.9), false);
    this.reconcile();
  }

  /**
   * Bring a node into view. When it is already on screen it stays put, unless the board is too
   * far out to read it (overview) and the caller asked to show the node.
   */
  private focusNode(nodeId: MapNodeId, animate = true) {
    const items = this.mdl.byNode.get(nodeId);
    if (!items?.length) return;
    const item = items[0];
    if (!this.isClear(this.itemRect(item)) || this.vp.z < READABLE_ZOOM)
      this.flyToItem(item, Math.max(this.vp.z, 0.9), animate);
  }

  private focusNodeIfOffscreen(nodeId: MapNodeId) {
    const item = this.mdl.byNode.get(nodeId)?.[0];
    if (!item) return;
    if (!this.isClear(this.itemRect(item))) this.flyToItem(item, Math.max(this.vp.z, 0.9), false);
  }

  private startTrace(nodeId: MapNodeId | null | undefined) {
    if (!nodeId) return;
    const kind = this.snapshotGraph?.nodes.get(nodeId)?.kind;
    this.ctx.view.set({
      traceRootId: nodeId,
      selectedId: nodeId,
      traceDepth: defaultDepth(kind),
      view: 'trace',
    });
  }

  private itemTraceTarget(item: BoardItem): MapNodeId | null {
    if (item.node) return item.node.id;
    if (item.kind === 'event' || item.kind === 'api') return item.members[0] ?? null;
    return null;
  }

  /* ---------------------------------------------------------------- events */

  private bindEvents() {
    const on = <T extends EventTarget>(
      t: T,
      type: string,
      fn: (e: never) => void,
      opts?: AddEventListenerOptions,
    ) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    const cardOf = (e: Event): HTMLElement | null =>
      e.target instanceof Element ? (e.target.closest('.amc-nd') as HTMLElement | null) : null;

    on(this.nodeLayer, 'pointerover', (e: PointerEvent) => {
      const el = cardOf(e);
      if (el?.dataset.iid) this.setHover([el.dataset.iid], true);
    });
    on(this.nodeLayer, 'pointerout', (e: PointerEvent) => {
      const el = cardOf(e);
      if (!el) return;
      const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest('.amc-nd') : null;
      if (to !== el) this.setHover([], true);
    });
    on(this.nodeLayer, 'click', (e: MouseEvent) => {
      const el = cardOf(e);
      if (!el?.dataset.iid) return;
      e.stopPropagation();
      if (this.vp.lastDragMoved) return;
      this.activate(el.dataset.iid);
    });
    on(this.nodeLayer, 'dblclick', (e: MouseEvent) => {
      const el = cardOf(e);
      const item = el?.dataset.iid ? this.mdl.byIid.get(el.dataset.iid) : undefined;
      if (!item) return;
      e.stopPropagation();
      this.startTrace(this.itemTraceTarget(item));
    });
    on(this.nodeLayer, 'focusin', (e: FocusEvent) => {
      const el = cardOf(e);
      if (el?.dataset.iid) {
        this.focusIid = el.dataset.iid;
        this.announce(el.dataset.iid);
      }
    });
    on(this.canvas, 'click', (e: MouseEvent) => {
      if (this.vp.lastDragMoved) {
        this.vp.lastDragMoved = false;
        return;
      }
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('.amc-nd, .amc-head, .amc-sum, .amc-ttl, .amc-fog-hit')) return;
      this.setLegend(false);
      this.localSel = null;
      if (this.ctx.view.get().selectedId) {
        this.ownSelection = null;
        this.ctx.view.set({ selectedId: null, inspectorOpen: false });
      } else if (this.selIids.size) {
        this.updateSelection();
        this.applyStates();
      }
    });
    on(this.root, 'keydown', (e: KeyboardEvent) => this.onKey(e));
    on(this.root, 'keyup', (e: KeyboardEvent) => {
      if (e.key === ' ') this.vp.spaceHeld = false;
    });
    on(document, 'visibilitychange', () => this.scheduleReconcile());
  }

  /** Click / Enter on an item. */
  private activate(iid: string) {
    const item = this.mdl.byIid.get(iid);
    if (!item) return;
    this.focusIid = iid;
    if (item.portal) this.portalJump(item);
    else this.selectItem(item);
  }

  /**
   * Select an item. Click and Enter open the inspector (UX spec §6.6); arrow-key navigation passes
   * `openInspector: false` so it only follows an inspector that is already open.
   */
  private selectItem(item: BoardItem, openInspector = true) {
    this.localSel = null;
    this.litExtra = new Set();
    const nodeId = item.node?.id ?? (item.kind === 'api' ? item.members[0] : undefined);
    if (nodeId) {
      this.ownSelection = nodeId;
      this.ctx.view.set({ selectedId: nodeId, ...(openInspector ? { inspectorOpen: true } : {}) });
      if (openInspector) this.clearOfInspector(item);
    } else {
      // Record events have no graph id: highlight their chain locally.
      this.localSel = item.iid;
      if (this.ctx.view.get().selectedId) {
        this.ownSelection = null;
        this.ctx.view.set({ selectedId: null, inspectorOpen: false });
      }
    }
    this.updateSelection();
    this.applyStates();
  }

  /** The inspector covers the right edge: slide a node that it would hide into the free area. */
  private clearOfInspector(item: BoardItem) {
    const state = this.ctx.view.get();
    if (!state.inspectorOpen) return;
    const { dx, dy } = this.vp.shiftIntoView(this.itemRect(item), 24);
    if (dx !== 0 || dy !== 0) {
      this.userMoved = true;
      this.vp.flyTo({ x: this.vp.x + dx, y: this.vp.y + dy, z: this.vp.z }, true);
    }
  }

  /**
   * A portal says "this writes Deals.Stage": the jump lands on that field when it is one field,
   * selects it with the inspector, and keeps the stub it came through lit, so what you flew to is
   * always on screen and never dimmed away.
   */
  private portalJump(item: BoardItem) {
    const p = item.portal;
    if (!p) return;
    const partner = p.partnerIid ? this.mdl.byIid.get(p.partnerIid) : null;
    const fieldId = p.dir === 'out' && p.fieldIds.length === 1 ? p.fieldIds[0] : null;
    const fieldItem = fieldId
      ? (this.mdl.byNode.get(fieldId)?.find((i) => i.islandId === partner?.islandId) ??
        this.mdl.byNode.get(fieldId)?.[0])
      : undefined;
    this.litExtra = new Set(partner ? [partner.iid] : []);
    if (fieldId && fieldItem) {
      this.ownSelection = fieldId;
      this.ctx.view.set({ selectedId: fieldId, inspectorOpen: true });
      this.updateSelection();
      this.applyStates();
    }
    const target = fieldItem ?? partner;
    if (!target) return;
    this.userMoved = true;
    // After the selection: the fly-to centres in the area the opened inspector leaves free.
    this.flyToItem(target, Math.max(this.vp.z, 0.9));
    this.pendingFlash = target.iid;
    const el = this.cards.get(target.iid);
    if (el) this.flash(el);
  }

  private announce(iid: string) {
    const item = this.mdl.byIid.get(iid);
    const I = this.islandOfIid(iid);
    if (!item || !I) return;
    const idx = this.indexOf(I);
    const down = (idx.out.get(iid) ?? []).length;
    const up = (idx.in.get(iid) ?? []).length;
    const state = item.kind === 'rule' ? (item.active === true ? ', active' : ', inactive') : '';
    this.live.textContent = `${KIND_LABEL[item.kind]}, ${item.title}${I.org ? '' : `, ${I.label}`}${state}. ${down} downstream, ${up} upstream.`;
  }

  /* -------------------------------------------------------------- keyboard */

  private onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case 'Escape':
        // The legend is a popover: Esc closes it before anything else reacts to the key.
        if (this.legend.hidden) return;
        this.setLegend(false);
        this.legendButton?.focus();
        return done();
      case '+':
      case '=':
        this.userMoved = true;
        this.vp.zoomBy(1.25);
        this.syncPct();
        return done();
      case '-':
      case '_':
        this.userMoved = true;
        this.vp.zoomBy(0.8);
        this.syncPct();
        return done();
      case '0':
        this.userMoved = true;
        this.fitAll();
        return done();
      case '1': {
        const sel = this.ctx.view.get().selectedId;
        const item = sel ? this.mdl.byNode.get(sel)?.[0] : undefined;
        if (item) {
          this.userMoved = true;
          this.flyToItem(item, 1);
        }
        return done();
      }
      case 't':
      case 'T': {
        const focus = this.focusIid ? this.mdl.byIid.get(this.focusIid) : undefined;
        const target =
          this.ctx.view.get().selectedId ?? (focus ? this.itemTraceTarget(focus) : null);
        if (target) this.startTrace(target);
        return done();
      }
      case ' ':
        this.vp.spaceHeld = true;
        return done();
      case 'Enter':
        if (this.focusIid) {
          this.activate(this.focusIid);
          return done();
        }
        return;
      case 'ArrowRight':
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'ArrowDown':
        this.moveFocus(e.key);
        return done();
      default:
    }
  }

  /** Arrows follow the graph: right = downstream, left = upstream, up/down = within the lane. */
  private moveFocus(key: string) {
    let cur = this.focusIid ? this.mdl.byIid.get(this.focusIid) : undefined;
    if (!cur) {
      const sel = this.ctx.view.get().selectedId;
      cur = (sel ? this.mdl.byNode.get(sel)?.[0] : undefined) ?? this.firstItemInView();
      if (!cur) return;
    } else {
      const I = this.islandOfIid(cur.iid);
      if (!I) return;
      const idx = this.indexOf(I);
      let next: BoardItem | undefined;
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        const edges = key === 'ArrowRight' ? idx.out.get(cur.iid) : idx.in.get(cur.iid);
        const pick =
          (edges ?? []).find((e) => !e.hover && !e.back) ?? (edges ?? []).find((e) => !e.hover);
        if (pick) next = I.byIid.get(key === 'ArrowRight' ? pick.to : pick.from);
      } else {
        const lane = I.items
          .filter((x) => x.lane === cur?.lane && x.col === cur?.col)
          .sort((a, b) => a.y - b.y);
        const i = lane.indexOf(cur);
        next = lane[key === 'ArrowDown' ? i + 1 : i - 1];
      }
      if (next) cur = next;
    }
    this.focusIid = cur.iid;
    // Arrows move the selection along the graph, so the inspector follows the keyboard.
    if (!cur.portal) this.selectItem(cur, false);
    this.ensureVisible(cur);
    for (const el of this.cards.values()) el.tabIndex = -1;
    const el = this.cards.get(cur.iid);
    if (el) {
      el.tabIndex = 0;
      el.focus({ preventScroll: true });
    }
    this.announce(cur.iid);
  }

  private firstItemInView(): BoardItem | undefined {
    const v = this.vp.view();
    let best: BoardItem | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const I of this.mdl.islands)
      for (const item of I.items) {
        if (item.kind === 'portal' || item.kind === 'event') continue;
        const r = { x: I.x + item.x, y: I.y + item.y, w: item.w, h: item.h };
        if (!rectsIntersect(r, v)) continue;
        const score = r.x - v.x + (r.y - v.y);
        if (score < bestScore) {
          best = item;
          bestScore = score;
        }
      }
    return best ?? this.mdl.islands[0]?.items[0];
  }

  /* ------------------------------------------------------------- store sync */

  private onViewState(next: Readonly<MapViewState>, prev: Readonly<MapViewState>) {
    if (this.disposed) return;
    // A rebuild does not end the patch: a shell call may also change focus, selection or camera.
    if (next.filters !== prev.filters) {
      this.rebuild();
      // A landing target ("Show on map") may only now be on the board, e.g. after the scope widened.
      if (this.applyPendingFrame()) this.reconcile();
    }
    if (next.query !== prev.query) {
      this.updateMatches();
      this.applyStates();
    }
    if (next.selectedId !== prev.selectedId) {
      const own = this.ownSelection !== undefined && this.ownSelection === next.selectedId;
      this.ownSelection = undefined;
      if (!own) this.litExtra = new Set();
      if (next.selectedId !== null) this.localSel = null;
      this.updateSelection();
      this.applyStates();
      if (!own && next.selectedId) this.focusNode(next.selectedId);
    }
    if (next.hoverId !== prev.hoverId) {
      const mine = this.hoverIids[0]
        ? this.mdl.byIid.get(this.hoverIids[0])?.node?.id === next.hoverId
        : next.hoverId === null;
      if (!mine)
        this.setHover(
          (next.hoverId ? this.mdl.byNode.get(next.hoverId) : undefined)?.map((i) => i.iid) ?? [],
          false,
        );
    }
    if (next.focusModuleApiName !== prev.focusModuleApiName && next.focusModuleApiName) {
      this.flyToIsland(next.focusModuleApiName);
    }
    if (
      next.camera !== prev.camera &&
      !(this.lastWritten && sameCamera(next.camera, this.lastWritten))
    ) {
      if (!sameCamera(next.camera, this.vp.camera())) {
        this.userMoved = true;
        this.vp.setCamera(next.camera);
        this.lastWritten = next.camera;
      }
    }
  }

  refresh() {
    if (this.disposed) return;
    const snapshot = this.ctx.port.snapshot();
    // Coverage and phase updates arrive constantly while loading; only a new graph rebuilds
    // (a rebuild drops shells, cards, hover and keyboard focus).
    if (snapshot.graph === this.snapshotGraph) {
      this.updateEmptyState(snapshot.phase, this.ctx.view.get().filters);
      return;
    }
    this.rebuild(false);
    // Progressive loading grows islands: an automatic frame follows the whole map, unless a
    // landing target ("Show on map") has just appeared and gets the frame instead.
    if (!this.applyPendingFrame() && this.autoFit && !this.userMoved) this.fitAll(false);
    this.reconcile();
  }

  /* ---------------------------------------------------------------- camera */

  private scheduleCameraWrite() {
    if (this.cameraTimer || !this.framed) return;
    this.cameraTimer = window.setTimeout(() => {
      this.cameraTimer = 0;
      this.writeCamera();
    }, CAMERA_WRITE_MS);
  }

  private writeCamera() {
    if (this.disposed) return;
    const cam = this.vp.camera();
    if (this.lastWritten && sameCamera(cam, this.lastWritten)) return;
    this.lastWritten = cam;
    this.ctx.view.set({ camera: cam });
  }

  camera(): Camera {
    return this.vp.camera();
  }

  setCamera(c: Camera) {
    this.vp.setCamera(c);
  }

  tier(): Tier {
    return this.currentTier ?? 'detail';
  }

  model(): BoardModel {
    return this.mdl;
  }

  stats(): BoardStats {
    return {
      cards: this.cards.size,
      islands: this.mdl.islands.length,
      mountedIslands: this.shells.size,
      edges: this.edgeCount,
      elements: this.root.querySelectorAll('*').length,
      layoutMs: this.layoutMs,
      items: this.mdl.byIid.size,
    };
  }

  /* ---------------------------------------------------------------- chrome */

  private buildZoom(): HTMLElement {
    const bar = h('div', 'amc-chrome amc-zoom', { role: 'toolbar', 'aria-label': 'Zoom' });
    this.zoomBar = bar;
    const btn = (label: string, icon: Parameters<IconSprite['icon']>[0], fn: () => void) => {
      const b = h('button', null, { type: 'button', title: label, 'aria-label': label });
      b.append(this.sprite.icon(icon, 16));
      b.addEventListener('click', () => {
        this.userMoved = true;
        fn();
        this.syncPct();
      });
      return b;
    };
    bar.append(
      btn('Zoom out (−)', 'zoomOut', () => this.vp.zoomBy(0.8)),
      this.pct,
      btn('Zoom in (+)', 'zoomIn', () => this.vp.zoomBy(1.25)),
      btn('Fit all (0)', 'fit', () => this.fitAll()),
      this.buildMinimapToggle(),
      this.tierLabel,
    );
    // The preview has nothing to explain beyond one flow, and its kinds are not all revealed.
    if (!this.plugin) {
      const toggle = h('button', 'amc-lgbtn', {
        type: 'button',
        'aria-expanded': 'false',
        'aria-controls': 'amc-legend',
        title: 'Legend',
      });
      toggle.append(this.sprite.icon('info', 14), document.createTextNode(' Legend'));
      toggle.addEventListener('click', () => this.setLegend(this.legend.hidden === true));
      this.legendButton = toggle;
      bar.append(toggle);
    }
    return bar;
  }

  private buildMinimapToggle(): HTMLButtonElement {
    const b = h('button', null, {
      type: 'button',
      'aria-label': 'Minimap',
      'aria-pressed': 'true',
    });
    b.append(this.sprite.icon('map', 16));
    b.addEventListener('click', () => {
      this.miniMode = this.miniShownAt(this.vp.z) ? 'hidden' : 'shown';
      this.syncMinimap();
      if (!this.minimap.el.hidden) this.drawMinimap(this.vp.view());
      // The corner it covers changes with it: an automatic frame follows.
      if (this.autoFit && !this.userMoved) this.fitAll(false);
    });
    this.miniButton = b;
    return b;
  }

  private setLegend(open: boolean) {
    if (open === (this.legend.hidden !== true)) return;
    this.legend.hidden = !open;
    this.legendButton?.setAttribute('aria-expanded', String(open));
    if (open && !this.legend.firstChild) this.buildLegend();
  }

  /** What the shapes, colours and lines on the board mean, for when the rail is a drawer. */
  private buildLegend() {
    const kinds = [
      'event',
      'button',
      'schedule',
      'api',
      'rule',
      'action',
      'function',
      'template',
      'external',
      'field',
      'transition',
      'approval',
    ] as const;
    const col = h('div', 'amc-lg-col');
    col.append(h('h6', null, null, 'Nodes'));
    for (const kind of kinds) {
      const row = h('div', `amc-lg-row amc-k-${kind}`);
      const tile = h('span', 'amc-ic');
      tile.append(this.sprite.icon(KIND_ICON[kind], 14));
      row.append(tile, h('span', null, null, KIND_LABEL[kind]));
      col.append(row);
    }
    const lines = h('div', 'amc-lg-col');
    lines.append(h('h6', null, null, 'Links'));
    const sample = (cls: string, label: string) => {
      const row = h('div', 'amc-lg-row');
      const svg = s('svg', { width: 34, height: 10, viewBox: '0 0 34 10' }, 'amc-lg-line');
      svg.append(s('path', { d: 'M1,5 L33,5' }, `amc-e ${cls}`));
      row.append(svg, h('span', null, null, label));
      lines.append(row);
    };
    sample('', 'Declared: set up in Zoho');
    sample('amc-e-inf', 'Inferred from code');
    sample('amc-e-ur-o', 'Unresolved');
    sample('amc-e-casc', 'Can start another rule');
    sample('amc-e-react', 'Reacts to a field');
    this.legend.append(col, lines);
  }

  private drawMinimap(view: Rect) {
    if (this.minimap.el.hidden) return;
    const rects: MiniRect[] = this.mdl.islands.map((I) => ({ x: I.x, y: I.y, w: I.w, h: I.h }));
    for (const r of this.fog?.rects ?? []) rects.push(r);
    const dots: Array<{ x: number; y: number }> = [];
    if (this.matchNodeIds) {
      for (const iid of this.matchIids) {
        const item = this.mdl.byIid.get(iid);
        if (!item) continue;
        const r = this.itemRect(item);
        dots.push({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
        if (dots.length > 400) break;
      }
    }
    const sel = [...this.selIids][0];
    const selItem = sel ? this.mdl.byIid.get(sel) : undefined;
    const selRect = selItem ? this.itemRect(selItem) : null;
    this.minimap.draw(
      this.bounds,
      rects,
      view,
      dots,
      selRect ? { x: selRect.x + selRect.w / 2, y: selRect.y + selRect.h / 2 } : null,
    );
  }

  /* --------------------------------------------------------------- dispose */

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.clearTimeout(this.cameraTimer);
    window.clearTimeout(this.arrivalTimer);
    window.clearTimeout(this.leaveCardsTimer);
    window.clearTimeout(this.leaveFlowsTimer);
    for (const off of this.cleanups) off();
    this.minimap.dispose();
    this.vp.dispose();
    this.disposeFog();
    this.root.remove();
  }
}

export function createBoard(
  container: HTMLElement,
  ctx: MapUiContext,
  plugin?: BoardPlugin,
): BoardController {
  return new Board(container, ctx, plugin);
}
