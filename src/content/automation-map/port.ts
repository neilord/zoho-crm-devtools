import { billingMessage } from '../../shared/browser';
import {
  automationMapUpgradeCopy,
  mountUpgradeHook,
  UPGRADE_REQUIRED_EVENT,
} from '../billing/upgrade-hook';
import { openRelatedFunctionInCrm, openRuleInCrm } from '../zoho/workflows-page';
import type { AutomationMapStore } from './data/store';
import {
  buildSearchIndex,
  fieldWriters,
  type MapSearchIndex,
  mostWrittenFields,
  searchMap,
  traceFrom,
} from './graph';
import type { AutomationMapSnapshot, FunctionNode, MapFilters } from './types';
import type { MapDataPort } from './ui/context';

export type MapPortStore = Pick<
  AutomationMapStore,
  'subscribe' | 'sourceText' | 'retry' | 'refreshAccess' | 'refresh'
>;
/** The UI port plus the disposer the entry controller calls when the map closes. */
export type StoreMapDataPort = MapDataPort & { dispose(): void };
export interface StorePortDependencies {
  buildSearchIndex?: typeof buildSearchIndex;
  debounceMs?: number;
  openRule?: typeof openRuleInCrm;
  openFunction?: typeof openRelatedFunctionInCrm;
  /** Returns a disposer so closing the map invalidates pending account work. */
  requestUpgrade?: (onEntitled: () => void) => () => void;
}

export function createStorePort(
  store: MapPortStore,
  deps: StorePortDependencies = {},
): StoreMapDataPort {
  let latest: AutomationMapSnapshot;
  let index: MapSearchIndex | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let closeUpgrade: (() => void) | undefined;
  const listeners = new Set<(snapshot: AutomationMapSnapshot) => void>();
  // Rebuild only on graph replacement: authorization must follow the published projection.
  let functions = new Map<string, FunctionNode>();
  const functionNode = (id: string) => functions.get(id);
  const sourceText = (id: string) => (!disposed && functionNode(id) ? store.sourceText(id) : null);
  const unsubscribe = store.subscribe((snapshot) => {
    const changed = !latest || latest.graph !== snapshot.graph;
    latest = snapshot;
    if (changed) {
      functions = new Map();
      for (const node of snapshot.graph.nodes.values())
        if (node.kind === 'function') functions.set(node.delugeId, node);
      // Never serve the previous access generation while the replacement index is pending.
      index = null;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (disposed) return;
        const sources = new Map<string, string>();
        for (const node of functions.values()) {
          const source = store.sourceText(node.delugeId);
          if (source !== null) sources.set(node.delugeId, source);
        }
        index = (deps.buildSearchIndex ?? buildSearchIndex)(latest.graph, sources);
        // Search consumers may rerun their current query after the asynchronous index update.
        for (const listener of listeners) listener(latest);
      }, deps.debounceMs ?? 75);
    }
    for (const listener of listeners) listener(snapshot);
  });
  return {
    snapshot: () => latest,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      listener(latest);
      return () => {
        listeners.delete(listener);
      };
    },
    sourceText,
    search: (query, filters) => (!disposed && index ? searchMap(index, query, filters) : []),
    fieldLens: (module: string, field: string, filters?: MapFilters) => {
      return {
        ...fieldWriters(latest.graph, module, field, filters),
        coverageGaps: latest.coverage.gaps,
      };
    },
    mostWrittenFields: (filters, limit) => mostWrittenFields(latest.graph, filters, limit),
    refresh: () => (disposed ? Promise.resolve() : store.refresh()),
    trace: (id, options) => traceFrom(latest.graph, id, options),
    retry: (id) => (disposed ? Promise.resolve() : store.retry(id)),
    requestUpgrade() {
      if (disposed || closeUpgrade) return;
      const onEntitled = () => {
        if (!disposed) void store.refreshAccess();
      };
      if (deps.requestUpgrade) {
        closeUpgrade = deps.requestUpgrade(onEntitled);
        return;
      }
      const host = document.createElement('div');
      // document.activeElement is the shadow host; preserve the actual map control.
      let invoker = document.activeElement;
      while (invoker?.shadowRoot?.activeElement) invoker = invoker.shadowRoot.activeElement;
      const stop = mountUpgradeHook(
        host,
        { send: billingMessage },
        {
          ...automationMapUpgradeCopy,
          invoker: invoker instanceof HTMLElement ? invoker : undefined,
          onEntitled,
          onClose: () => {
            closeUpgrade?.();
          },
        },
      );
      closeUpgrade = () => {
        closeUpgrade = undefined;
        stop();
      };
      document.dispatchEvent(
        new CustomEvent(UPGRADE_REQUIRED_EVENT, {
          detail: { featureId: 'automationMap', reason: 'paid-required' },
        }),
      );
    },
    openRuleInZoho(id) {
      if (
        !disposed &&
        [...latest.graph.nodes.values()].some((n) => n.kind === 'rule' && n.ruleId === id)
      )
        (deps.openRule ?? openRuleInCrm)(id);
    },
    openFunctionInZoho(id) {
      if (disposed) return;
      const node = functionNode(id);
      if (node?.kind === 'function')
        void (deps.openFunction ?? openRelatedFunctionInCrm)(node.summary).catch(() => {});
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      closeUpgrade?.();
      listeners.clear();
      index = null;
      functions.clear();
    },
  };
}
