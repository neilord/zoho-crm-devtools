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

/**
 * Resolves `true` once the message is actually posted, `false` if the bridge
 * could not be reached. `chrome.runtime.getURL` throws "Extension context
 * invalidated" when this content script instance predates the currently
 * loaded extension (e.g. a tab left open across a reload/update) — that
 * throw happens inside the `ensureBridge` promise executor, so it surfaces
 * here as a rejection rather than an exception the caller can catch directly.
 */
export function requestEditInCrm(detail: ZohoFunctionDetail): Promise<boolean> {
  const message: EditInCrmMessage = {
    source: FUNCTION_SEARCH_MESSAGE_SOURCE,
    action: 'editInCrm',
    detail,
  };
  return ensureBridge()
    .then(() => {
      window.postMessage(message, window.location.origin);
      return true;
    })
    .catch((error: unknown) => {
      console.error('Zoho CRM DevTools: failed to reach the extension to open the editor', error);
      return false;
    });
}

/** Separate acknowledged contract: legacy Search All Functions keeps its own behavior. */
export async function requestWorkflowEditInCrm(
  detail: ZohoFunctionDetail,
  signal: AbortSignal,
): Promise<boolean> {
  await ensureBridge();
  signal.throwIfAborted();
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', abort);
      resolve(ok);
    };
    const receive = (event: MessageEvent) => {
      if (
        event.source === window &&
        event.origin === location.origin &&
        event.data?.source === 'zcdt-workflow-function' &&
        event.data?.action === 'editorResult' &&
        event.data?.requestId === requestId
      )
        finish(event.data.ok === true);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(false), 15_000);
    window.addEventListener('message', receive);
    signal.addEventListener('abort', abort, { once: true });
    window.postMessage(
      { source: 'zcdt-workflow-function', action: 'editInCrm', requestId, detail },
      location.origin,
    );
  });
}
