/**
 * DOM adapter for Zoho's Settings → Functions list page. This is the most
 * selector-fragile part of the feature: Zoho ships an unstable, minified UI and
 * the "Create Function" control has no durable hook, so we match it by text.
 * Keep that risk documented in docs/zoho-integration.md.
 */

const FUNCTIONS_PATH_FRAGMENT = '/settings/functions';
const CREATE_BUTTON_TEXT = /create function/i;
const CREATE_BUTTON_SELECTOR = 'button, a, lyte-button, lyte-yield, [role="button"]';
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
