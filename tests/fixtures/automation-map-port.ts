/**
 * Synthetic `MapDataPort` for UI tests and the dev harness. Never real CRM data.
 * The teaser variant approximates the store's projection: one revealed flow, counts-only fog.
 */
import {
  buildAutomationGraph,
  buildSearchIndex,
  fieldWriters,
  mostWrittenFields,
  searchMap,
  traceFrom,
} from '../../src/content/automation-map/graph';
import type {
  AutomationGraph,
  AutomationMapSnapshot,
  FoggedIsland,
  MapCoverage,
  MapEdge,
  MapFilters,
  MapNode,
  MapNodeId,
  TeaserFog,
} from '../../src/content/automation-map/types';
import type { MapDataPort } from '../../src/content/automation-map/ui/context';
import { fixtureInputs, fixtureSources, generateLargeInputs } from './automation-map';

export type FixtureMode = 'full' | 'teaser' | 'loading';

export interface FixturePortCalls {
  upgrade: number;
  retries: Array<string | undefined>;
  refreshes: number;
  openedRules: string[];
  openedFunctions: string[];
}

/**
 * The query half of the port, wired the way the store port does it: the lens and the start-screen
 * ranking share one definition of "writer", and the lens carries the store's single gap count.
 */
export function queryPort(
  snapshot: () => AutomationMapSnapshot,
): Pick<MapDataPort, 'fieldLens' | 'mostWrittenFields'> {
  return {
    fieldLens: (moduleApiName: string, fieldApiName: string, filters?: MapFilters) => ({
      ...fieldWriters(snapshot().graph, moduleApiName, fieldApiName, filters),
      coverageGaps: snapshot().coverage.gaps,
    }),
    mostWrittenFields: (filters: MapFilters, limit?: number) =>
      mostWrittenFields(snapshot().graph, filters, limit),
  };
}

const coverage = (graph: AutomationGraph, loading: boolean): MapCoverage => {
  const functions = [...graph.nodes.values()].filter((node) => node.kind === 'function');
  const rules = [...graph.nodes.values()].filter((node) => node.kind === 'rule');
  const count = (state: string) =>
    functions.filter((node) => node.kind === 'function' && node.analysis === state).length;
  // The store's single gap count (failed dependencies plus functions whose analysis is not
  // complete); the fixture has no failed dependencies, and its one pending function is ignored.
  const gaps = loading
    ? 0
    : count('limited') + count('unsupported') + count('source-unavailable') + count('failed');
  return {
    rules: {
      listed: rules.length,
      detailed: loading ? 0 : rules.length,
      failed: 0,
      total: rules.length,
    },
    functions: {
      listed: functions.length,
      analyzed: loading ? 0 : count('analyzed'),
      limited: count('limited'),
      unsupported: count('unsupported'),
      sourceUnavailable: count('source-unavailable'),
      pending: loading ? functions.length : count('pending'),
      failed: count('failed'),
    },
    buttons: { loaded: 0, failed: 0, state: loading ? 'loading' : 'loaded' },
    schedules: { loaded: 0, failed: 0, state: loading ? 'loading' : 'loaded' },
    blueprints: { loaded: 0, failed: 0, state: loading ? 'loading' : 'loaded' },
    approvals: { loaded: 0, failed: 0, state: loading ? 'loading' : 'loaded' },
    gaps,
    lastRevalidatedAt: loading ? null : Date.now(),
    isComplete: !loading && gaps === 0,
    refreshing: false,
    failures: [],
  };
};

function subgraph(graph: AutomationGraph, keep: ReadonlySet<MapNodeId>): AutomationGraph {
  const nodes = new Map<MapNodeId, MapNode>();
  for (const [id, node] of graph.nodes) if (keep.has(id)) nodes.set(id, node);
  const edges = graph.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to));
  const outgoing = new Map<MapNodeId, MapEdge[]>();
  const incoming = new Map<MapNodeId, MapEdge[]>();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  }
  return {
    nodes,
    edges,
    outgoing,
    incoming,
    modules: graph.modules.filter((module) => keep.has(module.id)),
  };
}

export function createFixturePort(mode: FixtureMode = 'full'): {
  port: MapDataPort;
  calls: FixturePortCalls;
} {
  const full = buildAutomationGraph(fixtureInputs());
  const sources = fixtureSources();
  const index = buildSearchIndex(full, sources);
  const calls: FixturePortCalls = {
    upgrade: 0,
    retries: [],
    refreshes: 0,
    openedRules: [],
    openedFunctions: [],
  };
  let snapshot: AutomationMapSnapshot;

  if (mode === 'teaser') {
    const revealedModule = 'Deals';
    const rule = [...full.nodes.values()].find(
      (node) => node.kind === 'rule' && node.moduleApiName === revealedModule && node.active,
    );
    const keep = new Set<MapNodeId>([`module:${revealedModule}`]);
    if (rule) {
      // The store reveals exactly one rule: its chain may reach other rules, which stay fogged.
      for (const id of traceFrom(full, rule.id, {
        upstream: 1,
        downstream: 3,
        maxNodes: 40,
        includeInactive: false,
      }).nodeIds)
        if (id === rule.id || full.nodes.get(id)?.kind !== 'rule') keep.add(id);
    }
    const fogged = full.modules
      .filter((module) => module.apiName !== revealedModule)
      .map((module, slot) => ({
        slot,
        counts: {
          rules: module.counts.rules,
          functions: module.counts.functions,
          buttons: module.counts.buttons,
          schedules: module.counts.schedules,
        },
        recordWrites: module.counts.fieldsWritten,
      }));
    const totals = {
      rules: full.modules.reduce((sum, module) => sum + module.counts.rules, 0),
      functions: [...full.nodes.values()].filter((node) => node.kind === 'function').length,
      modules: full.modules.length,
    };
    const revealed = subgraph(full, keep);
    snapshot = {
      access: { level: 'teaser', revealedModuleApiName: revealedModule, reason: 'lower-plan' },
      graph: revealed,
      teaser: { fogged, totals },
      coverage: coverage(revealed, false),
      phase: 'complete',
    };
  } else {
    snapshot = {
      access: { level: 'full' },
      graph: full,
      teaser: null,
      coverage: coverage(full, mode === 'loading'),
      phase: mode === 'loading' ? 'enriching' : 'complete',
    };
  }

  const teaser = mode === 'teaser';
  const queries = queryPort(() => snapshot);
  const port: MapDataPort = {
    snapshot: () => snapshot,
    subscribe: () => () => {},
    sourceText: (delugeId) =>
      teaser && !snapshot.graph.nodes.has(`function:${delugeId}`)
        ? null
        : (sources.get(delugeId) ?? null),
    search: (query, filters) =>
      teaser
        ? searchMap(buildSearchIndex(snapshot.graph, sources), query, filters)
        : searchMap(index, query, filters),
    ...queries,
    trace: (nodeId, options) => traceFrom(snapshot.graph, nodeId, options),
    retry: async (failureId) => {
      calls.retries.push(failureId);
    },
    refresh: async () => {
      calls.refreshes++;
    },
    requestUpgrade: () => {
      calls.upgrade += 1;
    },
    openRuleInZoho: (ruleId) => calls.openedRules.push(ruleId),
    openFunctionInZoho: (delugeId) => calls.openedFunctions.push(delugeId),
  };
  return { port, calls };
}

/**
 * A 330-rule, 920-function synthetic org for scale checks (dev harness, screenshots, perf tests).
 * With `teaser` it projects the org the way the store does: one revealed flow, counts-only fog.
 */
export function createLargeFixturePort(teaser = false): MapDataPort {
  const inputs = generateLargeInputs({ rules: 330, functions: 920 });
  const full = buildAutomationGraph(inputs);
  const sources = new Map(
    inputs.functions.flatMap((f) =>
      f.sourceText === null ? [] : [[f.delugeId, f.sourceText] as const],
    ),
  );
  let graph = full;
  let snapshot: AutomationMapSnapshot = {
    access: { level: 'full' },
    graph,
    teaser: null,
    coverage: coverage(full, false),
    phase: 'complete',
  };
  if (teaser) {
    const rule = [...full.nodes.values()].find(
      (n) => n.kind === 'rule' && n.moduleApiName === 'Deals' && n.active,
    );
    const keep = new Set<MapNodeId>(['module:Deals']);
    if (rule)
      for (const id of traceFrom(full, rule.id, {
        upstream: 1,
        downstream: 3,
        maxNodes: 40,
        includeInactive: false,
      }).nodeIds)
        if (id === rule.id || full.nodes.get(id)?.kind !== 'rule') keep.add(id);
    graph = subgraph(full, keep);
    snapshot = {
      ...snapshot,
      access: { level: 'teaser', revealedModuleApiName: 'Deals', reason: 'lower-plan' },
      graph,
      teaser: {
        fogged: full.modules
          .filter((m) => m.apiName !== 'Deals')
          .map((m, slot) => ({
            slot,
            counts: {
              rules: m.counts.rules,
              functions: m.counts.functions,
              buttons: m.counts.buttons,
              schedules: m.counts.schedules,
            },
            recordWrites: m.counts.fieldsWritten,
          })),
        totals: { rules: 330, functions: 920, modules: full.modules.length },
      },
    };
  }
  const index = buildSearchIndex(graph, sources);
  return {
    snapshot: () => snapshot,
    subscribe: () => () => {},
    sourceText: (id) => sources.get(id) ?? null,
    search: (q, f) => searchMap(index, q, f),
    ...queryPort(() => snapshot),
    trace: (id, o) => traceFrom(graph, id, o),
    retry: async () => {},
    refresh: async () => {},
    requestUpgrade: () => {},
    openRuleInZoho: () => {},
    openFunctionInZoho: () => {},
  };
}

/**
 * A real org's fog is lopsided: a couple of huge modules, a few middling ones and a long tail of
 * one-rule modules, plus modules with no automation at all (only counted, never drawn).
 * `[rules, functions, buttons, schedules]` per fogged island, largest first.
 */
const SKEWED_FOG: ReadonlyArray<readonly [number, number, number, number]> = [
  [101, 87, 4, 0],
  [59, 61, 2, 0],
  [38, 24, 1, 0],
  [21, 17, 0, 0],
  [14, 9, 1, 0],
  [9, 6, 0, 0],
  [6, 4, 0, 0],
  [4, 3, 0, 0],
  ...Array.from({ length: 14 }, (_, i): [number, number, number, number] => [
    i % 4 === 3 ? 0 : 1,
    i % 4 === 3 || i % 3 !== 0 ? 1 : 0,
    0,
    0,
  ]),
  [0, 3, 0, 2],
];

export function skewedFog(quietModules = 9): TeaserFog {
  const fogged: FoggedIsland[] = SKEWED_FOG.map(([rules, functions, buttons, schedules], slot) => ({
    slot,
    counts: { rules, functions, buttons, schedules },
    recordWrites: Math.round(functions / 3),
  }));
  const sum = (key: 'rules' | 'functions') => fogged.reduce((n, f) => n + f.counts[key], 0);
  return {
    quietModules,
    fogged,
    totals: {
      rules: sum('rules') + 11,
      functions: sum('functions') + 14,
      modules: fogged.length + quietModules + 1,
    },
  };
}

/** The teaser fixture with a lopsided fog, for the dev harness and the fog tests. */
export function withSkewedFog(port: MapDataPort, quietModules = 9): MapDataPort {
  const base = port.snapshot();
  const snapshot: AutomationMapSnapshot = { ...base, teaser: skewedFog(quietModules) };
  return { ...port, snapshot: () => snapshot };
}
