import { automationMapComingSoon } from '../../features/automation-map-gate';
import { mapIcon } from '../automation-map/entry/icon';
import { searchAllFunctionsIcon } from '../functions/dom';

/**
 * The "Search All Workflows" button injected beside Zoho's native workflow-rule
 * search box. It lives in the page's light DOM, so it carries a small id-scoped
 * stylesheet (inline styles cannot express :hover / :focus-visible) shaped like
 * Zoho's own secondary buttons: 34px tall, 4px radius, neutral outline. It never
 * shows a plan badge; entitlement is checked when it is clicked.
 */
export const WORKFLOW_SEARCH_BUTTON_ID = 'zcdt-workflow-search-button';
export const WORKFLOW_SEARCH_BUTTON_STYLE_ID = 'zcdt-workflow-search-button-style';
export const AUTOMATION_MAP_BUTTON_ID = 'zcdt-automation-map-button';
const LABEL = 'Search All Workflows';

const BUTTON_CSS =
  `
#${WORKFLOW_SEARCH_BUTTON_ID}{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;flex:0 0 auto;align-self:flex-start;height:34px;margin:0 0 0 8px;padding:0 12px 0 10px;border:1px solid #b9c0cf;border-radius:4px;background:#fff;color:#313949;font:500 14px/1 "Zoho_Puvi_Regular","Segoe UI",system-ui,sans-serif;white-space:nowrap;cursor:pointer;transition:background-color 120ms ease,border-color 120ms ease,color 120ms ease}
#${WORKFLOW_SEARCH_BUTTON_ID}:hover{border-color:#6a78ff;background:#f7f9ff;color:#2446d8}
#${WORKFLOW_SEARCH_BUTTON_ID}:focus-visible{outline:0;border-color:#2f6df0;box-shadow:0 0 0 3px rgba(47,109,240,.35)}
#${WORKFLOW_SEARCH_BUTTON_ID}[aria-busy="true"]{cursor:progress;opacity:.7}
#${WORKFLOW_SEARCH_BUTTON_ID} svg{flex:0 0 auto}
`.replaceAll(
    `#${WORKFLOW_SEARCH_BUTTON_ID}`,
    `:is(#${WORKFLOW_SEARCH_BUTTON_ID},#${AUTOMATION_MAP_BUTTON_ID})`,
  ) +
  `
#${AUTOMATION_MAP_BUTTON_ID}{position:relative}
#${AUTOMATION_MAP_BUTTON_ID} .zcdt-beta,#${AUTOMATION_MAP_BUTTON_ID} .zcdt-soon{padding:2px 5px;border-radius:999px;box-shadow:inset 0 0 0 1px #c9cfdc;color:#5f6b80;font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
#${AUTOMATION_MAP_BUTTON_ID} .zcdt-soon{padding:2px 6px;background:#fdf0d2;box-shadow:none;color:#8a5a00;font-weight:700;line-height:1.3}
#${AUTOMATION_MAP_BUTTON_ID} .zcdt-soon-dot{display:none;position:absolute;top:-4px;right:-4px;width:9px;height:9px;border-radius:50%;background:#d99a1e;box-shadow:0 0 0 2px #fff}
@media(max-width:1100px){#${AUTOMATION_MAP_BUTTON_ID}{width:34px;padding:0;justify-content:center}#${AUTOMATION_MAP_BUTTON_ID} span{display:none}#${AUTOMATION_MAP_BUTTON_ID} .zcdt-soon-dot{display:block}}
`;

let activeHandler: (event: MouseEvent) => void = () => {};

function ensureStyle(doc: Document): void {
  if (doc.getElementById(WORKFLOW_SEARCH_BUTTON_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = WORKFLOW_SEARCH_BUTTON_STYLE_ID;
  style.textContent = BUTTON_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}

function createButton(doc: Document): HTMLButtonElement {
  const button = doc.createElement('button');
  button.id = WORKFLOW_SEARCH_BUTTON_ID;
  button.type = 'button';
  button.title = 'Search across all workflow rules';
  button.setAttribute('aria-label', LABEL);
  button.appendChild(searchAllFunctionsIcon(17));
  button.appendChild(doc.createTextNode(LABEL));
  button.addEventListener('click', (event) => {
    event.preventDefault();
    activeHandler(event);
  });
  return button;
}

/**
 * Places the button directly after {@link anchor} (Zoho's native search input).
 * Safe to call repeatedly: the single button is reused, repositioned only when
 * it has drifted, and always routes clicks to the latest handler.
 */
export function injectWorkflowSearchButton(
  anchor: HTMLElement,
  onClick: (button: HTMLButtonElement) => void,
): HTMLButtonElement | null {
  const parent = anchor.parentElement;
  if (!parent) return null;
  const doc = anchor.ownerDocument;
  ensureStyle(doc);
  const button =
    (doc.getElementById(WORKFLOW_SEARCH_BUTTON_ID) as HTMLButtonElement | null) ??
    createButton(doc);
  activeHandler = () => onClick(button);
  if (button.parentElement !== parent || anchor.nextElementSibling !== button) {
    anchor.after(button);
  }
  return button;
}

export function removeWorkflowSearchButton(doc: Document = document): void {
  doc.getElementById(WORKFLOW_SEARCH_BUTTON_ID)?.remove();
  doc.getElementById(WORKFLOW_SEARCH_BUTTON_STYLE_ID)?.remove();
}

/** The map is available to every plan; its store decides full access versus preview (or, while gated, the waitlist opens). */
export function injectAutomationMapButton(onOpen: () => void): void {
  const search = document.getElementById(WORKFLOW_SEARCH_BUTTON_ID);
  if (!search) {
    removeAutomationMapButton();
    return;
  }
  ensureStyle(document);
  let button = document.getElementById(AUTOMATION_MAP_BUTTON_ID) as HTMLButtonElement | null;
  if (!button) {
    button = document.createElement('button');
    button.id = AUTOMATION_MAP_BUTTON_ID;
    button.type = 'button';
    button.title = 'See what runs in this CRM and what can change each field';
    const label = document.createElement('span');
    label.textContent = 'Automation Map';
    const badge = document.createElement('span');
    if (automationMapComingSoon()) {
      // Gated (ADR 0035): the pill replaces Beta; under 1100px a dot stands in for the hidden label.
      button.title = 'Automation Map is coming soon to Pro. Click to join the waitlist.';
      button.setAttribute('aria-label', 'Automation Map, coming soon');
      badge.className = 'zcdt-soon';
      badge.textContent = 'Coming soon';
      const dot = document.createElement('i');
      dot.className = 'zcdt-soon-dot';
      dot.setAttribute('aria-hidden', 'true');
      button.append(mapIcon(), label, badge, dot);
    } else {
      button.setAttribute('aria-label', 'Automation Map (Beta)');
      badge.className = 'zcdt-beta';
      badge.textContent = 'Beta';
      button.append(mapIcon(), label, badge);
    }
    button.addEventListener('click', (event) => {
      event.preventDefault();
      onOpen();
    });
  }
  if (search.nextElementSibling !== button) search.after(button);
}
export function removeAutomationMapButton(): void {
  document.getElementById(AUTOMATION_MAP_BUTTON_ID)?.remove();
}
