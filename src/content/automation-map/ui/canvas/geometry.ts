/**
 * Shared geometry constants and small pure helpers for the board and trace canvases.
 * All sizes are world px at zoom 1 (UX spec §5, §6).
 */

export const LANES = ['entry', 'rules', 'actions', 'resources', 'effects'] as const;
export type LaneId = (typeof LANES)[number];

export const LANE_LABEL: Record<LaneId, string> = {
  entry: 'Entry',
  rules: 'Rules',
  actions: 'Actions',
  resources: 'Resources',
  effects: 'Effects',
};

export const LANE_W: Record<LaneId, number> = {
  // Wide enough for "Field changed: Stage, Closing_Date" on two lines.
  entry: 224,
  rules: 248,
  actions: 196,
  resources: 216,
  effects: 188,
};

export const LANE_GAP = 56;
export const ISLAND_PAD = 20;
export const HEAD_H = 60;
export const LANE_TOP = 92;
export const ISLAND_BOTTOM = 22;
/** Room under an island for the cascade back-edge route. */
export const BACK_ROUTE_H = 26;
/** Narrowest island: the header (avatar, name, counts, hub chips) must not clip. */
export const ISLAND_MIN_W = 640;
/** Wrap a lane into extra sub-columns above this height so islands stay roughly square. */
export const LANE_WRAP_H = 6400;
export const SUBCOLUMN_GAP = 24;

/**
 * Overview titles render at `min(15 / z, 120)` world px above each island with an 8/z (≤40)
 * margin, so the vertical gap must exceed that: 120 × 1.1 line height + 40 + breathing room.
 */
export const TITLE_ZONE_H = 176;
export const ISLAND_GAP_X = 200;
export const ISLAND_GAP_Y = 232;
export const PACK_COLUMNS = 3;
export const MAX_PACK_COLUMNS = 6;

export const NODE_H = {
  // Two title lines and the rule count.
  event: 52,
  button: 44,
  schedule: 44,
  api: 52,
  transition: 44,
  approval: 44,
  rule: 58,
  action: 30,
  function: 44,
  template: 44,
  external: 44,
  field: 30,
  module: 30,
  portal: 30,
} as const;

export const LANE_VGAP: Record<LaneId, number> = {
  entry: 10,
  rules: 10,
  actions: 6,
  resources: 10,
  effects: 8,
};

export const ZOOM_MIN = 0.06;
export const ZOOM_MAX = 2;
/**
 * Below this the world is many screens wide at 1:1. The canvas gets `amc-far`, which drops the
 * world's `will-change: transform` so the compositor rasters at the current scale (see canvas.css).
 */
export const FAR_ZOOM = 0.2;
/** Below this an overview island shows one short count instead of its full summary line. */
export const SPARSE_ZOOM = 0.3;
/** Semantic zoom thresholds with ±HYSTERESIS (UX spec §6.3). */
export const TIER_OVERVIEW_BELOW = 0.42;
export const TIER_DETAIL_FROM = 0.8;
export const TIER_HYSTERESIS = 0.03;

export type Tier = 'overview' | 'compact' | 'detail';

export function nextTier(zoom: number, previous: Tier | null): Tier {
  const h = TIER_HYSTERESIS;
  if (previous === null) {
    if (zoom < TIER_OVERVIEW_BELOW) return 'overview';
    return zoom < TIER_DETAIL_FROM ? 'compact' : 'detail';
  }
  if (zoom < TIER_OVERVIEW_BELOW + (previous === 'overview' ? h : -h)) return 'overview';
  if (zoom < TIER_DETAIL_FROM + (previous === 'detail' ? -h : h)) return 'compact';
  return 'detail';
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

export function unionRects(rects: readonly Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 1, h: 1 };
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Deterministic pseudo-random in [0, 1) for decorative fog geometry; never uses Math.random. */
export function seeded(n: number): number {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Get the value for `key`, creating and storing it first when absent. */
export function ensure<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = make();
    map.set(key, value);
  }
  return value;
}
