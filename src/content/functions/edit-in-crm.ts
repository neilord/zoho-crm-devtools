import { type EditInCrmMessage, FUNCTION_SEARCH_MESSAGE_SOURCE } from './messaging';
import type { ZohoFunctionDetail } from './types';

/**
 * Asks the main-world bridge to open Zoho's native function editor. Opening the
 * editor needs page globals (`Lyte.Router`, `customFunctionsObj`) that the
 * isolated content script cannot reach, so we inject a small web-accessible
 * bridge script into the page and hand off the work via `postMessage`.
 */

const BRIDGE_SCRIPT_ID = 'zcdt-function-edit-bridge';
const BRIDGE_RESOURCE = 'zcdt-function-edit-bridge.js';

let bridgeReady: Promise<void> | null = null;

/**
 * Injects the bridge once per page and resolves when it has executed (and thus
 * registered its message listener). Injecting a web-accessible script bypasses
 * the page CSP, unlike an inline script.
 */
function ensureBridge(): Promise<void> {
  if (bridgeReady) {
    return bridgeReady;
  }

  bridgeReady = new Promise<void>((resolve) => {
    if (document.getElementById(BRIDGE_SCRIPT_ID)) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.id = BRIDGE_SCRIPT_ID;
    script.src = chrome.runtime.getURL(BRIDGE_RESOURCE);
    // Resolve on error too: the bridge logs its own failures and we still want
    // to post the message in case the listener registered before the error.
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => resolve(), { once: true });
    (document.head ?? document.documentElement).appendChild(script);
  });

  return bridgeReady;
}

export function requestEditInCrm(detail: ZohoFunctionDetail): void {
  const message: EditInCrmMessage = {
    source: FUNCTION_SEARCH_MESSAGE_SOURCE,
    action: 'editInCrm',
    detail,
  };
  void ensureBridge().then(() => {
    window.postMessage(message, window.location.origin);
  });
}
