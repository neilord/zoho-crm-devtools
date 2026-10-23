/**
 * Development harness for the Automation Map canvas (board, trace and fog teaser).
 * Mounts the real views full-screen inside a shadow root (as the overlay does) against the
 * synthetic port. Query params:
 *   mode=full|teaser|loading   view=board|trace   scale=large (also with mode=teaser)   scope=active|everything
 *   cam=x,y,zoom   focus=<module api name>   sel=<node id>   trace=<node id>   q=<search text>
 *   inspector=1 (reserve the inspector's width)   still=1 (no motion)
 * `window.__am` exposes the store, the port and render stats for Playwright and perf checks.
 */
import type { MapFilters } from '../src/content/automation-map/types';
import {
  boardControllerFor,
  canvasStyles,
  mountBoardView,
  mountTraceView,
  traceControllerFor,
} from '../src/content/automation-map/ui/canvas';
import type {
  MapDataPort,
  MapUiContext,
  MapViewState,
  ViewStore,
} from '../src/content/automation-map/ui/context';
import tokens from '../src/content/automation-map/ui/tokens.css?inline';
import {
  createFixturePort,
  createLargeFixturePort,
  type FixtureMode,
} from '../tests/fixtures/automation-map-port';

const params = new URLSearchParams(location.search);
const mode = (params.get('mode') ?? 'full') as FixtureMode;
const startView = params.get('view') === 'trace' ? 'trace' : 'board';
const large = params.get('scale') === 'large';

const fixture = large ? null : createFixturePort(mode);
const port: MapDataPort = large
  ? createLargeFixturePort(mode === 'teaser')
  : (fixture as NonNullable<typeof fixture>).port;

const filters: MapFilters = {
  scope: params.get('scope') === 'everything' ? 'everything' : 'active',
  modules: new Set(),
  kinds: new Set(),
  triggerTypes: new Set(),
  flags: new Set(),
};
const camParam = params.get('cam')?.split(',').map(Number);
let state: MapViewState = {
  view: startView,
  field: null,
  selectedId: params.get('sel'),
  hoverId: null,
  traceRootId: params.get('trace'),
  traceDepth: { upstream: 2, downstream: 3 },
  focusModuleApiName: params.get('focus'),
  camera:
    camParam && camParam.length === 3 && camParam.every(Number.isFinite)
      ? { x: camParam[0], y: camParam[1], zoom: camParam[2] }
      : { x: 0, y: 0, zoom: 1 },
  query: params.get('q') ?? '',
  filters,
  inspectorOpen: params.get('inspector') === '1',
};
const listeners = new Set<(n: Readonly<MapViewState>, p: Readonly<MapViewState>) => void>();
const store: ViewStore = {
  get: () => state,
  set(patch) {
    const prev = state;
    state = { ...state, ...patch };
    for (const l of [...listeners]) l(state, prev);
  },
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

const app = document.getElementById('app') as HTMLElement;
const shadow = app.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = `${tokens}\n${canvasStyles}\n.am-root{position:absolute;inset:0}.host{position:absolute;inset:0}`;
const root = document.createElement('div');
root.className = 'am-root';
const host = document.createElement('div');
host.className = 'host';
root.append(host);
shadow.append(style, root);
if (params.get('still') === '1') root.classList.add('amc-still');

const ctx: MapUiContext = { port, view: store, root: shadow };
let dispose: (() => void) | null = null;
let mountedView: string | null = null;
function mount() {
  if (mountedView === state.view) return;
  dispose?.();
  host.textContent = '';
  mountedView = state.view;
  dispose = (state.view === 'trace' ? mountTraceView : mountBoardView)(host, ctx);
}
store.subscribe(() => mount());
mount();

(window as unknown as { __am: unknown }).__am = {
  store,
  port,
  host,
  shadow,
  board: () => boardControllerFor(host),
  trace: () => traceControllerFor(host),
};
