/**
 * Mounts the real Automation Map shell, with the real board and trace canvases, against the
 * synthetic fixture port. Query params: mode=full|teaser|loading|checking|failed|empty|large,
 * scale=large (the 330-rule org, also with mode=teaser), canvas=placeholder (the old stand-ins),
 * animate=1 (progressive loading), open=0 (mount from the page button). The hash restores a view.
 * late=1 opens the map before the graph has loaded and publishes it after a second (Show on
 * map), noise=1 adds unresolved-module and record-only functions to the demo org, gaps=1 reports
 * a large gap total, an old revalidation, unsupported reads and many failed dependencies.
 * lens=dupes adds Deals.Stage writers that count twice unless folded per entity; skew=1 (with
 * mode=teaser) gives the fog a lopsided estate with quiet modules.
 */

import { analyzeDelugeEffects } from '../src/content/automation-map/analyzer';
import {
  buildAutomationGraph,
  buildSearchIndex,
  searchMap,
  traceFrom,
} from '../src/content/automation-map/graph';
import type {
  AutomationMapSnapshot,
  FunctionInput,
  MapCoverage,
} from '../src/content/automation-map/types';
import {
  canvasStyles,
  mountBoardView,
  mountTraceView,
} from '../src/content/automation-map/ui/canvas';
import type {
  MapDataPort,
  MapUiContext,
  MountView,
} from '../src/content/automation-map/ui/context';
import { decodeMapHash } from '../src/content/automation-map/ui/deep-link';
import { mountAutomationMap } from '../src/content/automation-map/ui/overlay';
import {
  fixtureInputs,
  fixtureSources,
  generateLargeInputs,
  lensDupesInputs,
} from '../tests/fixtures/automation-map';
import {
  createFixturePort,
  createLargeFixturePort,
  type FixtureMode,
  queryPort,
  withSkewedFog,
} from '../tests/fixtures/automation-map-port';

type HarnessMode = FixtureMode | 'checking' | 'failed' | 'empty' | 'large';

const params = new URLSearchParams(location.search);
const mode = (params.get('mode') ?? 'full') as HarnessMode;
const animate = params.get('animate') === '1';
const largeScale = params.get('scale') === 'large';
const realCanvas = params.get('canvas') !== 'placeholder';
const late = params.get('late') === '1';
const noise = params.get('noise') === '1';
const gaps = params.get('gaps') === '1';
const lensDupes = params.get('lens') === 'dupes';
const skew = params.get('skew') === '1';

/** About 2,500 nodes, for checking list virtualization and typing latency by hand. */
function largePort(): MapDataPort {
  const inputs = generateLargeInputs();
  const graph = buildAutomationGraph(inputs);
  const sources = new Map(
    inputs.functions.flatMap((f) =>
      f.sourceText === null ? [] : [[f.delugeId, f.sourceText] as const],
    ),
  );
  const index = buildSearchIndex(graph, sources);
  const base = createFixturePort('full');
  const snapshot: AutomationMapSnapshot = { ...base.port.snapshot(), graph };
  return {
    ...base.port,
    snapshot: () => snapshot,
    sourceText: (id) => sources.get(id) ?? null,
    search: (query, filters) => searchMap(index, query, filters),
    ...queryPort(() => snapshot),
    trace: (id, options) => traceFrom(graph, id, options),
  };
}

/** The demo org plus functions that write a module chosen at run time or only change records. */
function noisyPort(): MapDataPort {
  const inputs = fixtureInputs();
  const template = inputs.functions[5] as FunctionInput;
  const sourceOf = (n: number) =>
    n % 3 === 0
      ? 'zoho.crm.invokeConnector("crm.delete",{"module":"Deals","id":recordId});'
      : 'zoho.crm.updateRecord(input.get("module"),recordId,input.get("patch"));';
  const extra: FunctionInput[] = Array.from({ length: 9 }, (_, i) => {
    const n = 100 + i;
    const text = sourceOf(i);
    return {
      ...template,
      delugeId: `f-${n}`,
      summary: {
        ...template.summary,
        id: `f-${n}`,
        api_name: `${i % 3 === 0 ? 'purge' : 'sync'}_records_${n}`,
        display_name: `${i % 3 === 0 ? 'Purge' : 'Sync'} records ${n}`,
      },
      places: [],
      sourceText: text,
      effects: analyzeDelugeEffects(text, {
        functionId: `f-${n}`,
        parameters: ['recordId'],
        catalogue: [],
      }),
    };
  });
  const all = [...inputs.functions, ...extra];
  const graph = buildAutomationGraph({ ...inputs, functions: all });
  const sources = new Map([
    ...fixtureSources(),
    ...extra.map((f) => [f.delugeId, f.sourceText ?? ''] as const),
  ]);
  const index = buildSearchIndex(graph, sources);
  const base = createFixturePort('full');
  const snapshot: AutomationMapSnapshot = { ...base.port.snapshot(), graph };
  return {
    ...base.port,
    snapshot: () => snapshot,
    sourceText: (id) => sources.get(id) ?? null,
    search: (query, filters) => searchMap(index, query, filters),
    ...queryPort(() => snapshot),
    trace: (id, options) => traceFrom(graph, id, options),
  };
}

/** The demo org with writers of Deals.Stage that sit in several groups and call sites. */
function dupesPort(): MapDataPort {
  const inputs = lensDupesInputs();
  const graph = buildAutomationGraph(inputs);
  const sources = new Map(
    inputs.functions.flatMap((f) =>
      f.sourceText === null ? [] : [[f.delugeId, f.sourceText] as const],
    ),
  );
  const index = buildSearchIndex(graph, sources);
  const base = createFixturePort('full');
  const snapshot: AutomationMapSnapshot = { ...base.port.snapshot(), graph };
  return {
    ...base.port,
    snapshot: () => snapshot,
    sourceText: (id) => sources.get(id) ?? null,
    search: (query, filters) => searchMap(index, query, filters),
    ...queryPort(() => snapshot),
    trace: (id, options) => traceFrom(graph, id, options),
  };
}

/** A big org's coverage: hundreds of gaps, an old revalidation, unsupported reads, dozens of failures. */
function withGaps(snapshot: AutomationMapSnapshot): AutomationMapSnapshot {
  const failures: MapCoverage['failures'] = Array.from({ length: 109 }, (_, i) => ({
    id: `dep:${i}`,
    message: 'Zoho configuration could not be read. Retry this dependency.',
    retry: async () => {},
  }));
  return {
    ...snapshot,
    coverage: {
      ...snapshot.coverage,
      gaps: 337,
      lastRevalidatedAt: Date.now() - 4 * 60_000 - 10_000,
      buttons: { loaded: 65, failed: 4, unsupported: 12, state: 'failed' },
      schedules: { loaded: 3, failed: 0, unsupported: 0, state: 'loaded' },
      blueprints: { loaded: 3, failed: 20, unsupported: 6, state: 'failed' },
      approvals: { loaded: 0, failed: 3, unsupported: 0, state: 'failed' },
      failures,
    },
  };
}

function build(): {
  port: MapDataPort;
  push?: (snapshot: AutomationMapSnapshot) => void;
  loaded: AutomationMapSnapshot;
} {
  const base: { port: MapDataPort } =
    mode === 'large'
      ? { port: largePort() }
      : lensDupes
        ? { port: dupesPort() }
        : noise
          ? { port: noisyPort() }
          : largeScale && (mode === 'full' || mode === 'teaser')
            ? { port: createLargeFixturePort(mode === 'teaser') }
            : createFixturePort(
                mode === 'loading' ? 'loading' : mode === 'teaser' ? 'teaser' : 'full',
              );
  if (skew && mode === 'teaser') base.port = withSkewedFog(base.port);
  const original = gaps ? withGaps(base.port.snapshot()) : base.port.snapshot();
  const listeners = new Set<(s: AutomationMapSnapshot) => void>();
  let snapshot: AutomationMapSnapshot = original;
  if (mode === 'checking') snapshot = { ...original, access: { level: 'checking' } };
  if (mode === 'failed')
    snapshot = {
      ...original,
      graph: { nodes: new Map(), edges: [], outgoing: new Map(), incoming: new Map(), modules: [] },
      phase: 'failed',
    };
  if (mode === 'empty')
    snapshot = {
      ...original,
      graph: { nodes: new Map(), edges: [], outgoing: new Map(), incoming: new Map(), modules: [] },
      phase: 'complete',
    };
  // Show on map opens before the rule list has loaded: the graph arrives a moment later.
  if (late)
    snapshot = {
      ...original,
      graph: { nodes: new Map(), edges: [], outgoing: new Map(), incoming: new Map(), modules: [] },
      phase: 'loading',
    };
  const port: MapDataPort = {
    ...base.port,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const push = (next: AutomationMapSnapshot) => {
    snapshot = next;
    for (const l of listeners) l(next);
  };
  return { port, push, loaded: original };
}

const { port, push, loaded } = build();
if (late) setTimeout(() => push?.(loaded), 1200);

/** Progressive loading demo: coverage creeps forward twice a second, then completes. */
if (mode === 'loading' && animate && push) {
  const start = port.snapshot();
  let step = 0;
  const timer = setInterval(() => {
    step++;
    const done = Math.min(1, step / 12);
    const f = start.coverage.functions;
    const analysed = Math.round(
      (f.listed - f.limited - f.unsupported - f.sourceUnavailable - f.failed) * done,
    );
    push({
      ...start,
      phase: done >= 1 ? 'complete' : 'enriching',
      coverage: {
        ...start.coverage,
        isComplete: done >= 1,
        rules: {
          ...start.coverage.rules,
          detailed: Math.round(start.coverage.rules.listed * done),
        },
        functions: {
          ...f,
          analyzed: analysed,
          pending: f.listed - analysed - f.limited - f.unsupported - f.sourceUnavailable - f.failed,
        },
      },
    });
    if (done >= 1) clearInterval(timer);
  }, 500);
}

const note = (text: string): HTMLElement => {
  const p = document.createElement('p');
  p.textContent = text;
  p.style.cssText = 'margin:0;padding:6px 10px;font:12px/1.4 system-ui;color:#6b7488';
  return p;
};

const placeholder =
  (title: string): MountView =>
  (container: HTMLElement, context: MapUiContext) => {
    const wrap = document.createElement('div');
    wrap.className = 'harness-canvas';
    const h = document.createElement('h3');
    h.textContent = `${title} placeholder`;
    wrap.append(h, note('The real canvas is injected through `views`. This stands in for it.'));
    const row = document.createElement('div');
    row.className = 'harness-row';
    const snap = context.port.snapshot();
    for (const node of snap.graph.nodes.values()) {
      if (node.kind !== 'rule' && node.kind !== 'function') continue;
      if (row.childElementCount >= 8) break;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = node.label;
      b.addEventListener('click', () =>
        context.view.set({ selectedId: node.id, inspectorOpen: true }),
      );
      row.append(b);
    }
    wrap.append(row);
    const state = document.createElement('pre');
    wrap.append(state);
    const paint = () => {
      const s = context.view.get();
      state.textContent = `selected: ${s.selectedId ?? '-'}\ntrace root: ${s.traceRootId ?? '-'}\ndepth: ${s.traceDepth.upstream}/${s.traceDepth.downstream}\nfocus: ${s.focusModuleApiName ?? '-'}`;
    };
    paint();
    const off = context.view.subscribe(paint);
    container.append(wrap);
    return () => {
      off();
      wrap.remove();
    };
  };

const styles = `
.harness-canvas { position:absolute; inset:0; padding:24px; background:#f3f5f9; overflow:auto; }
.harness-canvas h3 { margin:0 0 4px; }
.harness-row { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; }
.harness-row button { padding:6px 10px; border:1px solid #dfe4ee; border-radius:8px; background:#fff; font:inherit; cursor:pointer; }
.harness-canvas pre { font:12px/1.5 ui-monospace,monospace; color:#3d4657; }
`;

const open = () => {
  const handle = mountAutomationMap({
    port,
    views: realCanvas
      ? { board: mountBoardView, trace: mountTraceView, styles: canvasStyles }
      : { board: placeholder('Board'), trace: placeholder('Trace'), styles },
    // Screenshots are deterministic URLs: the hash is passed as trusted initial state.
    initialState: decodeMapHash(location.hash)?.state,
    onClose: () => {
      (window as unknown as { __am?: unknown }).__am = undefined;
    },
  });
  (window as unknown as { __am?: unknown }).__am = handle;
};

document.getElementById('open-map')?.addEventListener('click', open);
if (params.get('open') !== '0') open();
