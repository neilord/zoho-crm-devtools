/** Shared helpers for the Automation Map UI tests (jsdom). Not a test file. */
import {
  buildAutomationGraph,
  buildSearchIndex,
  searchMap,
  traceFrom,
} from '../src/content/automation-map/graph';
import type {
  AutomationGraph,
  AutomationGraphInputs,
  AutomationMapSnapshot,
} from '../src/content/automation-map/types';
import type {
  MapDataPort,
  MapUiContext,
  MapViewState,
  MountView,
  ViewStore,
} from '../src/content/automation-map/ui/context';
import { HOST_ID, mountAutomationMap } from '../src/content/automation-map/ui/overlay';
import { createFixturePort, type FixtureMode, queryPort } from './fixtures/automation-map-port';

export interface RecordedViews {
  views: { board: MountView; trace: MountView; styles: string };
  /** Captured on the first canvas mount, so tests can read and drive the shared store. */
  store(): ViewStore;
  mounts: { board: number; trace: number };
  disposed: { board: number; trace: number };
}

export function recordingViews(): RecordedViews {
  let store: ViewStore | null = null;
  const mounts = { board: 0, trace: 0 };
  const disposed = { board: 0, trace: 0 };
  const view =
    (kind: 'board' | 'trace'): MountView =>
    (container: HTMLElement, context: MapUiContext) => {
      store = context.view;
      mounts[kind]++;
      const node = document.createElement('div');
      node.dataset.canvas = kind;
      node.tabIndex = 0;
      container.append(node);
      return () => {
        disposed[kind]++;
        node.remove();
      };
    };
  return {
    views: { board: view('board'), trace: view('trace'), styles: '' },
    store: () => {
      if (!store) throw new Error('No canvas has been mounted yet; start on the board first.');
      return store;
    },
    mounts,
    disposed,
  };
}

export interface MountedMap {
  handle: { close(): void };
  host: HTMLElement;
  shadow: ShadowRoot;
  port: MapDataPort;
  calls: ReturnType<typeof createFixturePort>['calls'];
  recorded: RecordedViews;
  q<T extends HTMLElement = HTMLElement>(selector: string): T | null;
  qa<T extends HTMLElement = HTMLElement>(selector: string): T[];
  closed: { count: number };
  /** Publishes a snapshot to the overlay, as the store would. */
  publish(snapshot: AutomationMapSnapshot): void;
}

export function mountMap(
  options: {
    mode?: FixtureMode;
    port?: MapDataPort;
    initialState?: Partial<MapViewState>;
    snapshot?: AutomationMapSnapshot;
    parent?: HTMLElement;
  } = {},
): MountedMap {
  const fixture = createFixturePort(options.mode ?? 'full');
  const base = options.port ?? fixture.port;
  let snapshot = options.snapshot ?? base.snapshot();
  const listeners = new Set<(s: AutomationMapSnapshot) => void>();
  const port: MapDataPort = {
    ...base,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const recorded = recordingViews();
  const closed = { count: 0 };
  const handle = mountAutomationMap({
    port,
    views: recorded.views,
    initialState: options.initialState,
    onClose: () => {
      closed.count++;
    },
    host: options.parent,
  });
  const host = (options.parent ?? document.body).querySelector<HTMLElement>(
    `#${HOST_ID}`,
  ) as HTMLElement;
  const shadow = host.shadowRoot as ShadowRoot;
  return {
    handle,
    host,
    shadow,
    port,
    calls: fixture.calls,
    recorded,
    closed,
    q: (selector) => shadow.querySelector(selector),
    qa: (selector) => [...shadow.querySelectorAll(selector)] as never,
    publish(next) {
      snapshot = next;
      for (const l of listeners) l(next);
    },
  };
}

export function key(
  target: EventTarget,
  keyName: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: keyName,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

export const click = (node: Element | null | undefined) => {
  if (!node) throw new Error('click target missing');
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
};

export const flush = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Text and every attribute value of the whole overlay tree, for leak scans. */
export function everything(root: ShadowRoot): string {
  const parts: string[] = [root.textContent ?? ''];
  for (const el of root.querySelectorAll('*'))
    for (const attr of el.getAttributeNames()) parts.push(el.getAttribute(attr) ?? '');
  return parts.join('\n');
}

/** A full-access port over an arbitrary graph (large or hostile fixtures). */
export function portForInputs(
  inputs: AutomationGraphInputs,
  overrides: Partial<AutomationMapSnapshot> = {},
): { port: MapDataPort; graph: AutomationGraph; snapshot: AutomationMapSnapshot } {
  const graph = buildAutomationGraph(inputs);
  const sources = new Map(
    inputs.functions.flatMap((f) =>
      f.sourceText === null ? [] : [[f.delugeId, f.sourceText] as const],
    ),
  );
  const index = buildSearchIndex(graph, sources);
  const base = createFixturePort('full').port.snapshot();
  const snapshot: AutomationMapSnapshot = { ...base, graph, ...overrides };
  const port: MapDataPort = {
    snapshot: () => snapshot,
    subscribe: () => () => {},
    sourceText: (id) => sources.get(id) ?? null,
    search: (query, filters) => searchMap(index, query, filters),
    ...queryPort(() => snapshot),
    trace: (id, options) => traceFrom(graph, id, options),
    retry: async () => {},
    refresh: async () => {},
    requestUpgrade: () => {},
    openRuleInZoho: () => {},
    openFunctionInZoho: () => {},
  };
  return { port, graph, snapshot };
}

/** Mounts on the board so the canvas captures the shared store, then moves to `state`. */
export function mountWithStore(
  state: Partial<MapViewState>,
  options: Parameters<typeof mountMap>[0] = {},
): MountedMap {
  const map = mountMap({ ...options, initialState: { view: 'board' } });
  map.recorded.store().set(state);
  return map;
}
