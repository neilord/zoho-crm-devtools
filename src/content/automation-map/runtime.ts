import type { AutomationMapUi } from './bootstrap';
import { type AutomationMapDependencies, AutomationMapStore } from './data/store';
import { buildAutomationGraph } from './graph';
import { createStorePort } from './port';
import { canvasStyles, mountBoardView, mountTraceView } from './ui/canvas';
import { mountAutomationMap } from './ui/overlay';

export const createStore = (deps: AutomationMapDependencies) => new AutomationMapStore(deps);
export const createPort = createStorePort;
export const buildGraph = buildAutomationGraph;
export const ui: AutomationMapUi = {
  views: { board: mountBoardView, trace: mountTraceView, styles: canvasStyles },
  mountOverlay(options) {
    const overlay = mountAutomationMap(options);
    return () => overlay.close();
  },
};
