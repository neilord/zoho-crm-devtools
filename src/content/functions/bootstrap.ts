import { loadSettings } from '../../settings/storage';
import {
  findCreateFunctionButton,
  findFunctionSearchButtonAnchor,
  isFunctionsListLocation,
} from '../zoho/functions-page';
import { resolveCrmContext } from './crm-context';
import { EXPORT_MOUNT_ID, mountFunctionExport } from './export-ui';
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

  let exportMount: { root: HTMLElement; dispose(): void } | undefined;
  const ensureExport = (anchor: HTMLElement | null): void => {
    const toolbar = anchor?.parentElement;
    if (!toolbar) return;
    if (exportMount?.root.isConnected) {
      if (anchor.nextElementSibling !== exportMount.root) anchor.after(exportMount.root);
      return;
    }
    exportMount?.dispose();
    const root = document.createElement('section');
    root.id = EXPORT_MOUNT_ID;
    anchor.after(root);
    const dispose = mountFunctionExport(root);
    exportMount = {
      root,
      dispose: () => {
        dispose();
        root.remove();
      },
    };
  };

  const ensureButton = (): void => {
    if (!isFunctionsListLocation()) {
      exportMount?.dispose();
      exportMount = undefined;
      return;
    }

    const searchAnchor = findFunctionSearchButtonAnchor();
    if (searchAnchor) {
      ensureExport(injectSearchButton(searchAnchor, openOverlay, 'after'));
      return;
    }

    const createAnchor = findCreateFunctionButton();
    if (createAnchor) {
      ensureExport(injectSearchButton(createAnchor, openOverlay, 'before'));
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

  // Zoho mutates the DOM continuously, and `ensureButton` scans the document for
  // its anchors. Coalesce bursts of mutations into one check per animation frame
  // rather than re-scanning on every individual mutation.
  let scanScheduled = false;
  const scheduleEnsure = (): void => {
    if (scanScheduled) {
      return;
    }
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      ensureButton();
    });
  };

  const observer = new MutationObserver(scheduleEnsure);
  observer.observe(document.body, { childList: true, subtree: true });
}
