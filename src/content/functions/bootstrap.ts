import { loadSettings } from '../../settings/storage';
import { findCreateFunctionButton, isFunctionsListLocation } from '../zoho/functions-page';
import { resolveCrmContext } from './crm-context';
import { openFunctionSearchOverlay } from './overlay';
import { injectSearchButton, SEARCH_BUTTON_ID } from './toolbar-button';

/**
 * Wires the function-search feature into the functions list page: it keeps a
 * "Search Functions" button present next to Zoho's "Create Function" control and
 * opens the search overlay on click. Zoho is a single-page app, so we re-check on
 * DOM mutations rather than once at load.
 */
export async function bootstrapFunctionSearch(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.enabled) {
    return;
  }

  const ensureButton = (): void => {
    if (!isFunctionsListLocation() || document.getElementById(SEARCH_BUTTON_ID)) {
      return;
    }
    const anchor = findCreateFunctionButton();
    if (!anchor) {
      return;
    }
    injectSearchButton(anchor, openOverlay);
  };

  const openOverlay = (): void => {
    const context = resolveCrmContext();
    if (!context) {
      console.warn('Zoho CRM DevTools: could not resolve the CRM org context.');
      return;
    }
    openFunctionSearchOverlay(context);
  };

  ensureButton();

  const observer = new MutationObserver(() => ensureButton());
  observer.observe(document.body, { childList: true, subtree: true });
}
