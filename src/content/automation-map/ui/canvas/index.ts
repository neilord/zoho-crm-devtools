/**
 * Automation Map canvas views: the board (module islands with semantic zoom, plus the fog
 * teaser) and the trace flowchart. The shell mounts them through `MountView` and injects
 * `canvasStyles` into its shadow root.
 */
import type { AutomationMapSnapshot } from '../../types';
import type { MapUiContext, MountView } from '../context';
import { type BoardController, createBoard } from './board';
import canvasCss from './canvas.css?inline';
import { createFogPlugin } from './fog';
import fogCss from './fog.css?inline';
import { createTraceView, type TraceController } from './trace';
import traceCss from './trace.css?inline';

export const canvasStyles: string = [canvasCss, traceCss, fogCss].join('\n');

const controllers = new WeakMap<HTMLElement, BoardController>();
const traceControllers = new WeakMap<HTMLElement, TraceController>();

/** Test and harness access to the mounted board for a container. */
export const boardControllerFor = (container: HTMLElement): BoardController | undefined =>
  controllers.get(container);

export const traceControllerFor = (container: HTMLElement): TraceController | undefined =>
  traceControllers.get(container);

/**
 * Same key = same renderer. A change of plan, of the teaser's contents (compared by value, since
 * a store may publish a fresh equal object) or of the revealed module's totals remounts from a
 * clean DOM; anything else only refreshes.
 */
function rendererKey(snap: AutomationMapSnapshot): string {
  if (snap.access.level !== 'teaser') return 'full';
  const module = snap.access.revealedModuleApiName;
  const node = module ? snap.graph.nodes.get(`module:${module}`) : undefined;
  const totals = node?.kind === 'module' ? `${node.counts.rules}/${node.counts.functions}` : '';
  return `teaser:${module ?? ''}:${totals}:${JSON.stringify(snap.teaser)}`;
}

function createForSnapshot(
  container: HTMLElement,
  ctx: MapUiContext,
  snap: AutomationMapSnapshot,
): BoardController {
  if (snap.access.level !== 'teaser') return createBoard(container, ctx);
  const module = snap.access.revealedModuleApiName;
  const node = module ? snap.graph.nodes.get(`module:${module}`) : undefined;
  const revealed =
    module && node?.kind === 'module'
      ? {
          moduleApiName: module,
          label: node.label,
          totalRules: node.counts.rules,
          totalFunctions: node.counts.functions,
        }
      : null;
  const teaser = snap.teaser ?? { fogged: [], totals: { rules: 0, functions: 0, modules: 0 } };
  return createBoard(container, ctx, createFogPlugin({ teaser, revealed }));
}

export const mountBoardView: MountView = (container, ctx) => {
  let snap = ctx.port.snapshot();
  let key = rendererKey(snap);
  let board = createForSnapshot(container, ctx, snap);
  controllers.set(container, board);
  const off = ctx.port.subscribe(() => {
    const next = ctx.port.snapshot();
    const nextKey = rendererKey(next);
    if (nextKey !== key) {
      // Entitlement changed: drop every view's DOM before anything of the other mode renders.
      board.dispose();
      container.textContent = '';
      key = nextKey;
      snap = next;
      board = createForSnapshot(container, ctx, snap);
      controllers.set(container, board);
    } else {
      board.refresh();
    }
  });
  return () => {
    off();
    controllers.delete(container);
    board.dispose();
  };
};

export const mountTraceView: MountView = (container, ctx) => {
  const trace = createTraceView(container, ctx);
  traceControllers.set(container, trace);
  return () => {
    traceControllers.delete(container);
    trace.dispose();
  };
};

export type { BoardController, MapUiContext, TraceController };
