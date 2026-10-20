import { loadSettings } from '../../settings/storage';
import { resolveCrmContext } from '../zoho/crm-context';
import {
  findWorkflowSearchButtonAnchor,
  isWorkflowsListLocation,
  observeWorkflowSearchAnchor,
} from '../zoho/workflows-page';
import {
  closeWorkflowSearchOverlay,
  isWorkflowSearchOverlayOpen,
  openWorkflowSearchOverlay,
} from './overlay';
import {
  injectWorkflowSearchButton,
  removeWorkflowSearchButton,
  WORKFLOW_SEARCH_BUTTON_ID,
} from './toolbar-button';

export interface WorkflowBootstrapDependencies {
  isEnabled(): Promise<boolean>;
  observeAnchor: typeof observeWorkflowSearchAnchor;
  open: typeof openWorkflowSearchOverlay;
}

const defaults: WorkflowBootstrapDependencies = {
  isEnabled: async () => (await loadSettings()).enabled,
  observeAnchor: observeWorkflowSearchAnchor,
  open: openWorkflowSearchOverlay,
};

/**
 * Keeps a "Search All Workflows" button beside the native search on Setup →
 * Workflow Rules. Zoho is a single-page app that remounts this toolbar freely, so
 * the anchor observer reports each replacement; a cheap mutation check re-seats
 * the button when Zoho re-renders the toolbar around the same anchor. Returns a
 * disposer (used by tests).
 */
export async function bootstrapWorkflowSearch(
  deps: WorkflowBootstrapDependencies = defaults,
): Promise<() => void> {
  if (!(await deps.isEnabled())) return () => {};

  let disposed = false;
  let anchor: HTMLElement | null = null;
  const openOverlay = (button: HTMLButtonElement): void => {
    const context = resolveCrmContext();
    if (!context) {
      console.warn('Zoho CRM DevTools: could not resolve the CRM org context.');
      return;
    }
    deps.open(context, button);
  };
  const place = (): void => {
    if (!disposed && anchor?.isConnected) injectWorkflowSearchButton(anchor, openOverlay);
  };

  const stopObserving = deps.observeAnchor((next) => {
    anchor = next;
    if (next) {
      place();
      return;
    }
    // Leaving the page (or a momentary remount): the overlay belongs to a specific
    // route, so close it only when the route really changed.
    removeWorkflowSearchButton();
    if (!isWorkflowsListLocation() && isWorkflowSearchOverlayOpen()) closeWorkflowSearchOverlay();
  });

  let scheduled = false;
  const mutations = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed) return;
      if (!anchor?.isConnected) {
        anchor = isWorkflowsListLocation() ? findWorkflowSearchButtonAnchor() : null;
      }
      const button = document.getElementById(WORKFLOW_SEARCH_BUTTON_ID);
      if (anchor && (!button || anchor.nextElementSibling !== button)) place();
    });
  });
  mutations.observe(document.body, { childList: true, subtree: true });

  return () => {
    disposed = true;
    stopObserving();
    mutations.disconnect();
    removeWorkflowSearchButton();
    closeWorkflowSearchOverlay();
  };
}
