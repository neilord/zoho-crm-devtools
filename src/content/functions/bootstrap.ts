import { loadSettings } from '../../settings/storage';
import {
  findCreateFunctionButton,
  findFunctionSearchButtonAnchor,
  isFunctionsListLocation,
} from '../zoho/functions-page';
import { resolveCrmContext } from './crm-context';
import { openFunctionSearchOverlay } from './overlay';
import { injectSearchButton } from './toolbar-button';

/**
 * Wires the function-search feature into the functions list page: it keeps a
 * "Search All Functions" button present next to Zoho's native functions search
 * control and opens the search overlay on click. Zoho is a single-page app, so
 * we re-check on DOM mutations rather than once at load.
 */
export async function bootstrapFunctionSearch(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.enabled) {
    return;
  }

  const ensureButton = (): void => {
    if (!isFunctionsListLocation()) {
      return;
    }

    const searchAnchor = findFunctionSearchButtonAnchor();
    if (searchAnchor) {
      injectSearchButton(searchAnchor, openOverlay, 'after');
      return;
    }

    const createAnchor = findCreateFunctionButton();
    if (createAnchor) {
      injectSearchButton(createAnchor, openOverlay, 'before');
    }
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
