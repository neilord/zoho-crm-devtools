/** Shared helpers for the Automation Map canvas tests (jsdom has no layout, canvas or matchMedia). */
import { vi } from 'vitest';
import {
  buildAutomationGraph,
  buildSearchIndex,
  searchMap,
  traceFrom,
} from '../src/content/automation-map/graph';
import type {
  AutomationGraph,
  AutomationMapSnapshot,
  MapCoverage,
  MapFilters,
} from '../src/content/automation-map/types';
import type {
  MapDataPort,
  MapUiContext,
  MapViewState,
  ViewStore,
} from '../src/content/automation-map/ui/context';
import { fixtureInputs, fixtureSources } from './fixtures/automation-map';
import { queryPort } from './fixtures/automation-map-port';

export const defaultFilters = (): MapFilters => ({
  scope: 'active',
  modules: new Set(),
  kinds: new Set(),
  triggerTypes: new Set(),
  flags: new Set(),
});

/** Reduced motion makes camera moves jump, and a null canvas context skips bitmap painting. */
export function installDomStubs(): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
}

export function createStore(patch: Partial<MapViewState> = {}): ViewStore & {
  sets: Array<Partial<MapViewState>>;
} {
  let state: MapViewState = {
    view: 'board',
    field: null,
    selectedId: null,
    hoverId: null,
    traceRootId: null,
    traceDepth: { upstream: 2, downstream: 3 },
    focusModuleApiName: null,
    camera: { x: 0, y: 0, zoom: 1 },
    query: '',
    filters: defaultFilters(),
    inspectorOpen: false,
    ...patch,
  };
  const listeners = new Set<(n: Readonly<MapViewState>, p: Readonly<MapViewState>) => void>();
  const sets: Array<Partial<MapViewState>> = [];
  return {
    sets,
    get: () => state,
    set(p) {
      sets.push(p);
      const prev = state;
      state = { ...state, ...p };
      for (const l of [...listeners]) l(state, prev);
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const coverage = (): MapCoverage => ({
  rules: { listed: 0, detailed: 0, failed: 0, total: 0 },
  functions: {
    listed: 0,
    analyzed: 0,
    limited: 0,
    unsupported: 0,
    sourceUnavailable: 0,
    pending: 0,
    failed: 0,
  },
  buttons: { loaded: 0, failed: 0, state: 'loaded' },
  schedules: { loaded: 0, failed: 0, state: 'loaded' },
  blueprints: { loaded: 0, failed: 0, state: 'loaded' },
  approvals: { loaded: 0, failed: 0, state: 'loaded' },
  gaps: 0,
  isComplete: true,
  refreshing: false,
  failures: [],
});

/** A full-access port over any graph; the snapshot can be replaced to simulate access changes. */
export function portFor(
  graph: AutomationGraph,
  sources: ReadonlyMap<string, string> = new Map(),
): MapDataPort & {
  publish(next: AutomationMapSnapshot): void;
  upgrades: number;
  traceOverrides: { maxNodes?: number };
} {
  const index = buildSearchIndex(graph, sources);
  let snapshot: AutomationMapSnapshot = {
    access: { level: 'full' },
    graph,
    teaser: null,
    coverage: coverage(),
    phase: 'complete',
  };
  const listeners = new Set<(s: AutomationMapSnapshot) => void>();
  const state = { upgrades: 0 };
  const traceOverrides: { maxNodes?: number } = {};
  const port = {
    snapshot: () => snapshot,
    subscribe(l: (s: AutomationMapSnapshot) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    sourceText: (id: string) => sources.get(id) ?? null,
    search: (q: string, f: MapFilters) => searchMap(index, q, f),
    ...queryPort(() => snapshot),
    trace: (id: string, o: Parameters<MapDataPort['trace']>[1]) =>
      traceFrom(snapshot.graph, id, { ...o, maxNodes: traceOverrides.maxNodes ?? o.maxNodes }),
    retry: async () => {},
    refresh: async () => {},
    requestUpgrade: () => {
      state.upgrades++;
    },
    openRuleInZoho: () => {},
    openFunctionInZoho: () => {},
    publish(next: AutomationMapSnapshot) {
      snapshot = next;
      for (const l of [...listeners]) l(next);
    },
    get upgrades() {
      return state.upgrades;
    },
    traceOverrides,
  };
  return port;
}

export function fixturePort() {
  return portFor(buildAutomationGraph(fixtureInputs()), fixtureSources());
}

export function makeContext(
  port: MapDataPort,
  patch: Partial<MapViewState> = {},
): { ctx: MapUiContext; store: ReturnType<typeof createStore> } {
  const store = createStore(patch);
  const root = document.createElement('div').attachShadow({ mode: 'open' });
  return { ctx: { port, view: store, root }, store };
}

export function attach(): HTMLElement {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
}

/** Dispatch pointer-ish events in jsdom (PointerEvent may be missing). */
export function fire(el: Element, type: string, init: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

export function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
}
