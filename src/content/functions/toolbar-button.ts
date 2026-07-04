import { searchAllFunctionsIcon } from './dom';

/**
 * The "Search All Functions" button injected beside Zoho's native functions
 * search box. It lives in the page's light DOM (not the overlay shadow root),
 * so it is self-styled to avoid depending on Zoho's class names while matching
 * the native search control closely.
 */

export const SEARCH_BUTTON_ID = 'zcdt-function-search-button';
const SEARCH_BUTTON_LABEL = 'Search All Functions';

type SearchButtonPlacement = 'before' | 'after';

const BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  height: '34px',
  boxSizing: 'border-box',
  minWidth: '196px',
  padding: '0 16px',
  border: '1px solid #505d81',
  borderRadius: '6px',
  background: 'transparent',
  boxShadow: 'none',
  color: '#313949',
  font: '400 14px/1 "Zoho_Puvi_Regular", "Segoe UI", system-ui, sans-serif',
  cursor: 'pointer',
  outline: '0',
  transition:
    'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, color 120ms ease',
  verticalAlign: 'middle',
};

const BUTTON_INTERACTIVE_STYLE: Partial<CSSStyleDeclaration> = {
  background: '#f7f9ff',
  borderColor: '#6a78ff',
  boxShadow: '0 0 0 2px rgba(88, 103, 255, 0.12)',
  color: '#2446d8',
};

function applyButtonStyle(button: HTMLButtonElement, placement: SearchButtonPlacement): void {
  Object.assign(button.style, BUTTON_STYLE);
  button.style.margin = placement === 'after' ? '0 0 0 10px' : '0 10px 0 0';
  button.style.verticalAlign = placement === 'after' ? 'top' : 'middle';
}

function applyButtonInteractiveStyle(button: HTMLButtonElement): void {
  Object.assign(button.style, BUTTON_INTERACTIVE_STYLE);
}

function getButtonPlacement(button: HTMLButtonElement): SearchButtonPlacement {
  return button.dataset.zcdtPlacement === 'before' ? 'before' : 'after';
}

function createSearchButton(onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = SEARCH_BUTTON_ID;
  button.type = 'button';
  button.title = 'Search across all CRM functions';
  button.setAttribute('aria-label', SEARCH_BUTTON_LABEL);

  const icon = searchAllFunctionsIcon(18);
  icon.style.flex = '0 0 auto';
  button.appendChild(icon);
  button.appendChild(document.createTextNode(SEARCH_BUTTON_LABEL));

  button.addEventListener('mouseenter', () => applyButtonInteractiveStyle(button));
  button.addEventListener('mouseleave', () => {
    if (button.ownerDocument.activeElement !== button) {
      applyButtonStyle(button, getButtonPlacement(button));
    }
  });
  button.addEventListener('focus', () => applyButtonInteractiveStyle(button));
  button.addEventListener('blur', () => applyButtonStyle(button, getButtonPlacement(button)));

  button.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });

  return button;
}

/**
 * Inserts the search button around {@link anchor}. Returns the existing button
 * if it is already present, so repeated calls are safe and can move the control
 * when Zoho's native search box appears after an initial fallback render.
 */
export function injectSearchButton(
  anchor: HTMLElement,
  onClick: () => void,
  placement: SearchButtonPlacement = 'after',
): HTMLElement | null {
  const doc = anchor.ownerDocument;
  const existing = doc.getElementById(SEARCH_BUTTON_ID) as HTMLButtonElement | null;

  const parent = anchor.parentElement;
  if (!parent) {
    return null;
  }

  const button = existing ?? createSearchButton(onClick);
  button.dataset.zcdtPlacement = placement;
  applyButtonStyle(button, placement);

  const referenceNode = placement === 'after' ? anchor.nextSibling : anchor;
  const isPlaced =
    button.parentElement === parent &&
    (placement === 'after' ? button.previousSibling === anchor : button.nextSibling === anchor);
  if (!isPlaced) {
    parent.insertBefore(button, referenceNode);
  }

  return button;
}
