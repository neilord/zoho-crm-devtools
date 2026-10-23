/**
 * Derived data shared by every panel: effective filters (search prefixes applied), the visible
 * node set, search hits, rail counts, estate totals and coverage progress. Pure and cached per
 * graph so progressive snapshots (~2/s) and keystrokes stay cheap.
 */

import type {
  AutomationGraph,
  AutomationMapSnapshot,
  MapCoverage,
  MapFilters,
  MapNodeId,
  MapNodeKind,
  SearchHit,
} from '../types';
import { buildBoardModel } from './canvas/model';
import { computeVisibility, scopeOnlyFilters } from './canvas/visibility';
import type { MapDataPort, MapViewState } from './context';
import { flowsShown } from './format';
import { KIND_LABEL, KIND_PLURAL, LEGEND_ORDER, type LegendKind } from './kinds';

/* ---------- search prefixes (UX spec §9.1) ---------- */

export interface ParsedQuery {
  raw: string;
  /** Free text left after the `module:` / `kind:` / `field:` prefixes. */
  text: string;
  modules: string[];
  kinds: MapNodeKind[];
  field: { moduleApiName: string; fieldApiName: string } | null;
  /** True when a prefix was recognised but matched nothing in this graph. */
  unresolved: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

export function parseQuery(raw: string, graph: AutomationGraph): ParsedQuery {
  const parsed: ParsedQuery = {
    raw,
    text: '',
    modules: [],
    kinds: [],
    field: null,
    unresolved: false,
  };
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const rest: string[] = [];
  let leading = true;
  for (const word of words) {
    const m = leading ? /^(module|kind|field):(.+)$/i.exec(word) : null;
    if (!m) {
      leading = false;
      rest.push(word);
      continue;
    }
    const value = m[2];
    switch (m[1].toLowerCase()) {
      case 'module': {
        const hit = graph.modules.find(
          (mod) => norm(mod.apiName) === norm(value) || norm(mod.label) === norm(value),
        );
        if (hit) parsed.modules.push(hit.apiName);
        else parsed.unresolved = true;
        break;
      }
      case 'kind': {
        const hit = (Object.keys(KIND_LABEL) as MapNodeKind[]).find(
          (k) =>
            norm(k) === norm(value) ||
            norm(KIND_LABEL[k]) === norm(value) ||
            norm(KIND_PLURAL[k]) === norm(value),
        );
        if (hit) parsed.kinds.push(hit);
        else parsed.unresolved = true;
        break;
      }
      default: {
        const dot = value.indexOf('.');
        if (dot > 0 && dot < value.length - 1) {
          const moduleApiName = value.slice(0, dot);
          const fieldApiName = value.slice(dot + 1);
          const exact = [...graph.nodes.values()].find(
            (n) =>
              n.kind === 'field' &&
              n.moduleApiName?.toLowerCase() === moduleApiName.toLowerCase() &&
              n.fieldApiName.toLowerCase() === fieldApiName.toLowerCase(),
          );
          parsed.field =
            exact?.kind === 'field' && exact.moduleApiName
              ? { moduleApiName: exact.moduleApiName, fieldApiName: exact.fieldApiName }
              : { moduleApiName, fieldApiName };
        } else rest.push(word);
      }
    }
  }
  parsed.text = rest.join(' ');
  return parsed;
}

/** Search prefixes narrow the stored filters without rewriting them. */
export function effectiveFilters(filters: MapFilters, parsed: ParsedQuery): MapFilters {
  if (!parsed.modules.length && !parsed.kinds.length) return filters;
  const narrow = <T>(current: ReadonlySet<T>, extra: T[]): ReadonlySet<T> =>
    extra.length ? new Set(current.size ? extra.filter((v) => current.has(v)) : extra) : current;
  return {
    ...filters,
    modules: narrow(filters.modules, parsed.modules),
    kinds: narrow(filters.kinds, parsed.kinds),
  };
}

/* ---------- cache ---------- */

const setKey = (s: ReadonlySet<string>) => [...s].sort().join(',');
export const filtersKey = (f: MapFilters): string =>
  [f.scope, setKey(f.modules), setKey(f.kinds), setKey(f.triggerTypes), setKey(f.flags)].join('|');

interface Cache {
  graph: AutomationGraph | null;
  visible: Map<string, ReadonlySet<MapNodeId>>;
}
const cache: Cache = { graph: null, visible: new Map() };

function cacheFor(graph: AutomationGraph): Cache {
  if (cache.graph !== graph) {
    cache.graph = graph;
    cache.visible = new Map();
  }
  return cache;
}

export interface ShellModel {
  snapshot: AutomationMapSnapshot;
  graph: AutomationGraph;
  access: 'checking' | 'full' | 'teaser';
  teaser: boolean;
  state: MapViewState;
  parsed: ParsedQuery;
  filters: MapFilters;
  visible: ReadonlySet<MapNodeId>;
  /** Null when no search is active; otherwise ranked hits restricted to the visible graph. */
  hits: readonly SearchHit[] | null;
  hitIds: ReadonlySet<MapNodeId> | null;
  /** Teaser only: rules read in full (the "N flows shown" copy). Zero outside the teaser. */
  flowsShown: number;
}

function safeSearch(port: MapDataPort, query: string, filters: MapFilters): readonly SearchHit[] {
  try {
    return port.search(query, filters);
  } catch (error) {
    // A broken search must not take the whole map down; show "no results" and say why in the log.
    console.error('Zoho CRM DevTools: Automation Map search failed', error);
    return [];
  }
}

export function deriveModel(
  port: MapDataPort,
  snapshot: AutomationMapSnapshot,
  state: MapViewState,
): ShellModel {
  const graph = snapshot.graph;
  const c = cacheFor(graph);
  const parsed = parseQuery(state.query, graph);
  const filters = effectiveFilters(state.filters, parsed);
  const fKey = filtersKey(filters);
  let visible = c.visible.get(fKey);
  if (!visible) {
    // The accessible twin lists exactly the graph nodes instantiated on the island board,
    // including shared resources reached from a module and trigger/flag seed closures.
    const board = buildBoardModel(graph, computeVisibility(graph, filters), {
      includeLoose: filters.scope === 'everything' && snapshot.access.level !== 'teaser',
    });
    visible = new Set(board.byNode.keys());
    if (c.visible.size > 12) c.visible.clear();
    c.visible.set(fKey, visible);
  }
  let hits: readonly SearchHit[] | null = null;
  const searching = state.query.trim() !== '' && snapshot.access.level !== 'checking';
  if (searching) {
    // Search readiness can change without graph identity changing.
    let cached: readonly SearchHit[];
    const prefixOnly = parsed.modules.length > 0 || parsed.kinds.length > 0;
    if (parsed.unresolved) cached = [];
    else if (parsed.text.trim()) {
      cached = safeSearch(port, parsed.text, scopeOnlyFilters(filters)).filter((h) =>
        visible?.has(h.nodeId),
      );
    } else if (prefixOnly) {
      // Prefix-only query (`kind:function`): list what the filters select.
      cached = [...(visible ?? [])]
        .filter((id) => {
          const n = graph.nodes.get(id);
          return n && n.kind !== 'module' && !(n.kind === 'field' && n.bucket !== 'field');
        })
        .map((nodeId) => ({
          nodeId,
          score: 0,
          matches: [{ location: 'name' as const, snippet: '', highlights: [] }],
        }));
    } else cached = [];

    hits = cached;
  }
  return {
    snapshot,
    graph,
    access: snapshot.access.level,
    teaser: snapshot.access.level === 'teaser',
    state,
    parsed,
    filters,
    visible,
    hits,
    hitIds: hits ? new Set(hits.map((h) => h.nodeId)) : null,
    flowsShown: snapshot.access.level === 'teaser' ? flowsShown(graph) : 0,
  };
}

/* ---------- rail counts ---------- */

export interface RailCounts {
  kinds: Map<LegendKind, number>;
  modules: Map<string, number>;
  /** Rules and org-level entry points that have no module. */
  orgWide: number;
  triggers: Map<string, number>;
}

export function railCounts(graph: AutomationGraph, scope: MapFilters['scope']): RailCounts {
  const kinds = new Map<LegendKind, number>();
  const modules = new Map<string, number>();
  const triggers = new Map<string, number>();
  let orgWide = 0;
  for (const node of graph.nodes.values()) {
    if (node.kind === 'module') continue;
    if (scope === 'active' && !node.inActiveScope) continue;
    if (node.kind === 'field' && node.bucket !== 'field') continue;
    kinds.set(node.kind, (kinds.get(node.kind) ?? 0) + 1);
    if (node.kind === 'action' || node.kind === 'field' || node.kind === 'template') continue;
    if (node.moduleApiName)
      modules.set(node.moduleApiName, (modules.get(node.moduleApiName) ?? 0) + 1);
    else orgWide++;
    if (node.kind === 'rule' && node.triggerType)
      triggers.set(node.triggerType, (triggers.get(node.triggerType) ?? 0) + 1);
  }
  return { kinds, modules, orgWide, triggers };
}

export function allKinds(graph: AutomationGraph): LegendKind[] {
  const present = new Set<string>();
  for (const node of graph.nodes.values()) present.add(node.kind);
  return LEGEND_ORDER.filter((k) => present.has(k));
}

/** The kinds a filter currently shows (empty `kinds` means every kind). */
export function shownKinds(filters: MapFilters, all: readonly LegendKind[]): Set<LegendKind> {
  return filters.kinds.size ? new Set(all.filter((k) => filters.kinds.has(k))) : new Set(all);
}

export function toggleKind(
  filters: MapFilters,
  kind: LegendKind,
  all: readonly LegendKind[],
): ReadonlySet<MapNodeKind> | null {
  const shown = shownKinds(filters, all);
  if (shown.has(kind)) shown.delete(kind);
  else shown.add(kind);
  if (shown.size === 0) return null; // hiding the last kind would read as "show all"
  return shown.size === all.length ? new Set() : new Set(shown);
}

/* ---------- estate totals ---------- */

export interface Estate {
  rules: number;
  activeRules: number;
  functions: number;
  buttons: number;
  schedules: number;
  apiFunctions: number;
  modules: number;
}

/**
 * `modules` is the store's inventory (`coverage.modules`) when it has one: the graph also holds
 * islands made only from source or action targets, which would overstate the org's modules.
 */
export function estateTotals(graph: AutomationGraph, inventoryModules?: number): Estate {
  const e: Estate = {
    rules: 0,
    activeRules: 0,
    functions: 0,
    buttons: 0,
    schedules: 0,
    apiFunctions: 0,
    modules: inventoryModules ?? graph.modules.length,
  };
  for (const n of graph.nodes.values()) {
    if (n.kind === 'rule') {
      e.rules++;
      if (n.active) e.activeRules++;
    } else if (n.kind === 'function') {
      e.functions++;
      if (n.restApi) e.apiFunctions++;
    } else if (n.kind === 'button') e.buttons++;
    else if (n.kind === 'schedule') e.schedules++;
  }
  return e;
}

/* ---------- coverage ---------- */

export interface CoverageView {
  /** 0–100, never reported complete before the phase says so. */
  percent: number;
  gaps: number;
  loading: boolean;
  status: 'loading' | 'mapped' | 'gaps' | 'failed' | 'stopped';
}

const settled = (s: string) => s !== 'loading' && s !== 'not-requested';

export function coverageView(snapshot: AutomationMapSnapshot): CoverageView {
  const c: MapCoverage = snapshot.coverage;
  const f = c.functions;
  const functionsDone = f.analyzed + f.limited + f.unsupported + f.sourceUnavailable + f.failed;
  const ruleTotal = c.rules.total ?? c.rules.listed;
  const parts: Array<[done: number, total: number]> = [
    [c.rules.detailed + c.rules.failed, ruleTotal],
    [functionsDone, f.listed],
  ];
  for (const s of [c.buttons, c.schedules, c.blueprints, c.approvals])
    parts.push([settled(s.state) ? 1 : 0, 1]);
  const total = parts.reduce((n, [, t]) => n + t, 0);
  const done = parts.reduce((n, [d, t]) => n + Math.min(d, t), 0);
  // The store's total is the only gap count: the chip, banner, live region, popover and lens all
  // read it. Summing the parts here drifted from it (337 on the chip, 248 announced).
  const gaps = c.gaps;
  const phase = snapshot.phase;
  const loading =
    !c.refreshing && (phase === 'idle' || phase === 'loading' || phase === 'enriching');
  const percent =
    phase === 'complete' ? 100 : total ? Math.min(99, Math.floor((done / total) * 100)) : 0;
  const status =
    phase === 'failed'
      ? 'failed'
      : phase === 'cancelled'
        ? 'stopped'
        : loading
          ? 'loading'
          : gaps > 0
            ? 'gaps'
            : 'mapped';
  return { percent, gaps, loading, status };
}

const versions = new WeakMap<object, number>();
let nextVersion = 1;
/** Cheap identity for a graph, so panel signatures change exactly when a new snapshot arrives. */
export function graphVersion(graph: AutomationGraph): number {
  let v = versions.get(graph);
  if (v === undefined) {
    v = nextVersion++;
    versions.set(graph, v);
  }
  return v;
}

/** Search hits in display order: fields first, then legend order; ranked within each group. */
export function orderedHits(graph: AutomationGraph, hits: readonly SearchHit[]): SearchHit[] {
  const rank = (hit: SearchHit): number => {
    const kind = graph.nodes.get(hit.nodeId)?.kind;
    if (kind === 'field') return -1;
    const i = LEGEND_ORDER.indexOf(kind as LegendKind);
    return i < 0 ? LEGEND_ORDER.length : i;
  };
  return hits
    .map((hit, i) => ({ hit, i }))
    .sort((a, b) => rank(a.hit) - rank(b.hit) || a.i - b.i)
    .map((x) => x.hit);
}
