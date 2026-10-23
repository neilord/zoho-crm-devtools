/**
 * Trace flowchart layout with dagre (rankdir LR, ranksep 72, nodesep 14; UX spec §6.8).
 *
 * dagre is the extension's only runtime dependency (MIT, ADR 0026) and is loaded with a dynamic
 * import the first time a trace renders, so the board never pays for it. If the content-script
 * bundler cannot emit a loadable chunk for it, change `loadDagre` to a static import: nothing
 * else depends on the dynamic form.
 *
 * Layers are the trace depths: forward edges carry `minlen = depth difference`, so dagre's rank
 * equals the depth; columns are then snapped to depth so level labels line up. Cycle edges stay
 * out of the dagre input and are drawn by the renderer.
 */
import type { Rect } from './geometry';
import type { TraceNodeVM, TraceVM } from './trace-model';

type DagreModule = typeof import('@dagrejs/dagre');

let cached: Promise<DagreModule> | null = null;
export function loadDagre(): Promise<DagreModule> {
  cached ??= import('@dagrejs/dagre');
  return cached;
}

export const RANK_SEP = 72;
export const NODE_SEP = 14;
/** Vertical gap between the runs of cycle edges drawn under the chart. */
export const LANE_STEP = 16;

/**
 * Cycle edges run under the chart. Edges that span the same pair of columns share one lane (and
 * one "↻" label); a wider span sits lower, so the runs and their labels never cross or overprint.
 */
export function backEdgeLanes(vm: TraceVM): {
  laneOf: ReadonlyMap<string, number>;
  /** Edge ids that carry the label for their lane (one per lane). */
  labelled: ReadonlySet<string>;
  count: number;
} {
  const level = new Map(vm.nodes.map((n) => [n.id, n.level]));
  const spans = new Map<string, { span: number; edges: string[] }>();
  for (const e of vm.edges) {
    if (!e.back) continue;
    const from = level.get(e.from);
    const to = level.get(e.to);
    if (from === undefined || to === undefined) continue;
    const key = `${from}>${to}|${e.kind === 'cascades' ? 'c' : 'd'}`;
    const entry = spans.get(key) ?? { span: Math.abs(from - to), edges: [] };
    entry.edges.push(e.id);
    spans.set(key, entry);
  }
  const ordered = [...spans.entries()].sort(
    (a, b) => a[1].span - b[1].span || (a[0] < b[0] ? -1 : 1),
  );
  const laneOf = new Map<string, number>();
  const labelled = new Set<string>();
  ordered.forEach(([, entry], lane) => {
    for (const id of entry.edges) laneOf.set(id, lane);
    labelled.add(entry.edges[0]);
  });
  return { laneOf, labelled, count: ordered.length };
}

export interface TraceLayout {
  /** Distinct depths, ascending. */
  levels: number[];
  colX: ReadonlyMap<number, number>;
  colW: ReadonlyMap<number, number>;
  bounds: Rect;
  minY: number;
  maxY: number;
  maxX: number;
}

export function layoutTrace(dagre: DagreModule, vm: TraceVM): TraceLayout {
  const g = new dagre.Graph({ directed: true });
  g.setGraph({ rankdir: 'LR', ranksep: RANK_SEP, nodesep: NODE_SEP, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  const byId = new Map<string, TraceNodeVM>(vm.nodes.map((n) => [n.id, n]));
  const floating = vm.nodes.filter((n) => n.more?.kind === 'limit');
  for (const n of vm.nodes)
    if (n.more?.kind !== 'limit') g.setNode(n.id, { width: n.w, height: n.h });
  for (const e of vm.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b || e.back || b.level <= a.level) continue;
    g.setEdge(e.from, e.to, { minlen: b.level - a.level });
  }
  dagre.layout(g);
  for (const n of vm.nodes) {
    if (n.more?.kind === 'limit') continue;
    const p = g.node(n.id);
    n.y = p.y - n.h / 2;
  }

  // Snap columns to depth.
  const levels = [...new Set(vm.nodes.map((n) => n.level))].sort((a, b) => a - b);
  const colW = new Map<number, number>();
  for (const lv of levels)
    colW.set(lv, Math.max(...vm.nodes.filter((n) => n.level === lv).map((n) => n.w)));
  const colX = new Map<number, number>();
  let x = 0;
  for (const lv of levels) {
    colX.set(lv, x);
    x += (colW.get(lv) ?? 0) + RANK_SEP;
  }
  for (const n of vm.nodes) n.x = (colX.get(n.level) ?? 0) + ((colW.get(n.level) ?? n.w) - n.w) / 2;

  let minY = 0;
  let maxY = 0;
  for (const n of vm.nodes) {
    if (n.more?.kind === 'limit') continue;
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + n.h);
  }
  // Truncation chips sit under the last column on their side.
  for (const n of floating) {
    const sameColumn = vm.nodes.filter(
      (o) => o !== n && o.level === n.level && o.more?.kind !== 'limit',
    );
    n.y = sameColumn.length ? Math.max(...sameColumn.map((o) => o.y + o.h)) + 16 : -n.h / 2;
    maxY = Math.max(maxY, n.y + n.h);
    minY = Math.min(minY, n.y);
  }
  const maxX = Math.max(0, x - RANK_SEP);
  const lanes = backEdgeLanes(vm).count;
  return {
    levels,
    colX,
    colW,
    minY,
    maxY,
    maxX,
    bounds: {
      x: -60,
      y: minY - 60,
      w: maxX + 120,
      h: maxY - minY + 140 + Math.max(0, lanes - 1) * LANE_STEP,
    },
  };
}
