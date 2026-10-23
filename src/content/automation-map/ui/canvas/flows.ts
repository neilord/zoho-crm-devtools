/**
 * Module -> module flow curves for the overview tier (UX spec §6.3): one quadratic curve per
 * ordered pair, anchored on the island borders, bowed 14% so A->B and B->A separate, width
 * ~ log(count), amber when both directions exist. No labels on the curves (they collided and sank
 * under islands): hovering an island turns its curves accent and the board shows one card for that
 * island listing every module it writes to and is written from.
 */
import { clear, s } from './dom';
import type { BoardModel } from './model';

export interface FlowLayer {
  /** Elements per island id, for hover highlighting. */
  byIsland: Map<string, SVGElement[]>;
  builtZoom: number;
}

export function renderFlows(svg: SVGElement, model: BoardModel, zoom: number): FlowLayer {
  clear(svg);
  const byIsland = new Map<string, SVGElement[]>();
  const rect = new Map(model.islands.map((I) => [I.id, I]));
  const pairs = new Set(model.flows.map((f) => `${f.from}>${f.to}`));
  const track = (id: string, el: SVGElement) => {
    const list = byIsland.get(id);
    if (list) list.push(el);
    else byIsland.set(id, [el]);
  };
  for (const f of model.flows) {
    const A = rect.get(f.from);
    const B = rect.get(f.to);
    if (!A || !B || A === B) continue;
    const clip = (R: typeof A, tx: number, ty: number): [number, number] => {
      const cx = R.x + R.w / 2;
      const cy = R.y + R.h / 2;
      const dx = tx - cx;
      const dy = ty - cy;
      const k = Math.min(
        Math.abs((R.w / 2 + 14) / (dx || 1e-6)),
        Math.abs((R.h / 2 + 14) / (dy || 1e-6)),
      );
      return [cx + dx * k, cy + dy * k];
    };
    const [ax, ay] = clip(A, B.x + B.w / 2, B.y + B.h / 2);
    const [bx, by] = clip(B, A.x + A.w / 2, A.y + A.h / 2);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const cx = (ax + bx) / 2 - (dy / len) * 0.14 * len;
    const cy = (ay + by) / 2 + (dx / len) * 0.14 * len;
    const both = pairs.has(`${f.to}>${f.from}`);
    const path = s(
      'path',
      {
        d: `M${ax},${ay} Q${cx},${cy} ${bx},${by}`,
        'stroke-width': 1.5 + Math.log2(f.count + 1) * 1.6,
      },
      both ? 'amc-ov amc-loop' : 'amc-ov',
    );
    svg.append(path);
    // Arrowhead near the target end, sized to read at the current zoom.
    const t = 0.94;
    const qx = (1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t * t * bx;
    const qy = (1 - t) ** 2 * ay + 2 * (1 - t) * t * cy + t * t * by;
    const tx = 2 * (1 - t) * (cx - ax) + 2 * t * (bx - cx);
    const ty = 2 * (1 - t) * (cy - ay) + 2 * t * (by - cy);
    const tl = Math.hypot(tx, ty) || 1;
    const size = 5.5 / Math.max(zoom, 0.05);
    const ux = tx / tl;
    const uy = ty / tl;
    const head = s(
      'path',
      {
        d: `M${qx + ux * size},${qy + uy * size} L${qx - ux * size - uy * size * 0.8},${qy - uy * size + ux * size * 0.8} L${qx - ux * size + uy * size * 0.8},${qy - uy * size - ux * size * 0.8} Z`,
      },
      both ? 'amc-ov-head amc-loop' : 'amc-ov-head',
    );
    svg.append(head);
    for (const el of [path, head]) {
      track(A.id, el);
      track(B.id, el);
    }
  }
  return { byIsland, builtZoom: zoom };
}
