import { automationMapComingSoon } from '../../features/automation-map-gate';
import { loadSettings } from '../../settings/storage';
import { billingMessage } from '../../shared/browser';
import { isWorkflowOrigin } from '../../shared/workflow-cache-protocol';
import { closeUpgradeModals } from '../billing/upgrade-hook';
import { closeOverlay as closeFunctionSearch } from '../functions/overlay';
import { closeWorkflowSearchOverlay } from '../workflows/overlay';
import { injectAutomationMapButton, removeAutomationMapButton } from '../workflows/toolbar-button';
import { type CrmContext, resolveCrmContext } from '../zoho/crm-context';
import { isWorkflowsListLocation } from '../zoho/workflows-page';
import type { AutomationMapDependencies, AutomationMapStore } from './data/store';
import {
  hasAutomationMapHash,
  OPEN_AUTOMATION_MAP_EVENT,
  type OpenAutomationMapOptions,
} from './entry/request';
import { reconcileSettingsMapEntry, removeSettingsMapEntries } from './entry/settings';
import { showAutomationMapWaitlist } from './entry/waitlist';
import type { MapPortStore } from './port';
import type { MapDataPort, MapViewState, MountView } from './ui/context';

export type { OpenAutomationMapOptions } from './entry/request';
export interface AutomationMapOverlayOptions {
  port: MapDataPort;
  views: { board: MountView; trace: MountView; styles: string };
  initialState: Partial<MapViewState>;
  initialHash?: string;
  onClose(): void;
}
export interface AutomationMapUi {
  mountOverlay(options: AutomationMapOverlayOptions): () => void;
  views: AutomationMapOverlayOptions['views'];
}

// Keep all map analysis, data and rendering code off ordinary CRM pages.
let runtime: typeof import('./runtime') | undefined;
export async function resolveUi(): Promise<AutomationMapUi> {
  runtime ??= await import('./runtime');
  return runtime.ui;
}

function loadedRuntime(): NonNullable<typeof runtime> {
  if (!runtime) throw new Error('Automation Map runtime has not loaded');
  return runtime;
}

type EntryStore = MapPortStore & Pick<AutomationMapStore, 'start' | 'dispose'>;
export interface AutomationMapEntryDependencies {
  isEnabled(): Promise<boolean>;
  /** True while the map is gated behind the Coming soon waitlist (ADR 0035). */
  comingSoon(): boolean;
  showWaitlist(options: { onClose(): void }): { close(): void };
  context(): CrmContext | null;
  resolveUi(): Promise<AutomationMapUi>;
  createStore(deps: AutomationMapDependencies): EntryStore;
  createPort(store: EntryStore): MapDataPort & { dispose(): void };
  buildGraph: AutomationMapDependencies['buildGraph'];
  fetch: AutomationMapDependencies['fetch'];
  getEntitlement: AutomationMapDependencies['getEntitlement'];
}
const defaults: AutomationMapEntryDependencies = {
  isEnabled: async () => (await loadSettings()).enabled,
  comingSoon: automationMapComingSoon,
  showWaitlist: (options) => showAutomationMapWaitlist(options),
  context: () => (isWorkflowOrigin(location.origin) ? resolveCrmContext() : null),
  resolveUi,
  createStore: (deps) => loadedRuntime().createStore(deps),
  createPort: (store) => loadedRuntime().createPort(store),
  buildGraph: (inputs) => loadedRuntime().buildGraph(inputs),
  fetch: (url, init) => fetch(url, init),
  getEntitlement: () => billingMessage('billing:getEntitlement'),
};
export interface AutomationMapEntryController {
  openAutomationMap(options: OpenAutomationMapOptions): Promise<void>;
  dispose(): void;
}
let controller: AutomationMapEntryController | undefined;
/** Opens at most one overlay per tab. Entry points never pre-gate the free preview. */
export async function openAutomationMap(options: OpenAutomationMapOptions): Promise<void> {
  await controller?.openAutomationMap(options);
}

export function startAutomationMapEntryPoints(
  overrides: Partial<AutomationMapEntryDependencies> = {},
): AutomationMapEntryController {
  controller?.dispose();
  const deps = { ...defaults, ...overrides };
  let disposed = false;
  let enabled = false;
  let checking = false;
  let generation = 0;
  let active: { context: CrmContext; close(): void } | undefined;
  let opening: Promise<void> | undefined;
  let seenHash: string | undefined;
  let scheduled = false;
  const sameContext = (context: CrmContext) => {
    const current = deps.context();
    return current?.orgId === context.orgId && current.origin === context.origin;
  };
  /** A reload (or the reconcile loop) must not reopen the popup from the link that opened it. */
  const stripMapHash = () => {
    if (!hasAutomationMapHash(location.hash)) return;
    history.replaceState(history.state, '', location.pathname + location.search);
    seenHash = undefined;
  };
  const close = () => {
    generation++;
    active?.close();
    active = undefined;
  };
  const open = (options: OpenAutomationMapOptions): Promise<void> => {
    if (disposed || active) return Promise.resolve();
    if (opening) return opening;
    const mine = generation;
    opening = (async () => {
      if (!(await deps.isEnabled()) || disposed || mine !== generation) return;
      const context = deps.context();
      if (!context) return;
      if (deps.comingSoon()) {
        // Gated: show the waitlist and stop. The runtime is never imported and nothing reads Zoho.
        enabled = true;
        closeWorkflowSearchOverlay();
        closeFunctionSearch();
        closeUpgradeModals();
        stripMapHash();
        let done = false;
        const handle = deps.showWaitlist({
          onClose() {
            if (done) return;
            done = true;
            stripMapHash();
            if (active?.close === dismissWaitlist) active = undefined;
          },
        });
        const dismissWaitlist = () => handle.close();
        active = { context, close: dismissWaitlist };
        return;
      }
      const ui = await deps.resolveUi();
      const stillEnabled = await deps.isEnabled();
      if (disposed || mine !== generation || !sameContext(context) || !stillEnabled) return;
      enabled = true;
      closeWorkflowSearchOverlay();
      closeFunctionSearch();
      closeUpgradeModals();
      const store = deps.createStore({
        context,
        fetch: deps.fetch,
        getEntitlement: deps.getEntitlement,
        buildGraph: deps.buildGraph,
        isCurrentContext: () => !disposed && sameContext(context),
      });
      const port = deps.createPort(store);
      let unmount: (() => void) | undefined;
      let closed = false;
      const disposeOverlay = () => {
        if (closed) return;
        closed = true;
        // Closing from the UI pops its history entry, which lands after this: until then the
        // map's own hash is still in the URL and must not read as a fresh link to open.
        seenHash = hasAutomationMapHash(location.hash)
          ? `${context.origin}/${context.orgId}/${location.hash}`
          : undefined;
        port.dispose();
        store.dispose();
        unmount?.();
        if (active?.close === disposeOverlay) active = undefined;
      };
      active = { context, close: disposeOverlay };
      try {
        unmount = ui.mountOverlay({
          port,
          views: ui.views,
          initialState:
            options.entry === 'hash'
              ? {}
              : {
                  view: options.entry === 'settings' ? 'fields' : 'board',
                  field: null,
                  selectedId: options.focus?.ruleId ? `rule:${options.focus.ruleId}` : null,
                  focusModuleApiName: options.focus?.moduleApiName ?? null,
                  inspectorOpen: !!options.focus?.ruleId,
                },
          initialHash:
            options.initialHash ?? (options.entry === 'hash' ? location.hash : undefined),
          onClose: disposeOverlay,
        });
        // A mount implementation may close synchronously (e.g. invalid deep link).
        if (closed) unmount();
        else void store.start().catch(() => {});
      } catch (error) {
        disposeOverlay();
        throw error;
      }
    })().finally(() => {
      opening = undefined;
    });
    return opening;
  };
  const fromSettings = () => {
    void open({ entry: 'settings' });
  };
  const fromToolbar = () => {
    void open({ entry: 'toolbar' });
  };
  const reconcile = () => {
    if (disposed) return;
    if (active && (!enabled || !sameContext(active.context))) close();
    const context = enabled ? deps.context() : null;
    reconcileSettingsMapEntry(fromSettings, !!context);
    if (context && isWorkflowsListLocation()) injectAutomationMapButton(fromToolbar);
    else removeAutomationMapButton();
    const hashKey = context ? `${context.origin}/${context.orgId}/${location.hash}` : undefined;
    if (!hasAutomationMapHash(location.hash)) seenHash = undefined;
    else if (context && hashKey !== seenHash) {
      seenHash = hashKey;
      void open({ entry: 'hash', initialHash: location.hash });
    }
  };
  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      reconcile();
    });
  };
  const check = async () => {
    if (checking || disposed) return;
    checking = true;
    try {
      enabled = await deps.isEnabled();
    } catch {
      enabled = false;
    } finally {
      checking = false;
    }
    if (!enabled) {
      close();
      seenHash = undefined;
    }
    reconcile();
  };
  const onRequest = (event: Event) => {
    const detail = (event as CustomEvent<OpenAutomationMapOptions>).detail;
    if (detail && ['settings', 'toolbar', 'rule', 'hash'].includes(detail.entry)) void open(detail);
  };
  const mutations = new MutationObserver(schedule);
  mutations.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);
  document.addEventListener(OPEN_AUTOMATION_MAP_EVENT, onRequest);
  // Lyte can use pushState without a DOM change. Also detect settings changes without direct browser APIs.
  const timer = setInterval(() => {
    reconcile();
    void check();
  }, 250);
  const result: AutomationMapEntryController = {
    openAutomationMap: open,
    dispose() {
      if (disposed) return;
      disposed = true;
      close();
      mutations.disconnect();
      clearInterval(timer);
      window.removeEventListener('popstate', schedule);
      window.removeEventListener('hashchange', schedule);
      document.removeEventListener(OPEN_AUTOMATION_MAP_EVENT, onRequest);
      removeSettingsMapEntries();
      removeAutomationMapButton();
      if (controller === result) controller = undefined;
    },
  };
  controller = result;
  void check();
  return result;
}
