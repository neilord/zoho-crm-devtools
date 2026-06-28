import { searchIcon } from './dom';

/**
 * The "Search Functions" button injected next to Zoho's "Create Function"
 * control. It lives in the page's light DOM (not the overlay shadow root), so it
 * is self-styled to avoid depending on Zoho's class names while sitting cleanly
 * beside the native button.
 */

export const SEARCH_BUTTON_ID = 'zcdt-function-search-button';

const BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  height: '38px',
  margin: '0 10px 0 0',
  padding: '0 18px',
  border: '1px solid #c7ccd6',
  borderRadius: '6px',
  background: '#ffffff',
  color: '#2b3a5b',
  font: '600 14px/1 "Segoe UI", system-ui, sans-serif',
  cursor: 'pointer',
  verticalAlign: 'middle',
};

function createSearchButton(onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = SEARCH_BUTTON_ID;
  button.type = 'button';
  button.title = 'Search across all CRM functions';
  Object.assign(button.style, BUTTON_STYLE);

  const icon = searchIcon(18);
  icon.style.flex = '0 0 auto';
  button.appendChild(icon);
  button.appendChild(document.createTextNode('Search Functions'));

  button.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });

  return button;
}

/**
 * Inserts the search button before {@link anchor} (Zoho's create button). Returns
 * the existing button if it is already present, so repeated calls are safe.
 */
export function injectSearchButton(anchor: HTMLElement, onClick: () => void): HTMLElement | null {
  const doc = anchor.ownerDocument;
  const existing = doc.getElementById(SEARCH_BUTTON_ID);
  if (existing) {
    return existing;
  }

  const parent = anchor.parentElement;
  if (!parent) {
    return null;
  }

  const button = createSearchButton(onClick);
  parent.insertBefore(button, anchor);
  return button;
}
