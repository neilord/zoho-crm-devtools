/**
 * Shared contract between the isolated content script (which renders the UI) and
 * the main-world bridge (which can reach Zoho's page globals). They communicate
 * over `window.postMessage` because the main world cannot use `chrome.*`.
 *
 * The bridge itself lives in `public/zcdt-function-edit-bridge.js` (plain JS that
 * runs in the page world); keep the source/action values here in sync with it.
 */

export const FUNCTION_SEARCH_MESSAGE_SOURCE = 'zcdt-function-search';

export interface EditInCrmMessage {
  source: typeof FUNCTION_SEARCH_MESSAGE_SOURCE;
  action: 'editInCrm';
  /** The function detail payload Zoho's editor expects. */
  detail: unknown;
}
