/** List twin view-model (UX spec §8): rows, sorting, grouping, expansion and windowing. */
import type { AutomationGraph, MapEdge, MapNode, MapNodeId, SearchHit } from '../types';
import {
  type EvidenceTier,
  entryLabel,
  evidenceTier,
  FOGGED_MODULE,
  moduleLabel,
  nodeName,
  ORG_WIDE,
  SHARED,
  type StatusView,
  statusOf,
} from './format';
import { LEGEND_ORDER, nodeKindLabel } from './kinds';
import { reachedWrites } from './lens-model';

export type SortKey = 'module' | 'kind' | 'name' | 'entry' | 'reaches' | 'writes' | 'status';
export interface SortState {
  key: SortKey;
  dir: 1 | -1;
}
export const DEFAULT_SORT: SortState = { key: 'module', dir: 1 };

export const GROUP_ORG = '\u0000org';
export const GROUP_SHARED = '\u0000shared';

export interface WriteChip {
  label: string;
  title: string;
  tier: EvidenceTier;
}

export interface ListRowData {
  node: MapNode;
  group: string;
  kindLabel: string;
  entry: string;
  reaches: string;
  reachCount: number;
  writes: WriteChip[];
  status: StatusView;
  moduleBadge: string | null;
}

const SHORT: Record<string, string> = {
  action: 'action',
  function: 'fn',
  template: 'template',
  external: 'ext',
  field: 'field',
  rule: 'rule',
};

function reachSummary(graph: AutomationGraph, node: MapNode): { text: string; count: number } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const edge of graph.outgoing.get(node.id) ?? []) {
    if (edge.kind === 'reacts' || edge.kind === 'cascades') continue;
    const target = graph.nodes.get(edge.to);
    if (!target) continue;
    const key = target.kind === 'field' && target.bucket !== 'field' ? 'unresolved' : target.kind;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  }
  const text = [...counts]
    .map(([kind, n]) => `${n} ${SHORT[kind] ?? kind}${n > 1 && kind !== 'unresolved' ? 's' : ''}`)
    .join(' · ');
  return { text: text || '—', count: total };
}

function writeEdges(graph: AutomationGraph, node: MapNode): MapEdge[] {
  switch (node.kind) {
    case 'function':
      return (graph.outgoing.get(node.id) ?? []).filter((e) => e.kind === 'writes');
    case 'rule':
    case 'action':
    case 'button':
    case 'schedule':
    case 'transition':
    case 'approval':
      return reachedWrites(graph, node.id);
    default:
      return [];
  }
}

function writeChip(graph: AutomationGraph, edge: MapEdge, home: string | null, teaser: boolean) {
  const target = graph.nodes.get(edge.to);
  if (target?.kind !== 'field') return null;
  const module = moduleLabel(graph, target.moduleApiName, teaser);
  const label =
    target.bucket === 'unknownModule'
      ? 'module ?'
      : target.bucket === 'unknownFields'
        ? `${module} · ?`
        : target.moduleApiName === home
          ? target.label
          : `${module} · ${target.label}`;
  return { label, title: `${module}.${target.fieldApiName}`, tier: evidenceTier(edge) };
}

export function groupOf(node: MapNode): string {
  if (node.moduleApiName) return node.moduleApiName;
  return node.kind === 'schedule' || (node.kind === 'function' && node.restApi)
    ? GROUP_ORG
    : GROUP_SHARED;
}

export function groupLabel(graph: AutomationGraph, group: string, teaser: boolean): string {
  if (group === GROUP_ORG) return ORG_WIDE;
  if (group === GROUP_SHARED) return SHARED;
  return moduleLabel(graph, group, teaser);
}

export function buildRowData(graph: AutomationGraph, node: MapNode, teaser: boolean): ListRowData {
  const reach = reachSummary(graph, node);
  const group = groupOf(node);
  const writes = new Map<string, WriteChip>();
  for (const edge of writeEdges(graph, node)) {
    const chip = writeChip(graph, edge, node.moduleApiName, teaser);
    if (!chip) continue;
    const prior = writes.get(chip.label);
    // Keep the strongest evidence for a repeated target: declared beats inferred.
    if (!prior || (chip.tier === 'declared' && prior.tier !== 'declared'))
      writes.set(chip.label, chip);
  }
  return {
    node,
    group,
    kindLabel: nodeKindLabel(node),
    entry: entryLabel(graph, node),
    reaches: reach.text,
    reachCount: reach.count,
    writes: [...writes.values()],
    status: statusOf(node),
    moduleBadge:
      group === GROUP_ORG
        ? ORG_WIDE
        : group === GROUP_SHARED
          ? null
          : moduleLabel(graph, group, teaser) || FOGGED_MODULE,
  };
}

const kindIndex = (node: MapNode): number => {
  const i = LEGEND_ORDER.indexOf(node.kind as (typeof LEGEND_ORDER)[number]);
  return i < 0 ? LEGEND_ORDER.length : i;
};
const byName = (graph: AutomationGraph, teaser: boolean) => (a: ListRowData, b: ListRowData) =>
  nodeName(graph, a.node, teaser).localeCompare(nodeName(graph, b.node, teaser)) ||
  (a.node.id < b.node.id ? -1 : 1);

/** Rows eligible for the list: everything visible except module containers and field buckets. */
export function listableNodes(
  graph: AutomationGraph,
  visible: ReadonlySet<MapNodeId>,
  only: ReadonlySet<MapNodeId> | null,
): MapNode[] {
  const out: MapNode[] = [];
  for (const id of visible) {
    if (only && !only.has(id)) continue;
    const node = graph.nodes.get(id);
    if (!node || node.kind === 'module') continue;
    if (node.kind === 'field' && node.bucket !== 'field') continue;
    out.push(node);
  }
  return out;
}

export function sortRows(
  graph: AutomationGraph,
  rows: ListRowData[],
  sort: SortState,
  teaser: boolean,
): ListRowData[] {
  const order = [GROUP_ORG, ...graph.modules.map((m) => m.apiName), GROUP_SHARED];
  const groupIndex = (g: string) => {
    const i = order.indexOf(g);
    return i < 0 ? order.length - 1 : i;
  };
  const name = byName(graph, teaser);
  const compare: Record<SortKey, (a: ListRowData, b: ListRowData) => number> = {
    module: (a, b) =>
      groupIndex(a.group) - groupIndex(b.group) ||
      kindIndex(a.node) - kindIndex(b.node) ||
      name(a, b),
    kind: (a, b) => kindIndex(a.node) - kindIndex(b.node) || name(a, b),
    name,
    entry: (a, b) => a.entry.localeCompare(b.entry) || name(a, b),
    reaches: (a, b) => a.reachCount - b.reachCount || name(a, b),
    writes: (a, b) => a.writes.length - b.writes.length || name(a, b),
    status: (a, b) => a.status.label.localeCompare(b.status.label) || name(a, b),
  };
  return [...rows].sort((a, b) => compare[sort.key](a, b) * sort.dir);
}

/* ---------- flattening ---------- */

export const ROW_HEIGHT = 40;
export const GROUP_HEIGHT = 40;
export const EDGE_HEIGHT = 32;
export const MAX_EDGE_ROWS = 40;

export type DisplayRow =
  | { type: 'group'; key: string; group: string; label: string; count: number; collapsed: boolean }
  | { type: 'node'; key: string; data: ListRowData; expanded: boolean; canExpand: boolean }
  | {
      type: 'edge';
      key: string;
      owner: MapNodeId;
      dir: 'reaches' | 'reachedBy';
      first: boolean;
      edge: MapEdge;
      other: MapNode;
    }
  | { type: 'more'; key: string; owner: MapNodeId; dir: 'reaches' | 'reachedBy'; n: number };

export const rowHeight = (row: DisplayRow): number =>
  row.type === 'group' ? GROUP_HEIGHT : row.type === 'node' ? ROW_HEIGHT : EDGE_HEIGHT;

export interface FlattenOptions {
  graph: AutomationGraph;
  rows: ListRowData[];
  sort: SortState;
  expanded: ReadonlySet<MapNodeId>;
  collapsedGroups: ReadonlySet<string>;
  teaser: boolean;
}

function linksOf(
  graph: AutomationGraph,
  node: MapNode,
  dir: 'reaches' | 'reachedBy',
): Array<{ edge: MapEdge; other: MapNode }> {
  const edges = dir === 'reaches' ? graph.outgoing.get(node.id) : graph.incoming.get(node.id);
  const out: Array<{ edge: MapEdge; other: MapNode }> = [];
  for (const edge of edges ?? []) {
    const other = graph.nodes.get(dir === 'reaches' ? edge.to : edge.from);
    if (other && other.kind !== 'module') out.push({ edge, other });
  }
  return out;
}

export const hasLinks = (graph: AutomationGraph, node: MapNode): boolean =>
  linksOf(graph, node, 'reaches').length + linksOf(graph, node, 'reachedBy').length > 0;

export function flattenRows(o: FlattenOptions): DisplayRow[] {
  const out: DisplayRow[] = [];
  const grouped = o.sort.key === 'module';
  const counts = new Map<string, number>();
  if (grouped) for (const r of o.rows) counts.set(r.group, (counts.get(r.group) ?? 0) + 1);
  let current: string | null = null;
  for (const data of o.rows) {
    if (grouped && data.group !== current) {
      current = data.group;
      out.push({
        type: 'group',
        key: `g:${data.group}`,
        group: data.group,
        label: groupLabel(o.graph, data.group, o.teaser),
        count: counts.get(data.group) ?? 0,
        collapsed: o.collapsedGroups.has(data.group),
      });
    }
    if (grouped && o.collapsedGroups.has(data.group)) continue;
    const canExpand = hasLinks(o.graph, data.node);
    const expanded = canExpand && o.expanded.has(data.node.id);
    out.push({ type: 'node', key: `n:${data.node.id}`, data, expanded, canExpand });
    if (!expanded) continue;
    for (const dir of ['reaches', 'reachedBy'] as const) {
      const links = linksOf(o.graph, data.node, dir);
      links.slice(0, MAX_EDGE_ROWS).forEach(({ edge, other }, i) => {
        out.push({
          type: 'edge',
          key: `e:${data.node.id}:${dir}:${edge.id}`,
          owner: data.node.id,
          dir,
          first: i === 0,
          edge,
          other,
        });
      });
      if (links.length > MAX_EDGE_ROWS)
        out.push({
          type: 'more',
          key: `m:${data.node.id}:${dir}`,
          owner: data.node.id,
          dir,
          n: links.length - MAX_EDGE_ROWS,
        });
    }
  }
  return out;
}

/* ---------- windowing ---------- */

export interface Windowing {
  offsets: number[];
  total: number;
}

export function measure(rows: readonly DisplayRow[]): Windowing {
  const offsets: number[] = new Array(rows.length);
  let y = 0;
  rows.forEach((row, i) => {
    offsets[i] = y;
    y += rowHeight(row);
  });
  return { offsets, total: y };
}

export const VIRTUALIZE_ABOVE = 200;
export const OVERSCAN = 12;

/** Index range [start, end) to render for a scroll position; everything below the threshold. */
export function visibleRange(
  rows: readonly DisplayRow[],
  win: Windowing,
  scrollTop: number,
  viewport: number,
): [number, number] {
  if (rows.length <= VIRTUALIZE_ABOVE) return [0, rows.length];
  const top = Math.max(0, scrollTop);
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (win.offsets[mid] <= top) lo = mid;
    else hi = mid - 1;
  }
  let end = lo;
  while (end < rows.length && win.offsets[end] < top + viewport) end++;
  return [Math.max(0, lo - OVERSCAN), Math.min(rows.length, end + OVERSCAN)];
}

export function hitMap(hits: readonly SearchHit[]): ReadonlyMap<MapNodeId, SearchHit> {
  return new Map(hits.map((h) => [h.nodeId, h]));
}
