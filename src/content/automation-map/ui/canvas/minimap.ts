/** Minimap (152x103): islands as rounded rects, the viewport as an accent box, matches as dots. */
import { h } from './dom';
import type { Rect } from './geometry';

export interface MiniRect extends Rect {
  fog?: boolean;
}

export class Minimap {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private t = { k: 1, ox: 0, oy: 0 };
  private dragging = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly onPan: (wx: number, wy: number) => void) {
    this.el = h('div', 'amc-chrome amc-mini', { title: 'Minimap' });
    this.canvas = h('canvas', null, { width: 368, height: 248, 'aria-hidden': 'true' });
    this.el.append(this.canvas);
    const go = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const w = r.width || 152;
      const hh = r.height || 103;
      const sx = ((e.clientX - r.left) / w) * this.canvas.width;
      const sy = ((e.clientY - r.top) / hh) * this.canvas.height;
      this.onPan((sx - this.t.ox) / this.t.k, (sy - this.t.oy) / this.t.k);
    };
    const down = (e: PointerEvent) => {
      this.dragging = true;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Best effort.
      }
      go(e);
    };
    const move = (e: PointerEvent) => {
      if (this.dragging) go(e);
    };
    const up = () => {
      this.dragging = false;
    };
    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.cleanups.push(() => {
      this.canvas.removeEventListener('pointerdown', down);
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
    });
  }

  draw(
    world: Rect,
    rects: readonly MiniRect[],
    view: Rect,
    dots: readonly { x: number; y: number }[],
    selected: { x: number; y: number } | null,
  ) {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = this.canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    const W = this.canvas.width;
    const H = this.canvas.height;
    const k = Math.min(W / world.w, H / world.h) * 0.92;
    const ox = (W - world.w * k) / 2 - world.x * k;
    const oy = (H - world.h * k) / 2 - world.y * k;
    this.t = { k, ox, oy };
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    // Islands are soft, tinted pills (no outlines): the same wash the overview paints inside them.
    for (const r of rects) {
      const w = r.w * k;
      const h = r.h * k;
      ctx.fillStyle = r.fog ? 'rgba(150,170,225,0.2)' : 'rgba(103,118,160,0.24)';
      ctx.beginPath();
      ctx.roundRect(ox + r.x * k, oy + r.y * k, w, h, Math.min(10, w / 2, h / 2));
      ctx.fill();
    }
    for (const d of dots) {
      ctx.fillStyle = 'rgba(224,180,0,0.28)';
      ctx.beginPath();
      ctx.arc(ox + d.x * k, oy + d.y * k, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e0b400';
      ctx.beginPath();
      ctx.arc(ox + d.x * k, oy + d.y * k, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (selected) {
      ctx.fillStyle = 'rgba(47,109,240,0.25)';
      ctx.beginPath();
      ctx.arc(ox + selected.x * k, oy + selected.y * k, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2f6df0';
      ctx.beginPath();
      ctx.arc(ox + selected.x * k, oy + selected.y * k, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // The viewport: a rounded, softly lit window onto the map.
    const vx = ox + view.x * k;
    const vy = oy + view.y * k;
    const vw = view.w * k;
    const vh = view.h * k;
    ctx.save();
    ctx.shadowColor = 'rgba(47,109,240,0.35)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(47,109,240,0.1)';
    ctx.beginPath();
    ctx.roundRect(vx, vy, vw, vh, Math.min(8, vw / 2, vh / 2));
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(47,109,240,0.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  dispose() {
    for (const off of this.cleanups) off();
  }
}
