/**
 * Pure trace view-model (UX spec §6.8): turns a `TraceResult` into layered columns with a dimmed
 * context ring, fan-out "+N more" chips and a truncation chip. No DOM, no dagre.
 */
import type {
  AutomationGraph,
  EdgeEvidence,
  MapEdge,
  MapNode,
  MapNodeId,
  TraceResult,
} from '../../types';
import { ensure, NODE_H } from './geometry';
import { type BoardItem, describeNode } from './model';

export const TRACE_FAN_OUT = 6;
const GHOST_FAN_OUT = 3;

export const TRACE_W: Record<string, number> = {
  event: 232,
  button: 200,
  schedule: 200,
  api: 232,
  transition: 200,
  approval: 200,
  rule: 248,
  action: 200,
  function: 216,
  template: 216,
  external: 216,
  field: 188,
  module: 188,
};
export const MORE_W = 128;
export const MORE_H = 34;

export interface TraceNodeVM {
  id: string;
  /** Depth layer: negative upstream, 0 root, positive downstream. */
  level: number;
  /** One hop beyond the depth limit: dimmed, with a "+" to include it. */
  ghost: boolean;
  item: BoardItem | null;
  more: { count: number; key: string; kind: 'fanout' | 'limit'; dir: 'up' | 'down' } | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TraceEdgeVM {
  id: string;
  from: string;
  to: string;
  kind: MapEdge['kind'] | 'more';
  evidence: EdgeEvidence;
  confidence: MapEdge['confidence'];
  ghost: boolean;
  /** Target is not deeper than the source: a cycle, drawn under the chart. */
  back: boolean;
}

export interface TraceVM {
  rootId: MapNodeId;
  nodes: TraceNodeVM[];
  edges: TraceEdgeVM[];
  /** Shown nodes, excluding the context ring and chips. */
  shown: number;
}

export interface TraceBuildOptions {
  up: number;
  down: number;
  context: boolean;
  /** Fan-out groups the user expanded: `${nodeId}>` (down) or `${nodeId}<` (up). */
  expanded: ReadonlySet<string>;
  /** Teaser only: names of every module except `keep` are withheld. */
  redact?: { keep: string | null };
}

export function traceItem(
  graph: AutomationGraph,
  node: MapNode,
  redact?: { keep: string | null },
): BoardItem | null {
  const moduleLabel = (api: string | null) => {
    if (!api) return 'Org-wide';
    // Teaser: every module but the revealed one is locked and stays unnamed.
    if (redact && api !== redact.keep) return 'Locked module';
    return graph.nodes.get(`module:${api}`)?.label ?? api;
  };
  const item = describeNode(node, {
    islandId: 'trace',
    islandLabel: moduleLabel(node.moduleApiName),
    moduleLabel,
  });
  if (!item) return null;
  if (node.kind === 'field' && node.bucket === 'field') {
    item.title = `${moduleLabel(node.moduleApiName)} · ${node.label}`;
  } else if (node.kind === 'action') {
    const owner = graph.nodes.get(node.ownerId);
    if (owner) item.subtitle = `${item.subtitle} · ${owner.label}`;
  }
  return item;
}

/**
 * One layer per node: its nearest distance from the root, downstream or upstream. `result.depth`
 * gives upstream precedence (it is walked first), so a node on a cycle always lands upstream and a
 * trace through a field that its own reactors write back never shows a downstream column. Walking
 * the traced edges both ways again lets the nearer side win, and downstream win a tie.
 */
export function traceLayers(
  result: TraceResult,
  limits: { up: number; down: number },
): ReadonlyMap<string, number> {
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const e of result.edges) {
    ensure(forward, e.from, () => [] as string[]).push(e.to);
    ensure(backward, e.to, () => [] as string[]).push(e.from);
  }
  const walk = (adjacency: ReadonlyMap<string, string[]>, limit: number) => {
    const dist = new Map<string, number>([[result.rootId, 0]]);
    const queue = [result.rootId];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      const d = dist.get(id) ?? 0;
      if (d >= limit) continue;
      for (const next of adjacency.get(id) ?? [])
        if (!dist.has(next)) {
          dist.set(next, d + 1);
          queue.push(next);
        }
    }
    return dist;
  };
  const down = walk(forward, limits.down);
  const up = walk(backward, limits.up);
  const layers = new Map<string, number>();
  for (const id of result.nodeIds) {
    const df = down.get(id);
    const db = up.get(id);
    if (df !== undefined && (db === undefined || df <= db)) layers.set(id, df);
    else if (db !== undefined) layers.set(id, -db);
    else layers.set(id, result.depth.get(id) ?? 0);
  }
  return layers;
}

export function buildTraceModel(
  graph: AutomationGraph,
  result: TraceResult,
  options: TraceBuildOptions,
): TraceVM {
  const context = options.context ? 1 : 0;
  const layers = traceLayers(result, { up: options.up + context, down: options.down + context });
  const level = (id: string) => layers.get(id) ?? 0;
  const isGhost = (id: string) =>
    options.context && (level(id) > options.down || level(id) < -options.up);
  const present = new Set(result.nodeIds);
  let edges = result.edges.filter((e) => present.has(e.from) && present.has(e.to));
  const dropped = new Set<string>();
  const chips: TraceNodeVM[] = [];
  const chipEdges: TraceEdgeVM[] = [];

  // Fan-out cap: more than 6 neighbours in one direction shows 5 and a "+N more" chip.
  for (const id of [...present].sort()) {
    const lv = level(id);
    const ghostNode = isGhost(id);
    for (const dir of ['down', 'up'] as const) {
      const key = `${id}${dir === 'down' ? '>' : '<'}`;
      const group = edges.filter((e) =>
        dir === 'down' ? e.from === id && level(e.to) > lv : e.to === id && level(e.from) < lv,
      );
      const neighbour = (e: MapEdge) => (dir === 'down' ? e.to : e.from);
      const real = group.filter((e) => !isGhost(neighbour(e)));
      const ghosts = group.filter((e) => isGhost(neighbour(e)));
      for (const e of ghosts.slice(GHOST_FAN_OUT)) dropped.add(e.id);
      if (ghostNode || real.length <= TRACE_FAN_OUT || options.expanded.has(key)) continue;
      const hidden = real.slice(TRACE_FAN_OUT - 1);
      for (const e of hidden) dropped.add(e.id);
      const chipId = `more:${key}`;
      const chipLevel = lv + (dir === 'down' ? 1 : -1);
      chips.push({
        id: chipId,
        level: chipLevel,
        ghost: false,
        item: null,
        more: { count: new Set(hidden.map((e) => neighbour(e))).size, key, kind: 'fanout', dir },
        x: 0,
        y: 0,
        w: MORE_W,
        h: MORE_H,
      });
      chipEdges.push({
        id: `${chipId}:edge`,
        from: dir === 'down' ? id : chipId,
        to: dir === 'down' ? chipId : id,
        kind: 'more',
        evidence: 'declared',
        confidence: null,
        ghost: false,
        back: false,
      });
    }
  }
  edges = edges.filter((e) => !dropped.has(e.id));

  // Drop nodes that only the capped-out edges connected to the trace. Connectivity ignores edge
  // direction: a node on a cycle can sit at its upstream depth yet lead on to downstream nodes.
  const adjacent = new Map<string, string[]>();
  for (const e of edges) {
    ensure(adjacent, e.from, () => [] as string[]).push(e.to);
    ensure(adjacent, e.to, () => [] as string[]).push(e.from);
  }
  const reach = new Set<string>([result.rootId]);
  const queue = [result.rootId];
  for (let i = 0; i < queue.length; i++)
    for (const next of adjacent.get(queue[i]) ?? [])
      if (!reach.has(next)) {
        reach.add(next);
        queue.push(next);
      }
  edges = edges.filter((e) => reach.has(e.from) && reach.has(e.to));

  // A context node stands one hop beyond the depth, next to the node that leads to it. When its
  // only links reach across the chart (its neighbour sits in the other half of a cycle), it is not
  // a frontier neighbour: leave it out rather than draw it as a faint line over everything.
  const span = (e: MapEdge) => Math.abs(level(e.to) - level(e.from));
  for (const id of [...reach]) {
    if (!isGhost(id)) continue;
    const incident = edges.filter((e) => e.from === id || e.to === id);
    if (incident.length && incident.every((e) => span(e) > 1)) reach.delete(id);
  }
  edges = edges.filter((e) => reach.has(e.from) && reach.has(e.to));

  const nodes: TraceNodeVM[] = [];
  for (const id of [...reach].sort((a, b) => level(a) - level(b) || (a < b ? -1 : a > b ? 1 : 0))) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const item = traceItem(graph, node, options.redact);
    if (!item) continue;
    nodes.push({
      id,
      level: level(id),
      ghost: isGhost(id),
      item,
      more: null,
      x: 0,
      y: 0,
      w: TRACE_W[node.kind] ?? 216,
      h: NODE_H[node.kind === 'module' ? 'module' : node.kind] ?? 44,
    });
  }
  const shownIds = new Set(nodes.map((n) => n.id));
  for (const c of chips) {
    const parentId =
      c.more?.dir === 'down'
        ? chipEdges.find((e) => e.to === c.id)?.from
        : chipEdges.find((e) => e.from === c.id)?.to;
    if (parentId && shownIds.has(parentId)) nodes.push(c);
  }
  const keptChips = new Set(nodes.filter((n) => n.more).map((n) => n.id));

  // Hard-cap truncation: floating chip one column beyond the outermost column on that side.
  const maxLevel = Math.max(0, ...nodes.map((n) => n.level));
  const minLevel = Math.min(0, ...nodes.map((n) => n.level));
  for (const dir of ['down', 'up'] as const) {
    const count = dir === 'down' ? result.truncated.downstream : result.truncated.upstream;
    if (count <= 0) continue;
    nodes.push({
      id: `more:limit:${dir}`,
      level: dir === 'down' ? maxLevel + 1 : minLevel - 1,
      ghost: false,
      item: null,
      more: { count, key: `limit:${dir}`, kind: 'limit', dir },
      x: 0,
      y: 0,
      w: MORE_W,
      h: MORE_H,
    });
  }

  // A ghost with a short link keeps it and drops its long ones: no faint line crosses the chart.
  const drawn = edges.filter((e) => !(isGhost(e.from) || isGhost(e.to)) || span(e) <= 1);
  const vmEdges: TraceEdgeVM[] = drawn.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    kind: e.kind,
    evidence: e.evidence,
    confidence: e.confidence,
    ghost: isGhost(e.from) || isGhost(e.to),
    back: level(e.to) <= level(e.from),
  }));
  for (const ce of chipEdges) if (keptChips.has(ce.from) || keptChips.has(ce.to)) vmEdges.push(ce);
  return {
    rootId: result.rootId,
    nodes,
    edges: vmEdges,
    shown: nodes.filter((n) => !n.ghost && !n.more).length,
  };
}
