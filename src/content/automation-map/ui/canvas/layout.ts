/**
 * Deterministic island layout and packing (UX spec §6.1). Pure geometry: no DOM, no randomness.
 *
 * Lane order and wrapping depend only on the model, so the same graph and filters always give
 * the same pixels. Island anchors come from the *unfiltered* scope (`packIslands`), and filtered
 * contents are laid out inside those anchors, so filtering never moves an island.
 */
import {
  BACK_ROUTE_H,
  ensure,
  HEAD_H,
  ISLAND_BOTTOM,
  ISLAND_GAP_X,
  ISLAND_GAP_Y,
  ISLAND_MIN_W,
  ISLAND_PAD,
  LANE_GAP,
  LANE_TOP,
  LANE_VGAP,
  LANE_W,
  LANE_WRAP_H,
  LANES,
  type LaneId,
  MAX_PACK_COLUMNS,
  NODE_H,
  PACK_COLUMNS,
  type Rect,
  SUBCOLUMN_GAP,
  TITLE_ZONE_H,
} from './geometry';
import type { BoardIsland, BoardItem, BoardModel } from './model';

const naturalCompare = (a: string, b: string): number => {
  const pa = a.split(/(\d+)/);
  const pb = b.split(/(\d+)/);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue;
    if (i % 2) return Number(pa[i]) - Number(pb[i]);
    return pa[i] < pb[i] ? -1 : 1;
  }
  return pa.length - pb.length;
};

const itemHeight = (item: BoardItem): number =>
  NODE_H[item.kind === 'portal' ? 'portal' : item.kind];

/** Orders every lane (two barycenter sweeps for resources) and assigns island-local geometry. */
export function layoutIsland(I: BoardIsland): void {
  const lanes: Record<LaneId, BoardItem[]> = {
    entry: [],
    rules: [],
    actions: [],
    resources: [],
    effects: [],
  };
  for (const item of I.items) lanes[item.lane].push(item);

  const preds = new Map<string, string[]>();
  for (const e of I.edges) {
    if (e.back || e.hover) continue;
    ensure(preds, e.to, () => [] as string[]).push(e.from);
  }
  const pos = new Map<string, number>();
  const bary = (iid: string): number => {
    const list = preds.get(iid);
    if (!list) return Number.POSITIVE_INFINITY;
    let sum = 0;
    let n = 0;
    for (const p of list) {
      const v = pos.get(p);
      if (v !== undefined) {
        sum += v;
        n++;
      }
    }
    return n ? sum / n : Number.POSITIVE_INFINITY;
  };
  const place = (lane: BoardItem[]) => {
    for (const [i, item] of lane.entries()) pos.set(item.iid, i);
  };
  const titleOf = (item: BoardItem) => (item.node?.label ?? item.title).toLowerCase();
  const stable = (a: BoardItem, b: BoardItem) =>
    naturalCompare(a.key, b.key) || naturalCompare(titleOf(a), titleOf(b));

  lanes.entry.sort(
    (a, b) => a.rank - b.rank || naturalCompare(titleOf(a), titleOf(b)) || stable(a, b),
  );
  place(lanes.entry);
  lanes.rules.sort(
    (a, b) => bary(a.iid) - bary(b.iid) || naturalCompare(titleOf(a), titleOf(b)) || stable(a, b),
  );
  place(lanes.rules);
  lanes.actions.sort((a, b) => bary(a.iid) - bary(b.iid) || naturalCompare(a.key, b.key));
  place(lanes.actions);
  for (let sweep = 0; sweep < 2; sweep++) {
    const keyed = lanes.resources.map((item, index) => ({ item, index, b: bary(item.iid) }));
    keyed.sort((a, b) => a.b - b.b || a.index - b.index);
    lanes.resources = keyed.map((k) => k.item);
    place(lanes.resources);
  }
  const effectKey = (item: BoardItem) => (item.kind === 'portal' ? 1 : 0);
  const keyedEffects = lanes.effects.map((item, index) => ({ item, index, b: bary(item.iid) }));
  keyedEffects.sort(
    (a, b) => effectKey(a.item) - effectKey(b.item) || a.b - b.b || a.index - b.index,
  );
  lanes.effects = keyedEffects.map((k) => k.item);

  I.present = LANES.filter((lane) => lanes[lane].length);
  let x = ISLAND_PAD;
  let maxY = LANE_TOP;
  I.laneX = {};
  I.laneCols = {};
  for (const lane of I.present) {
    const items = lanes[lane];
    const gap = LANE_VGAP[lane];
    const total = items.reduce(
      (sum, item) => sum + itemHeight(item) + gap + (item.hub ? 10 : 0),
      0,
    );
    const cols = Math.max(1, Math.ceil(total / LANE_WRAP_H));
    const perCol = Math.ceil(items.length / cols);
    I.laneX[lane] = x;
    I.laneCols[lane] = cols;
    for (let c = 0; c < cols; c++) {
      let y = LANE_TOP;
      for (const item of items.slice(c * perCol, (c + 1) * perCol)) {
        // Hub badges straddle the card's top edge; give them their own room.
        if (item.hub && y > LANE_TOP) y += 10;
        item.col = c;
        item.x = x + c * (LANE_W[lane] + SUBCOLUMN_GAP);
        item.y = y;
        item.w = LANE_W[lane];
        item.h = itemHeight(item);
        y += item.h + gap;
      }
      maxY = Math.max(maxY, y);
    }
    x += cols * LANE_W[lane] + (cols - 1) * SUBCOLUMN_GAP + LANE_GAP;
  }
  I.hasBack = I.edges.some((e) => e.back);
  I.w = Math.max(x - LANE_GAP + ISLAND_PAD, ISLAND_MIN_W);
  I.h = maxY + ISLAND_BOTTOM + (I.hasBack ? BACK_ROUTE_H : 0);
  // An island with nothing in it still needs a header and a body.
  if (!I.present.length) I.h = LANE_TOP + ISLAND_BOTTOM + 40;
}

export interface PackBlock {
  id: string;
  w: number;
  h: number;
  org: boolean;
  /** Descending: more automation first. */
  weight: number;
}

export interface Anchor {
  x: number;
  y: number;
}

/** Aspect (width / height) the packed estate aims for: roughly a landscape screen. */
const TARGET_ASPECT = 1.5;

function packInto(ordered: readonly PackBlock[], columns: number): Map<string, Anchor> {
  const count = Math.max(1, Math.min(columns, ordered.length));
  const colBlocks: PackBlock[][] = Array.from({ length: count }, () => []);
  const colH: number[] = new Array(count).fill(0);
  for (const block of ordered) {
    let c = 0;
    for (let i = 1; i < count; i++) if (colH[i] < colH[c]) c = i;
    colBlocks[c].push(block);
    colH[c] += block.h + ISLAND_GAP_Y;
  }
  const anchors = new Map<string, Anchor>();
  let x = 0;
  for (const col of colBlocks) {
    let y = TITLE_ZONE_H;
    let width = 0;
    for (const block of col) {
      anchors.set(block.id, { x, y });
      y += block.h + ISLAND_GAP_Y;
      width = Math.max(width, block.w);
    }
    x += width + ISLAND_GAP_X;
  }
  return anchors;
}

/**
 * Shortest-column-first packing ordered by volume (Org-wide first). A column is as wide as its
 * widest island, so wrapped lanes can never run into the next column. Three columns suit a
 * typical org; a very tall estate gets more columns so it still fits a landscape screen. The
 * choice depends only on island sizes, so it is stable for a given graph and scope.
 */
export function packBlocks(blocks: readonly PackBlock[], columns?: number): Map<string, Anchor> {
  const ordered = [...blocks].sort(
    (a, b) =>
      (a.org === b.org ? 0 : a.org ? -1 : 1) ||
      b.weight - a.weight ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  if (columns !== undefined) return packInto(ordered, columns);
  let best = packInto(ordered, PACK_COLUMNS);
  let bestScore = Number.POSITIVE_INFINITY;
  for (
    let c = PACK_COLUMNS;
    c <= Math.min(MAX_PACK_COLUMNS, Math.max(PACK_COLUMNS, ordered.length));
    c++
  ) {
    const packed = packInto(ordered, c);
    let w = 0;
    let h = 0;
    for (const block of ordered) {
      const a = packed.get(block.id);
      if (!a) continue;
      w = Math.max(w, a.x + block.w);
      h = Math.max(h, a.y + block.h);
    }
    const score = Math.abs(Math.log(w / Math.max(h, 1) / TARGET_ASPECT));
    // Strictly better only: ties keep fewer columns.
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = packed;
    }
  }
  return best;
}

export const islandWeight = (I: BoardIsland): number =>
  I.stats.rules * 1000 + I.stats.buttons * 10 + I.stats.functions + I.items.length / 1000;

export function blocksOf(
  islands: readonly BoardIsland[],
  weightOf: (I: BoardIsland) => number = islandWeight,
): PackBlock[] {
  return islands.map((I) => ({ id: I.id, w: I.w, h: I.h, org: I.org, weight: weightOf(I) }));
}

/** Teaser hooks: grow an island for decoration, and rank it by its real size, not its preview. */
export interface LayoutHooks {
  adjust?(I: BoardIsland): void;
  weightOf?(I: BoardIsland): number;
}

export interface BoardLayout {
  anchors: ReadonlyMap<string, Anchor>;
  /** World bounds including the title zone above the first row. */
  bounds: Rect;
}

export function boundsOf(islands: readonly BoardIsland[], extra: readonly Rect[] = []): Rect {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  const add = (r: Rect, titleH: number) => {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y - titleH);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  };
  for (const I of islands) add({ x: I.x, y: I.y, w: I.w, h: I.h }, TITLE_ZONE_H);
  for (const r of extra) add(r, TITLE_ZONE_H / 2);
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Lays out every island, then places them at `anchors` (or packs them, together with any
 * `extra` blocks such as teaser fog, when none are given). Returns every resolved anchor.
 */
export function layoutModel(
  model: BoardModel,
  anchors?: ReadonlyMap<string, Anchor>,
  extra: readonly PackBlock[] = [],
  hooks: LayoutHooks = {},
): ReadonlyMap<string, Anchor> {
  for (const I of model.islands) {
    layoutIsland(I);
    hooks.adjust?.(I);
  }
  let resolved: Map<string, Anchor>;
  if (anchors) {
    resolved = new Map(anchors);
    const missing = model.islands.filter((I) => !resolved.has(I.id));
    if (missing.length) {
      // Islands that only exist under some filters get a row below the packed grid.
      const packed = packBlocks(blocksOf(missing));
      let below = 0;
      for (const I of model.islands) below = Math.max(below, (resolved.get(I.id)?.y ?? 0) + I.h);
      for (const [id, a] of packed) resolved.set(id, { x: a.x, y: a.y + below });
    }
  } else {
    resolved = packBlocks([...blocksOf(model.islands, hooks.weightOf), ...extra]);
  }
  for (const I of model.islands) {
    const a = resolved.get(I.id);
    if (a) {
      I.x = a.x;
      I.y = a.y;
    }
  }
  return resolved;
}

export { HEAD_H };
