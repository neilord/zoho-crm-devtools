/**
 * DOM adapter for Zoho's Settings → Functions list page. This is the most
 * selector-fragile part of the feature: Zoho ships an unstable, minified UI and
 * the "Create Function" control has no durable hook, so we match it by text.
 * Keep that risk documented in docs/zoho-integration.md.
 */

const FUNCTIONS_PATH_FRAGMENT = '/settings/functions';
const CREATE_BUTTON_TEXT = /create function/i;
const CREATE_BUTTON_SELECTOR = 'button, a, lyte-button, lyte-yield, [role="button"]';
const FUNCTION_SEARCH_SELECTOR =
  'lyte-input#functionSearch, lyte-input[data-zcqa="cfSearchFunctions"], #functionSearch, [data-zcqa="cfSearchFunctions"]';
const FUNCTION_SEARCH_WRAPPER_SELECTOR = '.search-function';
const MAX_BUTTON_TEXT_LENGTH = 40;

/** Whether the current location is the Zoho functions settings area. */
export function isFunctionsListLocation(
  location: Pick<Location, 'pathname'> = window.location,
): boolean {
  return location.pathname.includes(FUNCTIONS_PATH_FRAGMENT);
}

/**
 * Finds Zoho's "Create Function" button so we can place our own control beside
 * it. Returns the smallest matching element to avoid selecting a wrapping
 * container, and `null` when nothing matches.
 */
export function findCreateFunctionButton(root: ParentNode = document): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>(CREATE_BUTTON_SELECTOR);
  for (const candidate of candidates) {
    const text = candidate.textContent?.trim() ?? '';
    if (text.length <= MAX_BUTTON_TEXT_LENGTH && CREATE_BUTTON_TEXT.test(text)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Finds Zoho's native functions search control so our broader cross-function
 * search can sit beside it instead of in the create-function button cluster.
 */
export function findFunctionSearchControl(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(FUNCTION_SEARCH_SELECTOR);
}

/**
 * Finds the row-level anchor for the native search box. Zoho renders the Lyte
 * input as a full-width child inside `.search-function`, so our button must sit
 * after that wrapper rather than inside it.
 */
export function findFunctionSearchButtonAnchor(root: ParentNode = document): HTMLElement | null {
  const control = findFunctionSearchControl(root);
  if (!control) {
    return null;
  }
  return control.closest<HTMLElement>(FUNCTION_SEARCH_WRAPPER_SELECTOR) ?? control;
}
