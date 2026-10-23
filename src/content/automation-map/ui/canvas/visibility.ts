/**
 * Which graph nodes the board may show for a set of filters.
 *
 * `filterNodes` is only used for scope and the "flags" test. Its module filter drops every node
 * with a null home (shared functions, externals), and its trigger filter keeps rule nodes only,
 * so the board applies modules at island level and treats triggers/flags as seeds plus reach, as
 * the prototype does (UX spec §9.2: "Filters remove, search dims").
 */
import { filterNodes } from '../../graph';
import type { AutomationGraph, MapFilters, MapNode, MapNodeId } from '../../types';

export interface Visibility {
  /**
   * Passed scope, trigger and flag filters: the board may traverse through these nodes. Nodes
   * here but not in `visible` are hidden by the kind filter only, so edges bridge over them
   * ("Hiding Actions reconnects rule to resource edges directly").
   */
  allowed: ReadonlySet<MapNodeId>;
  /** Shown: allowed and passing the kind filter. */
  visible: ReadonlySet<MapNodeId>;
  /** Island filter; empty = every island. */
  modules: ReadonlySet<string>;
}

const FLOW_KINDS = new Set(['starts', 'invokes', 'uses', 'calls', 'writes']);

export const EMPTY_SET: ReadonlySet<never> = new Set<never>();

export function scopeOnlyFilters(filters: MapFilters): MapFilters {
  return {
    scope: filters.scope,
    modules: new Set(),
    kinds: new Set(),
    triggerTypes: new Set(),
    flags: new Set(),
  };
}

function closure(
  graph: AutomationGraph,
  seeds: Iterable<MapNodeId>,
  allowed: ReadonlySet<MapNodeId>,
  direction: 'down' | 'up',
): Set<MapNodeId> {
  const seen = new Set<MapNodeId>(seeds);
  const queue = [...seen];
  for (let i = 0; i < queue.length; i++) {
    const edges = (direction === 'down' ? graph.outgoing : graph.incoming).get(queue[i]) ?? [];
    for (const e of edges) {
      if (e.kind === 'reacts') continue;
      if (direction === 'up' && e.kind === 'cascades') continue;
      const next = direction === 'down' ? e.to : e.from;
      if (!allowed.has(next) || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

const isBoardKind = (n: MapNode) => n.kind !== 'module';

export function computeVisibility(graph: AutomationGraph, filters: MapFilters): Visibility {
  const scopeIds = filterNodes(graph, scopeOnlyFilters(filters));
  const scope = new Set<MapNodeId>();
  for (const id of scopeIds) {
    const n = graph.nodes.get(id);
    if (n && isBoardKind(n)) scope.add(id);
  }
  let allowed: Set<MapNodeId> = scope;
  if (filters.triggerTypes.size) {
    const seeds: MapNodeId[] = [];
    for (const id of scope) {
      const n = graph.nodes.get(id);
      if (n?.kind === 'rule' && n.triggerType && filters.triggerTypes.has(n.triggerType))
        seeds.push(id);
    }
    allowed = closure(graph, seeds, scope, 'down');
  }
  if (filters.flags.size) {
    const flagged = filterNodes(graph, {
      ...scopeOnlyFilters(filters),
      flags: filters.flags,
    });
    const seeds = [...allowed].filter((id) => flagged.has(id));
    const down = closure(graph, seeds, allowed, 'down');
    const up = closure(graph, seeds, allowed, 'up');
    allowed = new Set([...allowed].filter((id) => down.has(id) || up.has(id)));
  }
  const visible = new Set<MapNodeId>();
  for (const id of allowed) {
    const n = graph.nodes.get(id);
    if (n && (!filters.kinds.size || filters.kinds.has(n.kind))) visible.add(id);
  }
  return { allowed, visible, modules: filters.modules };
}

export { FLOW_KINDS };
