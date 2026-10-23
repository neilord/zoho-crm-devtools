import type {
  AutomationGraph,
  FieldLens,
  FieldNode,
  MapEdge,
  MapFilters,
  MapNodeId,
  TraceOptions,
  TraceResult,
} from '../types';

export function fieldWriters(
  graph: AutomationGraph,
  moduleApiName: string,
  fieldApiName: string,
  filters?: MapFilters,
): FieldLens {
  const id = `field:${moduleApiName}.${fieldApiName}`;
  const field = graph.nodes.get(id);
  const writes = (id: string) =>
    (graph.incoming.get(id) ?? []).filter((e) => e.kind === 'writes' && !isRecordChange(e));
  const allowed = filters ? filterNodes(graph, { ...filters, modules: new Set() }) : null;
  const scoped = (edges: readonly MapEdge[]) =>
    edges.filter(
      (e) => (!allowed || allowed.has(e.from)) && (filters?.scope !== 'active' || e.inActiveScope),
    );
  const direct = scoped(writes(id));
  const writers = direct.filter(
    (e) =>
      // Declared writes are local; inferred destinations must be proven current-org.
      e.evidence === 'declared' ||
      (e.confidence === 'exact' && e.destinationScope === 'current-org'),
  );
  const possibleWriters = scoped(writes(`field:${moduleApiName}.*`));
  const site = (e: MapEdge) => JSON.stringify([e.from, e.operation, e.spans]);
  const bucketSites = new Set(possibleWriters.map(site));
  // Candidate/relationship effects can name literal fields while retaining partial
  // overall confidence. Keep them visible, without counting a bucket site twice.
  possibleWriters.push(...direct.filter((e) => !writers.includes(e) && !bucketSites.has(site(e))));
  const unresolvedWriters = scoped(writes('field:*.*'));
  return {
    writerEntityIds: new Map(
      [...writers, ...possibleWriters, ...unresolvedWriters].map((edge) => {
        const source = graph.nodes.get(edge.from);
        return [edge.from, source?.kind === 'action' ? source.ownerId : edge.from];
      }),
    ),
    field: field?.kind === 'field' ? field : null,
    writers,
    possibleWriters,
    unresolvedWriters,
    otherRecordChanges: scoped(
      (graph.incoming.get(`field:${moduleApiName}.*`) ?? []).filter(isRecordChange),
    ),
    reactors: (graph.outgoing.get(id) ?? []).filter((e) => e.kind === 'reacts'),
    coverageGaps: [...graph.nodes.values()].filter(
      (n) => n.kind === 'function' && n.analysis !== 'analyzed',
    ).length,
  };
}

/** Bounded, independent directional BFS; shared nodes may be expanded in both directions.
 * Truncation counts distinct excluded frontier nodes, without exploring their descendants. */
export function traceFrom(
  graph: AutomationGraph,
  nodeId: MapNodeId,
  options: TraceOptions,
): TraceResult {
  const nodeIds = new Set<string>();
  const depth = new Map<string, number>();
  const truncated = { upstream: 0, downstream: 0 };
  if (!graph.nodes.has(nodeId)) return { rootId: nodeId, nodeIds, edges: [], depth, truncated };
  nodeIds.add(nodeId);
  depth.set(nodeId, 0);
  const finite = (n: number, fallback: number) =>
    Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
  const cap = Math.max(1, finite(options.maxNodes, graph.nodes.size));
  const traversed = new Set<string>();
  for (const direction of ['upstream', 'downstream'] as const) {
    const sign = direction === 'upstream' ? -1 : 1;
    const limit = finite(options[direction], graph.nodes.size);
    const adjacency = direction === 'upstream' ? graph.incoming : graph.outgoing;
    const visited = new Set([nodeId]);
    const queue = [{ id: nodeId, layer: 0 }];
    for (let i = 0; i < queue.length; i++) {
      const { id, layer } = queue[i];
      if (layer >= limit) continue;
      for (const edge of adjacency.get(id) ?? []) {
        const next = sign < 0 ? edge.from : edge.to;
        const n = graph.nodes.get(next);
        if (!n || (!options.includeInactive && !n.inActiveScope)) continue;
        if (visited.has(next)) {
          if (nodeIds.has(next)) traversed.add(edge.id);
          continue;
        }
        visited.add(next);
        if (!nodeIds.has(next) && nodeIds.size >= cap) {
          truncated[direction]++;
          continue;
        }
        traversed.add(edge.id);
        nodeIds.add(next);
        const distance = layer + 1;
        const previous = depth.get(next);
        if (
          previous === undefined ||
          distance < Math.abs(previous) ||
          (sign > 0 && distance === Math.abs(previous))
        )
          depth.set(next, sign * distance);
        queue.push({ id: next, layer: layer + 1 });
      }
    }
  }
  return {
    rootId: nodeId,
    nodeIds,
    depth,
    truncated,
    edges: graph.edges.filter(
      (e) => traversed.has(e.id) && nodeIds.has(e.from) && nodeIds.has(e.to),
    ),
  };
}

/** Filter groups intersect; flags also intersect. Trigger filters select rule nodes only. */
export function filterNodes(graph: AutomationGraph, filters: MapFilters): ReadonlySet<MapNodeId> {
  const result = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (filters.scope === 'active' && !node.inActiveScope) continue;
    if (filters.modules.size && (!node.moduleApiName || !filters.modules.has(node.moduleApiName)))
      continue;
    if (filters.kinds.size && !filters.kinds.has(node.kind)) continue;
    if (
      filters.triggerTypes.size &&
      (node.kind !== 'rule' || !node.triggerType || !filters.triggerTypes.has(node.triggerType))
    )
      continue;
    const edges = graph.outgoing.get(node.id) ?? [];
    if (
      [...filters.flags].some((flag) => {
        switch (flag) {
          case 'writesFields':
            return !edges.some((e) => e.kind === 'writes');
          case 'callsExternal':
            return !edges.some((e) => e.kind === 'calls');
          case 'cascades':
            return !edges.some((e) => e.kind === 'cascades');
          case 'restApi':
            return node.kind !== 'function' || !node.restApi;
          case 'gaps':
            return node.kind !== 'function' || node.analysis === 'analyzed';
        }
        return false;
      })
    )
      continue;
    result.add(node.id);
  }
  return result;
}

/** Direct adjacency for inspector connection lists; edge order is the builder's stable order. */
export function neighbors(
  graph: AutomationGraph,
  nodeId: MapNodeId,
): { incoming: readonly MapEdge[]; outgoing: readonly MapEdge[] } {
  return { incoming: graph.incoming.get(nodeId) ?? [], outgoing: graph.outgoing.get(nodeId) ?? [] };
}

/** Record-only effects use a module bucket and an explicit builder flag. Relationship updates
 * with field mappings still write fields; the coarse `relate` operation alone cannot decide. */
function isRecordChange(edge: MapEdge): boolean {
  return (
    edge.kind === 'writes' &&
    (edge.operation === 'delete' || edge.operation === 'attach' || edge.setsFields === false)
  );
}

export type LensWriterGroup = 'declared' | 'exact' | 'partial' | 'unknownFields' | 'unresolved';

/** Count selectable entities, not effects. An entity belongs only to its strongest tier:
 * declared > exact > partial (literal candidate) > unknown fields > unresolved module.
 * Keep all lens edges for evidence; entityGroups lets the UI coalesce cards without losing it. */
export function lensCounts(lens: FieldLens, scope: MapFilters['scope'] = 'everything') {
  const groups: Record<LensWriterGroup, number> = {
    declared: 0,
    exact: 0,
    partial: 0,
    unknownFields: 0,
    unresolved: 0,
  };
  const entityGroups = new Map<MapNodeId, LensWriterGroup>();
  const candidates: [LensWriterGroup, readonly MapEdge[]][] = [
    ['declared', lens.writers.filter((e) => e.evidence === 'declared')],
    ['exact', lens.writers.filter((e) => e.evidence !== 'declared')],
    ['partial', lens.possibleWriters.filter((e) => !e.to.endsWith('.*'))],
    ['unknownFields', lens.possibleWriters.filter((e) => e.to.endsWith('.*'))],
    ['unresolved', lens.unresolvedWriters],
  ];
  for (const [group, edges] of candidates) {
    for (const edge of edges) {
      if (scope === 'active' && !edge.inActiveScope) continue;
      const entity = lens.writerEntityIds?.get(edge.from) ?? edge.from;
      if (entityGroups.has(entity)) continue;
      entityGroups.set(entity, group);
      groups[group]++;
    }
  }
  return { total: entityGroups.size, groups, entityGroups };
}

export function fieldWriterCount(lens: FieldLens, scope: MapFilters['scope']): number {
  return lensCounts(lens, scope).total;
}

/** Start-screen counts use exactly the lens's writer union and scope, including uncertainty. */
export function mostWrittenFields(
  graph: AutomationGraph,
  filters: MapFilters,
  limit = 6,
): readonly { field: FieldNode; count: number }[] {
  const rows: { field: FieldNode; count: number }[] = [];
  for (const node of graph.nodes.values()) {
    if (
      node.kind !== 'field' ||
      node.fieldApiName === '*' ||
      !node.moduleApiName ||
      (filters.modules.size && !filters.modules.has(node.moduleApiName))
    )
      continue;
    const lens = fieldWriters(graph, node.moduleApiName, node.fieldApiName, filters);
    const count = fieldWriterCount(lens, filters.scope);
    if (count) rows.push({ field: node, count });
  }
  return rows
    .sort((a, b) => b.count - a.count || a.field.id.localeCompare(b.field.id))
    .slice(0, Math.max(0, limit));
}
