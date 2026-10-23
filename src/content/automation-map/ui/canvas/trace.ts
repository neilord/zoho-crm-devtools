/**
 * Trace flowchart view (UX spec §6.8): left-to-right dagre layout of `port.trace(...)`, a dimmed
 * context ring one hop beyond the depth, depth steppers, "+N more" chips, evidence-tier edge
 * styles and cascade styling. Re-bases on double-click; Esc and "Exit trace" return to the board.
 */
import type { MapNodeId } from '../../types';
import type { Camera, MapUiContext, MapViewState } from '../context';
import { createCard, createMoreChip } from './cards';
import { clear, cssPx, h, IconSprite, s } from './dom';
import { createDefs, drawEdge, markerIds, pathBack, pathFwd } from './edges';
import { KIND_LABEL, KIND_VAR } from './kinds';
import { backEdgeLanes, LANE_STEP, layoutTrace, loadDagre, type TraceLayout } from './trace-layout';
import { buildTraceModel, type TraceVM } from './trace-model';
import { Viewport } from './viewport';

const MAX_DEPTH = 6;
const NODE_CAP = 160;
/** Smallest zoom at which a trace is fitted whole (node text 10.6px); smaller charts are panned. */
const FIT_MIN_ZOOM = 0.85;
/** Fallback inspector width when the shell has not published `--am-insp-w` (harness, tests). */
const INSPECTOR_W = 400;
const defaultDepth = (kind: string | undefined) =>
  kind === 'field' ? { upstream: 3, downstream: 2 } : { upstream: 2, downstream: 3 };

export interface TraceController {
  root: HTMLElement;
  /** Resolves after the first render (dagre loads lazily). */
  ready: Promise<void>;
  dispose(): void;
  model(): TraceVM | null;
  layout(): TraceLayout | null;
  /** Wait for any in-flight render. */
  settled(): Promise<void>;
  viewport(): Viewport;
  /** The graph node a rendered card stands for. */
  nodeIdOf(card: Element): string | null;
}

class TraceView implements TraceController {
  readonly root = h('div', 'amc-root amc-trace');
  private readonly bar = h('div', 'amc-tracebar', {
    role: 'toolbar',
    'aria-label': 'Trace controls',
  });
  private readonly stage = h('div', 'amc-trace-stage');
  private readonly canvas = h('div', 'amc-canvas amc-tier-detail', {
    role: 'group',
    'aria-roledescription': 'automation map trace',
    'aria-label': 'Trace flowchart',
    tabindex: '0',
    'data-focus-target': 'canvas',
  });
  private readonly world = h('div', 'amc-world');
  private readonly svg = s('svg', { width: 1, height: 1 }, 'amc-svg amc-edges');
  private readonly nodes = h('div', 'amc-layer amc-nodes');
  private readonly empty = h('div', 'amc-empty');
  private readonly sprite = new IconSprite();
  private readonly markers = markerIds(this.sprite);
  private readonly vp: Viewport;
  private readonly cleanups: Array<() => void> = [];

  private vm: TraceVM | null = null;
  private lay: TraceLayout | null = null;
  private context = true;
  private maxNodes = NODE_CAP;
  private readonly expanded = new Set<string>();
  private renderedRoot: MapNodeId | null = null;
  private renderedGraph: object | null = null;
  private readonly cardByNode = new Map<string, HTMLElement>();
  /** Every card and chip, for keyboard navigation (roving tabindex). */
  private readonly focusables = new Map<string, HTMLElement>();
  private focusId: string | null = null;
  private pending: Promise<void> = Promise.resolve();
  private generation = 0;
  private disposed = false;
  ready: Promise<void>;

  constructor(
    container: HTMLElement,
    private readonly ctx: MapUiContext,
  ) {
    this.world.append(this.svg, this.nodes);
    this.canvas.append(this.world);
    this.stage.append(this.canvas);
    this.root.append(this.bar, this.stage, this.empty, this.sprite.el);
    this.empty.hidden = true;
    this.svg.append(createDefs(this.markers));
    container.append(this.root);
    this.vp = new Viewport(this.canvas, this.world, {
      min: 0.15,
      max: 2,
      safeRight: () =>
        this.ctx.view.get().inspectorOpen ? cssPx(this.canvas, '--am-insp-w') || INSPECTOR_W : 0,
      isInteractive: (el) => !!el.closest('.amc-nd'),
    });
    this.canvas.addEventListener('click', (e) => {
      if (this.vp.lastDragMoved) {
        this.vp.lastDragMoved = false;
        return;
      }
      if (!(e.target instanceof Element && e.target.closest('.amc-nd')))
        this.ctx.view.set({ selectedId: null, inspectorOpen: false });
    });
    this.root.addEventListener('keydown', (e) => this.onKey(e));
    this.cleanups.push(this.ctx.view.subscribe((next, prev) => this.onState(next, prev)));
    this.cleanups.push(
      this.ctx.port.subscribe(() => {
        // Coverage-only snapshots leave the graph (and so the trace) unchanged.
        if (this.ctx.port.snapshot().graph !== this.renderedGraph) void this.render();
      }),
    );
    this.ready = this.render();
  }

  /* ----------------------------------------------------------------- state */

  private onState(next: Readonly<MapViewState>, prev: Readonly<MapViewState>) {
    if (this.disposed) return;
    if (
      next.traceRootId !== prev.traceRootId ||
      next.traceDepth !== prev.traceDepth ||
      next.filters !== prev.filters
    ) {
      this.expanded.clear();
      this.maxNodes = NODE_CAP;
      void this.render();
    } else if (next.selectedId !== prev.selectedId) {
      this.markSelection();
    }
  }

  private markSelection() {
    const sel = this.ctx.view.get().selectedId;
    for (const [id, el] of this.cardByNode) el.classList.toggle('amc-sel', id === sel);
  }

  settled(): Promise<void> {
    return this.pending;
  }

  model(): TraceVM | null {
    return this.vm;
  }

  layout(): TraceLayout | null {
    return this.lay;
  }

  viewport(): Viewport {
    return this.vp;
  }

  nodeIdOf(card: Element): string | null {
    for (const [id, el] of this.cardByNode) if (el === card) return id;
    return null;
  }

  /* ---------------------------------------------------------------- render */

  private render(): Promise<void> {
    const gen = ++this.generation;
    const run = (async () => {
      const state = this.ctx.view.get();
      const rootId = state.traceRootId;
      const graph = this.ctx.port.snapshot().graph;
      if (!rootId || !graph.nodes.has(rootId)) {
        this.showEmpty(
          rootId ? 'This node is not on the map' : 'Nothing to trace yet',
          rootId
            ? 'It may be outside the current scope.'
            : 'Select a node on the board and press T.',
        );
        this.drawBar(null);
        return;
      }
      const up = state.traceDepth.upstream;
      const down = state.traceDepth.downstream;
      const result = this.ctx.port.trace(rootId, {
        upstream: up + (this.context ? 1 : 0),
        downstream: down + (this.context ? 1 : 0),
        maxNodes: this.maxNodes,
        includeInactive: state.filters.scope === 'everything',
      });
      const access = this.ctx.port.snapshot().access;
      const vm = buildTraceModel(graph, result, {
        up,
        down,
        context: this.context,
        expanded: this.expanded,
        redact: access.level === 'teaser' ? { keep: access.revealedModuleApiName } : undefined,
      });
      const dagre = await loadDagre();
      if (gen !== this.generation || this.disposed) return;
      const lay = layoutTrace(dagre, vm);
      // Expanding a group or changing depth re-lays the chart out: keep the base node where it was.
      const before = this.renderedRoot === rootId ? this.baseScreenPoint() : null;
      this.vm = vm;
      this.lay = lay;
      this.renderedGraph = graph;
      this.empty.hidden = true;
      this.draw(vm, lay);
      this.drawBar(vm);
      if (this.renderedRoot !== rootId) {
        this.renderedRoot = rootId;
        this.centre(false);
      } else if (before) {
        const after = this.baseScreenPoint();
        if (after) this.vp.panBy(before.x - after.x, before.y - after.y);
      }
    })();
    this.pending = run;
    return run;
  }

  /** Where the base node's centre is on screen right now. */
  private baseScreenPoint(): { x: number; y: number } | null {
    const base = this.vm?.nodes.find((n) => n.id === this.vm?.rootId);
    if (!base) return null;
    return {
      x: (base.x + base.w / 2) * this.vp.z + this.vp.x,
      y: (base.y + base.h / 2) * this.vp.z + this.vp.y,
    };
  }

  private showEmpty(title: string, hint: string) {
    this.vm = null;
    this.lay = null;
    clear(this.nodes);
    clear(this.svg);
    this.svg.append(createDefs(this.markers));
    clear(this.empty);
    this.empty.append(h('h3', null, null, title), h('p', null, null, hint));
    this.empty.hidden = false;
  }

  private draw(vm: TraceVM, lay: TraceLayout) {
    clear(this.nodes);
    clear(this.svg);
    this.cardByNode.clear();
    this.focusables.clear();
    this.svg.append(createDefs(this.markers));
    const state = this.ctx.view.get();
    for (const lv of lay.levels) {
      const label = h(
        'span',
        'amc-lvl-lbl',
        null,
        lv === 0 ? 'Start' : lv < 0 ? `${-lv} up` : `${lv} down`,
      );
      label.style.left = `${lay.colX.get(lv) ?? 0}px`;
      label.style.top = `${lay.minY - 34}px`;
      this.nodes.append(label);
    }
    const byId = new Map(vm.nodes.map((n) => [n.id, n]));
    for (const n of vm.nodes) {
      if (n.more) {
        const chip = createMoreChip(`+${n.more.count} more`, n.x, n.y, n.w, n.h);
        chip.classList.add(n.more.kind === 'limit' ? 'amc-more-limit' : 'amc-more-fan');
        chip.title =
          n.more.kind === 'limit'
            ? 'Node limit reached. Click to show more.'
            : 'Click to expand this group';
        const info = n.more;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          if (info.kind === 'limit') this.maxNodes += 100;
          else this.expanded.add(info.key);
          void this.render();
        });
        this.nodes.append(chip);
        this.focusables.set(n.id, chip);
        continue;
      }
      const item = n.item;
      if (!item) continue;
      const classes = [
        n.id === vm.rootId ? 'amc-base' : '',
        n.ghost ? 'amc-ghost' : '',
        state.selectedId === n.id ? 'amc-sel' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const el = createCard(item, {
        omitIid: true,
        sprite: this.sprite,
        x: n.x,
        y: n.y,
        w: n.w,
        h: n.h,
        className: classes,
      });
      // Node ids embed module API names; the DOM carries an opaque ordinal (teaser: no leaks).
      el.dataset.ix = String(this.cardByNode.size);
      this.cardByNode.set(n.id, el);
      this.focusables.set(n.id, el);
      if (n.ghost) {
        el.title = 'Context: one level beyond the current depth. Click to include it.';
        const plus = h('span', n.level > 0 ? 'amc-plus amc-plus-r' : 'amc-plus amc-plus-l');
        plus.append(this.sprite.icon('plus', 11));
        el.append(plus);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = this.ctx.view.get().traceDepth;
          this.ctx.view.set({
            traceDepth:
              n.level > 0
                ? { upstream: d.upstream, downstream: Math.min(MAX_DEPTH, d.downstream + 1) }
                : { upstream: Math.min(MAX_DEPTH, d.upstream + 1), downstream: d.downstream },
          });
        });
      } else {
        el.title = 'Click to inspect, double-click to trace from here';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.vp.lastDragMoved) return;
          this.open(n.id);
        });
        el.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const kind = this.ctx.port.snapshot().graph.nodes.get(n.id)?.kind;
          this.ctx.view.set({
            traceRootId: n.id,
            selectedId: n.id,
            traceDepth: defaultDepth(kind),
          });
        });
      }
      this.nodes.append(el);
    }
    const cycles = backEdgeLanes(vm);
    for (const e of vm.edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) continue;
      const lane = cycles.laneOf.get(e.id) ?? 0;
      const runY = lay.maxY + 34 + lane * LANE_STEP;
      const d = e.back
        ? pathBack(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2, runY)
        : pathFwd(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2);
      const els = drawEdge(
        this.svg,
        d,
        e.kind === 'more' ? { ...e, kind: 'starts' } : e,
        this.markers,
        e.ghost ? 'amc-e-ghosted' : '',
        {
          x: b.x - 22,
          y: b.y + b.h / 2 - 6,
        },
      );
      if (e.back && cycles.labelled.has(e.id)) {
        const t = s(
          'text',
          { x: (a.x + a.w + b.x) / 2, y: runY - 5, 'text-anchor': 'middle' },
          'amc-elabel',
        );
        t.textContent = e.kind === 'cascades' ? '↻ possible loop' : '↻ cycle';
        this.svg.append(t);
        els.push(t);
      }
    }
    this.svg.setAttribute('width', String(lay.maxX + 400));
    this.svg.setAttribute('height', String(lay.maxY - lay.minY + 400));
    // One tab stop for the whole chart: the last focused card, else the base node.
    const stop = this.focusId && this.focusables.has(this.focusId) ? this.focusId : vm.rootId;
    this.focusId = stop;
    const stopEl = this.focusables.get(stop);
    if (stopEl) stopEl.tabIndex = 0;
  }

  /** Select a node from a click or Enter: opens the inspector and keeps the node clear of it. */
  private open(id: string) {
    this.focusId = id;
    this.ctx.view.set({ selectedId: id, inspectorOpen: true });
    const n = this.vm?.nodes.find((x) => x.id === id);
    if (!n) return;
    const { dx, dy } = this.vp.shiftIntoView({ x: n.x, y: n.y, w: n.w, h: n.h }, 24);
    if (dx !== 0 || dy !== 0) this.vp.flyTo({ x: this.vp.x + dx, y: this.vp.y + dy, z: this.vp.z });
  }

  /** Arrows follow the chart: right = downstream, left = upstream, up/down = within the column. */
  private moveFocus(key: string) {
    const vm = this.vm;
    if (!vm) return;
    const cur = vm.nodes.find((n) => n.id === (this.focusId ?? vm.rootId));
    if (!cur) return;
    const byId = new Map(vm.nodes.map((n) => [n.id, n]));
    const centre = (n: { y: number; h: number }) => n.y + n.h / 2;
    let next: (typeof vm.nodes)[number] | undefined;
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const column = vm.nodes.filter((n) => n.level === cur.level).sort((a, b) => a.y - b.y);
      next = column[column.indexOf(cur) + (key === 'ArrowDown' ? 1 : -1)];
    } else {
      const dir = key === 'ArrowRight' ? 1 : -1;
      const linked = vm.edges
        .filter((e) => (dir > 0 ? e.from === cur.id : e.to === cur.id) && !e.back)
        .map((e) => byId.get(dir > 0 ? e.to : e.from))
        .filter((n): n is NonNullable<typeof n> => !!n);
      const pool = linked.length ? linked : vm.nodes.filter((n) => (n.level - cur.level) * dir > 0);
      next = pool.sort(
        (a, b) =>
          Math.abs(a.level - cur.level) - Math.abs(b.level - cur.level) ||
          Math.abs(centre(a) - centre(cur)) - Math.abs(centre(b) - centre(cur)),
      )[0];
    }
    const el = next ? this.focusables.get(next.id) : undefined;
    if (!next || !el) return;
    for (const f of this.focusables.values()) f.tabIndex = -1;
    el.tabIndex = 0;
    this.focusId = next.id;
    // The selection follows the keyboard, but only an open inspector follows it too.
    if (!next.more && !next.ghost) this.ctx.view.set({ selectedId: next.id });
    el.focus({ preventScroll: true });
    const r = { x: next.x, y: next.y, w: next.w, h: next.h };
    const { dx, dy } = this.vp.shiftIntoView(r, 24);
    if (dx !== 0 || dy !== 0)
      this.vp.flyTo({ x: this.vp.x + dx, y: this.vp.y + dy, z: this.vp.z }, false);
  }

  private drawBar(vm: TraceVM | null) {
    clear(this.bar);
    const state = this.ctx.view.get();
    const graph = this.ctx.port.snapshot().graph;
    const node = state.traceRootId ? graph.nodes.get(state.traceRootId) : undefined;
    const base = h('span', 'amc-tb-base');
    base.append(this.sprite.icon('home', 15), h('span', 'amc-tb-lbl', null, 'Tracing from '));
    if (node) {
      const name = h('span', 'amc-tb-name');
      name.style.color = `var(${KIND_VAR[node.kind]})`;
      name.title = KIND_LABEL[node.kind];
      name.textContent = this.vm?.nodes.find((n) => n.id === node.id)?.item?.title ?? node.label;
      base.append(name);
    }
    this.bar.append(base);
    // Nothing to trace yet: depth, context and re-centring mean nothing, only the way out does.
    if (!vm) {
      this.bar.append(h('span', 'amc-sp'), this.exitButton());
      return;
    }
    const stepper = (label: string, dir: 'upstream' | 'downstream') => {
      const wrap = h('span', 'amc-stepper');
      const set = (delta: number) => {
        const d = this.ctx.view.get().traceDepth;
        const value = Math.max(0, Math.min(MAX_DEPTH, d[dir] + delta));
        if (value === d[dir]) return;
        this.ctx.view.set({ traceDepth: { ...d, [dir]: value } });
      };
      const mk = (name: 'minus' | 'plus', aria: string, delta: number) => {
        const b = h('button', null, { type: 'button', 'aria-label': aria });
        b.append(this.sprite.icon(name, 12));
        b.addEventListener('click', () => set(delta));
        return b;
      };
      wrap.append(
        h('span', 'amc-sl', null, `${label} `),
        mk('minus', `Less ${dir}`, -1),
        h('b', null, null, String(state.traceDepth[dir])),
        mk('plus', `More ${dir}`, 1),
      );
      return wrap;
    };
    this.bar.append(stepper('Upstream', 'upstream'), stepper('Downstream', 'downstream'));
    const check = h('label', 'amc-check');
    const input = h('input', null, { type: 'checkbox' });
    input.checked = this.context;
    input.addEventListener('change', () => {
      this.context = input.checked;
      void this.render();
    });
    check.title = 'Show context';
    check.append(input, h('span', 'amc-check-t', null, ' Show context'));
    this.bar.append(check, h('span', 'amc-sp'));
    if (vm)
      this.bar.append(
        h(
          'span',
          'amc-tcount',
          { title: 'Nodes in this trace' },
          `${vm.shown} node${vm.shown === 1 ? '' : 's'}`,
        ),
      );
    const home = h('button', 'amc-btn', { type: 'button' });
    home.title = 'Re-centre on the base node';
    home.setAttribute('aria-label', 'Re-centre');
    home.append(this.sprite.icon('home', 13), h('span', 'amc-bl', null, ' Re-centre'));
    home.addEventListener('click', () => this.centre(true));
    this.bar.append(home, this.exitButton());
  }

  private exitButton(): HTMLButtonElement {
    const exit = h('button', 'amc-btn', { type: 'button' });
    exit.append(
      document.createTextNode('Exit'),
      h('span', 'amc-bl', null, ' trace'),
      document.createTextNode(' '),
      h('span', 'amc-kbd', null, 'Esc'),
    );
    exit.addEventListener('click', () => this.exit());
    return exit;
  }

  private exit() {
    this.ctx.view.set({ view: 'board', traceRootId: null });
  }

  /** Fit everything if it stays readable, else centre the base node at 30% from the left. */
  private centre(animate: boolean) {
    const lay = this.lay;
    const vm = this.vm;
    if (!lay || !vm) return;
    // Fit what is asked for; the dimmed context ring may run past the edge.
    const core = vm.nodes.filter((n) => !n.ghost);
    const x0 = Math.min(...core.map((n) => n.x));
    const x1 = Math.max(...core.map((n) => n.x + n.w));
    const fitRect = { x: x0 - 60, y: lay.bounds.y, w: x1 - x0 + 120, h: lay.bounds.h };
    const t = this.vp.target(fitRect, 56, 1);
    // Below this the node text drops under ~10px on screen: keep the size and let the user pan.
    if (t.zoom >= FIT_MIN_ZOOM) {
      this.vp.flyTo({ x: t.tx, y: t.ty, z: t.zoom }, animate);
      return;
    }
    const base = vm.nodes.find((n) => n.id === vm.rootId);
    if (!base) return;
    const size = this.vp.size();
    const z = FIT_MIN_ZOOM;
    // 30% from the left, or further right when the upstream columns need the room.
    const upstream = (base.x + base.w / 2 - lay.bounds.x) * z;
    const sx = Math.min(size.w * 0.55, Math.max(size.w * 0.3, upstream + 40));
    // A chart shorter than the view is centred as a whole. A taller one starts at the top (the
    // base sits near it, so the most chart shows) unless that pushes the base out of view.
    const baseY = (base.y + base.h / 2) * z;
    const topAligned = 24 - lay.bounds.y * z;
    const sy =
      lay.bounds.h * z <= size.h - 40
        ? size.h / 2 - (lay.bounds.y + lay.bounds.h / 2) * z
        : baseY + topAligned > 60 && baseY + topAligned < size.h - 60
          ? topAligned
          : size.h / 2 - baseY;
    this.vp.flyTo({ x: sx - (base.x + base.w / 2) * z, y: sy, z }, animate);
  }

  private onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const depth = this.ctx.view.get().traceDepth;
    const bump = (dir: 'upstream' | 'downstream', delta: number) =>
      this.ctx.view.set({
        traceDepth: { ...depth, [dir]: Math.max(0, Math.min(MAX_DEPTH, depth[dir] + delta)) },
      });
    const used = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const card = t instanceof Element ? t.closest('.amc-nd') : null;
    switch (e.key) {
      case 'Enter':
      case ' ': {
        if (!card) return;
        const id = [...this.focusables].find(([, el]) => el === card)?.[0];
        if (!id) return;
        // Chips and context cards act on click; real nodes open the inspector.
        if (this.cardByNode.has(id) && !this.vm?.nodes.find((n) => n.id === id)?.ghost)
          this.open(id);
        else (card as HTMLElement).click();
        return used();
      }
      case 'ArrowRight':
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'ArrowDown':
        if (card) this.moveFocus(e.key);
        else if (t === this.canvas)
          this.focusables.get(this.focusId ?? this.vm?.rootId ?? '')?.focus();
        else return;
        return used();
      case 'Escape':
        this.exit();
        return used();
      case '[':
        bump('downstream', -1);
        return used();
      case ']':
        bump('downstream', 1);
        return used();
      case '{':
        bump('upstream', -1);
        return used();
      case '}':
        bump('upstream', 1);
        return used();
      case '+':
      case '=':
        this.vp.zoomBy(1.25);
        return used();
      case '-':
        this.vp.zoomBy(0.8);
        return used();
      case '0':
        this.centre(true);
        return used();
      default:
    }
  }

  dispose() {
    this.disposed = true;
    for (const off of this.cleanups) off();
    this.vp.dispose();
    this.root.remove();
  }
}

export function createTraceView(container: HTMLElement, ctx: MapUiContext): TraceController {
  return new TraceView(container, ctx);
}

export type { Camera };
