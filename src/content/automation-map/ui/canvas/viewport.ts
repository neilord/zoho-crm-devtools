/**
 * Pan/zoom camera for the board and the trace canvas. Screen = world * z + (x, y).
 * Writes one `transform` and a few CSS variables per change; everything else (culling, tiers,
 * store write-back) is the owner's job, driven by `onChange`.
 */
import type { Camera } from '../context';
import { reducedMotion } from './dom';
import { clamp, FAR_ZOOM, type Rect, SPARSE_ZOOM, ZOOM_MAX, ZOOM_MIN } from './geometry';

const FALLBACK_SIZE = { w: 1280, h: 800 };
/** The grid element overhangs the canvas by this much so a translate never exposes its edge (> 24 * max zoom). */
const GRID_BLEED = 64;
/** `--z` follows a zoom gesture in steps of this many e-folds (~10%), then lands exactly. */
const Z_STEP = 0.1;
const Z_SETTLE_MS = 120;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export interface ViewportOptions {
  min?: number;
  max?: number;
  grid?: boolean;
  onChange?: (vp: Viewport) => void;
  /** Width at the right edge that an overlay (the inspector) covers; fly-to centres in the rest. */
  safeRight?: () => number;
  /** Height at the top edge that chrome (the gap banner, the trace bar) covers. */
  safeTop?: () => number;
  /** Screen rects (canvas coordinates) that floating chrome covers, e.g. the minimap and zoom bar. */
  avoid?: () => readonly Rect[];
  /** Elements that own pointer input; dragging starts only from empty canvas (or with Space). */
  isInteractive?: (target: Element) => boolean;
  /** The user moved the camera by hand. */
  onUserMove?: () => void;
  /** World y of the topmost island (its overview title sits just above); lets a button zoom keep it clear of the banner. */
  contentTop?: () => number | null;
}

/** Button and keyboard zoom steps glide over this long; wheel and pinch stay immediate. */
const ZOOM_GLIDE_MS = 200;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

export class Viewport {
  x = 0;
  y = 0;
  z = 1;
  /** Space held: drag pans even over nodes. */
  spaceHeld = false;
  lastDragMoved = false;
  private anim = 0;
  private zoomAnim = 0;
  private zoomSettle = 0;
  private zooming = false;
  private zWritten = 0;
  private lastZ = Number.NaN;
  private measured: { w: number; h: number } | null = null;
  private readonly grid: HTMLElement;
  /** Where a gliding button zoom is headed; null at rest. */
  private zoomGoal: { z: number; x: number; y: number } | null = null;
  private readonly min: number;
  private readonly max: number;
  private readonly cleanups: Array<() => void> = [];
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; z: number } | null = null;

  constructor(
    readonly canvas: HTMLElement,
    readonly world: HTMLElement,
    private readonly opts: ViewportOptions = {},
  ) {
    this.min = opts.min ?? ZOOM_MIN;
    this.max = opts.max ?? ZOOM_MAX;
    this.grid = document.createElement('div');
    this.grid.className = 'amc-grid';
    this.grid.setAttribute('aria-hidden', 'true');
    canvas.insertBefore(this.grid, canvas.firstChild);
    this.watchSize();
    this.bind();
  }

  /**
   * The canvas size, measured once and kept until it resizes: reading a rect after the camera
   * wrote forces a style recalc on every frame of a pan or a fly-to.
   */
  size(): { w: number; h: number } {
    if (this.measured) return this.measured;
    const r = this.canvas.getBoundingClientRect();
    let size = FALLBACK_SIZE;
    if (r.width > 0 && r.height > 0) size = { w: r.width, h: r.height };
    else {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (w > 0 && h > 0) size = { w, h };
      else return size;
    }
    if (this.sizeObserver) this.measured = size;
    return size;
  }

  private sizeObserver: ResizeObserver | null = null;
  private watchSize() {
    if (typeof ResizeObserver !== 'function') return;
    this.sizeObserver = new ResizeObserver(() => {
      this.measured = null;
    });
    this.sizeObserver.observe(this.canvas);
  }

  private safe(): number {
    return Math.max(0, Math.min(this.opts.safeRight?.() ?? 0, this.size().w * 0.6));
  }

  /** Width the right overlay (the inspector) covers right now. */
  safeRightPx(): number {
    return this.safe();
  }

  /** Height the top chrome covers; never more than a third of the canvas. */
  private safeTop(): number {
    return Math.max(0, Math.min(this.opts.safeTop?.() ?? 0, this.size().h / 3));
  }

  /** Height the top chrome (gap banner, trace bar) covers right now. */
  safeTopPx(): number {
    return this.safeTop();
  }

  /**
   * Horizontal and vertical pan (screen px) that moves a world rect out from under the right
   * inspector and the top chrome. Zero on an axis that is already clear; when the rect is larger
   * than the free area its top-left corner wins.
   */
  shiftIntoView(rect: Rect, pad = 24): { dx: number; dy: number } {
    const { w, h } = this.size();
    const left = rect.x * this.z + this.x;
    const top = rect.y * this.z + this.y;
    const right = left + rect.w * this.z;
    const bottom = top + rect.h * this.z;
    const maxRight = w - this.safe() - pad;
    const minTop = this.safeTop() + pad;
    let dx = 0;
    let dy = 0;
    if (right > maxRight) dx = maxRight - right;
    if (left + dx < pad) dx = pad - left;
    if (top < minTop) dy = minTop - top;
    else if (bottom > h - pad) dy = Math.max(h - pad - bottom, minTop - top);
    // Floating chrome in the corner: slide the rect up out from under it when there is room above,
    // otherwise to its right.
    let l = left + dx;
    let t = top + dy;
    const r = () => l + rect.w * this.z;
    const b = () => t + rect.h * this.z;
    for (const a of this.opts.avoid?.() ?? []) {
      if (!(l < a.x + a.w && r() > a.x && t < a.y + a.h && b() > a.y)) continue;
      const up = b() - a.y + pad;
      if (t - up >= minTop) {
        t -= up;
        dy -= up;
      } else {
        const right = a.x + a.w - l + pad;
        if (r() + right <= maxRight) {
          l += right;
          dx += right;
        }
      }
    }
    return { dx, dy };
  }

  apply() {
    this.world.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) scale(${this.z})`;
    if (this.z !== this.lastZ) {
      this.lastZ = this.z;
      this.publishZoom();
    }
    // The dot grid is its own element and a pure translate while panning; nothing the whole
    // subtree inherits is written per pan frame.
    const gs = 24 * this.z;
    this.grid.style.transform = `translate3d(${this.x % gs}px, ${this.y % gs}px, 0)`;
    this.opts.onChange?.(this);
  }

  /**
   * Zoom-dependent state, written only when the zoom moved. `--z` drives counter-scaled text, and
   * any write to it restyles and re-lays-out every label under the world, so it follows the
   * gesture in coarse steps and lands exactly once the zoom settles. The grid is a childless
   * element, so its variables are cheap.
   */
  private publishZoom() {
    const z = this.z;
    const g = this.grid.style;
    const gs = 24 * z;
    g.setProperty('--gs', `${gs}px`);
    g.setProperty('--gp', `${GRID_BLEED % gs}px`);
    // The dot grid dissolves between 15% and 40% zoom instead of switching off.
    g.setProperty('--ga', clamp((z - 0.15) / 0.25, 0, 1).toFixed(3));
    this.canvas.classList.toggle('amc-nogrid', this.opts.grid === false || z < 0.15);
    this.canvas.classList.toggle('amc-far', z < FAR_ZOOM);
    this.canvas.classList.toggle('amc-sparse', z < SPARSE_ZOOM);
    // While the zoom moves, the canvas drops its costliest paint (soft shadows): every frame of a
    // zoom re-rasters the world at the new scale.
    if (!this.zooming) {
      this.zooming = true;
      this.canvas.classList.add('amc-zooming');
    }
    window.clearTimeout(this.zoomSettle);
    this.zoomSettle = window.setTimeout(() => this.settleZoom(), Z_SETTLE_MS);
    if (this.zWritten === 0 || Math.abs(Math.log(z / this.zWritten)) >= Z_STEP) this.writeZ();
  }

  private writeZ() {
    this.zWritten = this.z;
    this.world.style.setProperty('--z', String(this.z));
  }

  private settleZoom() {
    this.zoomSettle = 0;
    if (this.zooming) {
      this.zooming = false;
      this.canvas.classList.remove('amc-zooming');
    }
    if (this.zWritten !== this.z) this.writeZ();
  }

  /** World rectangle currently on screen. */
  view(): Rect {
    const { w, h } = this.size();
    return { x: -this.x / this.z, y: -this.y / this.z, w: w / this.z, h: h / this.z };
  }

  camera(): Camera {
    return { x: -this.x / this.z, y: -this.y / this.z, zoom: this.z };
  }

  setCamera(c: Camera) {
    this.endZoomGlide();
    cancelAnimationFrame(this.anim);
    const zoom = clamp(c.zoom, this.min, this.max);
    this.z = zoom;
    this.x = -c.x * zoom;
    this.y = -c.y * zoom;
    this.apply();
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const nz = clamp(this.z * factor, this.min, this.max);
    const k = nz / this.z;
    this.x = sx - (sx - this.x) * k;
    this.y = sy - (sy - this.y) * k;
    this.z = nz;
    this.apply();
  }

  /** The zoom a button press is gliding to (the current zoom at rest). */
  goalZoom(): number {
    return this.zoomGoal?.z ?? this.z;
  }

  /** Jump a gliding button zoom to its end state. */
  private endZoomGlide() {
    cancelAnimationFrame(this.zoomAnim);
    const goal = this.zoomGoal;
    if (!goal) return;
    this.zoomGoal = null;
    this.z = goal.z;
    this.x = goal.x;
    this.y = goal.y;
    this.apply();
  }

  /**
   * Button and keyboard zoom: a short ease toward the target, compounding when pressed again
   * mid-glide. Anchored on the centre of the free area; when the whole top of the content was
   * clear of the banner, it stays clear (zooming in about the centre would slide it underneath).
   */
  zoomBy(factor: number) {
    const { w, h } = this.size();
    const top = this.safeTop();
    cancelAnimationFrame(this.anim);
    const sx = (w - this.safe()) / 2;
    const sy = top + (h - top) / 2;
    const base = this.zoomGoal ?? { z: this.z, x: this.x, y: this.y };
    const nz = clamp(base.z * factor, this.min, this.max);
    const k = nz / base.z;
    const goal = { z: nz, x: sx - (sx - base.x) * k, y: sy - (sy - base.y) * k };
    const contentTop = this.opts.contentTop?.();
    if (contentTop != null) {
      const pad = 16;
      // The overview title sits 26 screen px above the island.
      const wasClear = contentTop * base.z - 26 + base.y >= top + pad - 0.5;
      const now = contentTop * goal.z - 26 + goal.y;
      if (wasClear && now < top + pad) goal.y += top + pad - now;
    }
    this.opts.onUserMove?.();
    cancelAnimationFrame(this.zoomAnim);
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') {
      this.zoomGoal = null;
      this.z = goal.z;
      this.x = goal.x;
      this.y = goal.y;
      this.apply();
      return;
    }
    const from = { z: this.z, x: this.x, y: this.y };
    this.zoomGoal = goal;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = clamp((now - t0) / ZOOM_GLIDE_MS, 0, 1);
      if (p >= 1) {
        this.endZoomGlide();
        return;
      }
      const e = easeOut(p);
      this.z = Math.exp(Math.log(from.z) + (Math.log(goal.z) - Math.log(from.z)) * e);
      this.x = from.x + (goal.x - from.x) * e;
      this.y = from.y + (goal.y - from.y) * e;
      this.apply();
      this.zoomAnim = requestAnimationFrame(step);
    };
    this.zoomAnim = requestAnimationFrame(step);
  }

  panBy(dx: number, dy: number) {
    if (this.zoomGoal) this.endZoomGlide();
    this.x += dx;
    this.y += dy;
    this.apply();
  }

  /** Transform that frames `rect` with padding, centred in the area the inspector leaves free. */
  target(
    rect: Rect,
    pad = 64,
    maxZ = 1.1,
    reserve: { bottom?: number; left?: number } = {},
  ): Camera & { tx: number; ty: number } {
    const { w, h } = this.size();
    const vw = w - this.safe() - (reserve.left ?? 0);
    const vh = h - this.safeTop() - (reserve.bottom ?? 0);
    const z = clamp(
      Math.min((vw - pad * 2) / Math.max(rect.w, 1), (vh - pad * 2) / Math.max(rect.h, 1), maxZ),
      this.min,
      this.max,
    );
    return this.place(rect, z, pad, reserve);
  }

  /**
   * Where `rect` sits at zoom `z`: centred in the area the banner, the inspector and `reserve`
   * leave free. An axis that does not fit (the zoom floor stops a very large estate from
   * shrinking further) starts at its leading edge instead: centring would push its first row
   * under the banner and its last under the corner chrome.
   */
  place(
    rect: Rect,
    z: number,
    pad = 64,
    reserve: { bottom?: number; left?: number } = {},
  ): Camera & { tx: number; ty: number } {
    const { w, h } = this.size();
    const left = reserve.left ?? 0;
    const vw = w - this.safe() - left;
    const top = this.safeTop();
    const vh = h - top - (reserve.bottom ?? 0);
    const fitsX = rect.w * z <= vw - pad * 2 + 0.5;
    const fitsY = rect.h * z <= vh - pad * 2 + 0.5;
    const tx = fitsX ? left + vw / 2 - (rect.x + rect.w / 2) * z : left + pad - rect.x * z;
    const ty = fitsY ? top + vh / 2 - (rect.y + rect.h / 2) * z : top + pad - rect.y * z;
    return { x: -tx / z, y: -ty / z, zoom: z, tx, ty };
  }

  fit(
    rect: Rect,
    pad = 48,
    maxZ = 1,
    animate = true,
    reserve: { bottom?: number; left?: number } = {},
  ) {
    const t = this.target(rect, pad, maxZ, reserve);
    this.flyTo({ x: t.tx, y: t.ty, z: t.zoom }, animate);
  }

  centerOn(wx: number, wy: number, z = this.z, animate = true) {
    const { w, h } = this.size();
    const vw = w - this.safe();
    const top = this.safeTop();
    const nz = clamp(z, this.min, this.max);
    this.flyTo({ x: vw / 2 - wx * nz, y: top + (h - top) / 2 - wy * nz, z: nz }, animate);
  }

  flyTo(t: { x: number; y: number; z: number }, animate = true) {
    this.endZoomGlide();
    cancelAnimationFrame(this.anim);
    if (!animate || reducedMotion()) {
      this.x = t.x;
      this.y = t.y;
      this.z = t.z;
      this.apply();
      return;
    }
    const { w, h } = this.size();
    const vw = w - this.safe();
    const top = this.safeTop();
    const midY = top + (h - top) / 2;
    const from = { x: this.x, y: this.y, z: this.z };
    const c0 = { x: (vw / 2 - from.x) / from.z, y: (midY - from.y) / from.z };
    const c1 = { x: (vw / 2 - t.x) / t.z, y: (midY - t.y) / t.z };
    const distance = Math.hypot(c1.x - c0.x, c1.y - c0.y) * Math.min(from.z, t.z);
    // Far flights zoom out to see both ends, then in (UX spec §6.7).
    const arc = distance > vw * 1.5;
    const duration = arc ? 620 : 420;
    const zMid = arc
      ? Math.min(
          from.z,
          t.z,
          (vw * 0.9) / (Math.abs(c1.x - c0.x) + (vw / Math.min(from.z, t.z)) * 0.6),
        )
      : 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = clamp((now - t0) / duration, 0, 1);
      const e = ease(p);
      let z = Math.exp(Math.log(from.z) + (Math.log(t.z) - Math.log(from.z)) * e);
      if (arc && zMid > 0) {
        const bump = Math.sin(Math.PI * p);
        z = Math.exp(Math.log(z) + (Math.log(zMid) - Math.log(Math.max(z, zMid))) * bump * 0.9);
      }
      const cx = c0.x + (c1.x - c0.x) * e;
      const cy = c0.y + (c1.y - c0.y) * e;
      this.z = clamp(z, this.min, this.max);
      this.x = vw / 2 - cx * this.z;
      this.y = midY - cy * this.z;
      if (p < 1) {
        this.apply();
        this.anim = requestAnimationFrame(step);
      } else {
        this.x = t.x;
        this.y = t.y;
        this.z = t.z;
        this.apply();
      }
    };
    this.anim = requestAnimationFrame(step);
  }

  stop() {
    this.endZoomGlide();
    cancelAnimationFrame(this.anim);
  }

  dispose() {
    window.clearTimeout(this.zoomSettle);
    this.sizeObserver?.disconnect();
    cancelAnimationFrame(this.zoomAnim);
    cancelAnimationFrame(this.anim);
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
  }

  private listen<K extends keyof HTMLElementEventMap>(
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) {
    this.canvas.addEventListener(type, fn as EventListener, options);
    this.cleanups.push(() => this.canvas.removeEventListener(type, fn as EventListener, options));
  }

  private bind() {
    const c = this.canvas;
    this.listen(
      'wheel',
      (e) => {
        e.preventDefault();
        this.endZoomGlide();
        cancelAnimationFrame(this.anim);
        this.opts.onUserMove?.();
        const r = c.getBoundingClientRect();
        const line = e.deltaMode ? 20 : 1;
        if (e.ctrlKey || e.metaKey) {
          // Trackpad pinch arrives as ctrl+wheel with small deltas.
          this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * line * 0.0015));
        } else if (e.shiftKey && !e.deltaX) {
          this.panBy(-e.deltaY * line, 0);
        } else {
          this.panBy(-e.deltaX * line, -e.deltaY * line);
        }
      },
      { passive: false },
    );

    const pinchStart = () => {
      const pts = [...this.pointers.values()];
      if (pts.length < 2) {
        this.pinch = null;
        return;
      }
      this.pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, z: this.z };
    };
    this.listen('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target && this.opts.isInteractive?.(target) && !this.spaceHeld && e.button === 0) return;
      this.endZoomGlide();
      cancelAnimationFrame(this.anim);
      const id = e.pointerId ?? 0;
      this.pointers.set(id, { x: e.clientX, y: e.clientY });
      this.lastDragMoved = false;
      try {
        c.setPointerCapture(id);
      } catch {
        // Capture is best effort (synthetic events, detached nodes).
      }
      c.classList.add('amc-panning');
      if (this.pointers.size === 2) pinchStart();
    });
    this.listen('pointermove', (e) => {
      const id = e.pointerId ?? 0;
      const prev = this.pointers.get(id);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(id, { x: e.clientX, y: e.clientY });
      if (this.pointers.size >= 2 && this.pinch) {
        const pts = [...this.pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const r = c.getBoundingClientRect();
        const mx = (pts[0].x + pts[1].x) / 2 - r.left;
        const my = (pts[0].y + pts[1].y) / 2 - r.top;
        this.zoomAt(mx, my, (this.pinch.z * (dist / this.pinch.dist)) / this.z);
        this.panBy(dx / 2, dy / 2);
        this.lastDragMoved = true;
        this.opts.onUserMove?.();
        return;
      }
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        if (!this.lastDragMoved && Math.abs(dx) + Math.abs(dy) < 2) return;
        this.lastDragMoved = true;
        this.opts.onUserMove?.();
        this.panBy(dx, dy);
      }
    });
    const end = (e: PointerEvent) => {
      const id = e.pointerId ?? 0;
      if (!this.pointers.delete(id)) return;
      this.pinch = null;
      // Lifting either finger leaves a pan gesture, not a one-point pinch.
      if (this.pointers.size >= 2) pinchStart();
      if (!this.pointers.size) c.classList.remove('amc-panning');
      try {
        c.releasePointerCapture(id);
      } catch {
        // See setPointerCapture.
      }
    };
    this.listen('pointerup', end);
    this.listen('pointercancel', end);
    this.listen('dblclick', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target && this.opts.isInteractive?.(target)) return;
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const nz = clamp(this.z * 2, this.min, this.max);
      const k = nz / this.z;
      this.opts.onUserMove?.();
      this.flyTo({ x: sx - (sx - this.x) * k, y: sy - (sy - this.y) * k, z: nz });
    });
  }
}
