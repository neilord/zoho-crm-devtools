import { zohoSelectors } from './selectors';

const NATIVE_THEME_VALUES = new Set(['vs-dark', 'vs-darkplus', 'vs-light']);

export function findThemeDropdown(root: ParentNode = document): Element | null {
  const directMatch = root.querySelector(zohoSelectors.themeDropdown);
  if (directMatch) {
    return directMatch;
  }

  return findThemeDropBody(root)?.closest('lyte-dropdown') ?? null;
}

export function findThemeDropBody(root: ParentNode = document): Element | null {
  const directDropdown = root.querySelector(zohoSelectors.themeDropdown);
  const directBody = directDropdown?.querySelector('lyte-drop-body');
  if (directBody) {
    return directBody;
  }

  for (const body of root.querySelectorAll('lyte-drop-body')) {
    if (body.querySelector('lyte-drop-item[data-value="vs-dark"]')) {
      return body;
    }
  }

  return null;
}

export function findThemeLabel(root: ParentNode = document): Element | null {
  return findThemeDropdown(root)?.querySelector(zohoSelectors.dropdownLabel) ?? null;
}

export function findThemeOption(value: string, root: ParentNode = document): Element | null {
  return findThemeDropBody(root)?.querySelector(`lyte-drop-item[data-value="${value}"]`) ?? null;
}

export function isNativeThemeOption(option: Element): boolean {
  const value = option.getAttribute('data-value');
  return value !== null && NATIVE_THEME_VALUES.has(value);
}

export function setThemeOptionSelected(option: Element, selected: boolean): void {
  if (selected) {
    if (option.getAttribute('aria-selected') !== 'true') {
      option.setAttribute('aria-selected', 'true');
    }
    if (!option.hasAttribute('selected')) {
      option.setAttribute('selected', 'true');
    }
    if (!option.classList.contains('lyteDropdownSelection')) {
      option.classList.add('lyteDropdownSelection');
    }
    return;
  }

  if (option.getAttribute('aria-selected') !== 'false') {
    option.setAttribute('aria-selected', 'false');
  }
  if (option.hasAttribute('selected')) {
    option.removeAttribute('selected');
  }
  if (option.classList.contains('lyteDropdownSelection')) {
    option.classList.remove('lyteDropdownSelection');
  }
}
