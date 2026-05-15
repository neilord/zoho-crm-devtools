import { loadSettings, saveSettings } from '../../settings/storage';
import { findTheme, type ThemeDefinition, themes } from '../../themes/registry';
import { zohoSelectors } from '../zoho/selectors';
import {
  findThemeDropBody,
  findThemeLabel,
  findThemeOption,
  isNativeThemeOption,
  setThemeOptionSelected,
} from '../zoho/theme-dropdown';

export const CUSTOM_THEME_OPTION_ATTR = 'data-zcdt-theme-option';
export const CUSTOM_THEME_SHADOW_LABEL_CLASS = 'zcdt-custom-theme-label';
export const CUSTOM_THEME_ACTIVE_CLASS = 'zcdt-custom-theme-active';

function getThemeId(option: Element): string | null {
  return option.getAttribute('data-value');
}

function isCustomThemeOption(option: Element): boolean {
  const value = getThemeId(option);
  return value !== null && themes.some((theme) => theme.id === value);
}

function cloneThemeOption(sourceOption: Element, theme: ThemeDefinition): Element {
  const option = sourceOption.cloneNode(true) as Element;
  option.removeAttribute('id');
  option.setAttribute(CUSTOM_THEME_OPTION_ATTR, 'true');
  option.setAttribute('data-value', theme.id);
  option.textContent = theme.label;
  setThemeOptionSelected(option, false);
  return option;
}

function getOrCreateShadowLabel(nativeLabel: Element): Element {
  const parent = nativeLabel.parentElement;
  const existing = parent?.querySelector(`.${CUSTOM_THEME_SHADOW_LABEL_CLASS}`);
  if (existing) {
    return existing;
  }

  const shadowLabel = document.createElement('span');
  shadowLabel.className = `${nativeLabel.className} ${CUSTOM_THEME_SHADOW_LABEL_CLASS}`;
  nativeLabel.insertAdjacentElement('afterend', shadowLabel);
  return shadowLabel;
}

function applyThemeClass(activeTheme: ThemeDefinition | null): void {
  for (const theme of themes) {
    document.body.classList.remove(theme.cssClass);
  }
  document.body.classList.toggle(CUSTOM_THEME_ACTIVE_CLASS, activeTheme !== null);

  if (activeTheme) {
    document.body.classList.add(activeTheme.cssClass);
  }
}

export function injectCustomThemeOptions(root: ParentNode = document): number {
  const dropBody = findThemeDropBody(root);
  if (!dropBody) {
    return 0;
  }

  let injectedCount = 0;

  for (const theme of themes) {
    if (dropBody.querySelector(`lyte-drop-item[data-value="${theme.id}"]`)) {
      continue;
    }

    const nativeSourceOption = dropBody.querySelector(
      `lyte-drop-item[data-value="${theme.nativeAlias}"]`,
    );
    if (!nativeSourceOption) {
      continue;
    }

    const customOption = cloneThemeOption(nativeSourceOption, theme);
    const noResultRow = dropBody.querySelector(zohoSelectors.dropdownNoResult);
    if (noResultRow) {
      dropBody.insertBefore(customOption, noResultRow);
    } else {
      dropBody.appendChild(customOption);
    }
    injectedCount += 1;
  }

  return injectedCount;
}

export function applyCustomThemePresentation(
  activeTheme: ThemeDefinition | null,
  root: ParentNode = document,
): void {
  applyThemeClass(activeTheme);

  const nativeLabel = findThemeLabel(root);
  if (!nativeLabel) {
    return;
  }

  const shadowLabel = getOrCreateShadowLabel(nativeLabel);
  if (activeTheme) {
    (nativeLabel as HTMLElement).style.display = 'none';
    (shadowLabel as HTMLElement).style.display = '';
    if (shadowLabel.textContent !== activeTheme.label) {
      shadowLabel.textContent = activeTheme.label;
    }
    return;
  }

  (nativeLabel as HTMLElement).style.display = '';
  (shadowLabel as HTMLElement).style.display = 'none';
}

export function reconcileThemeSelection(
  activeTheme: ThemeDefinition | null,
  root: ParentNode = document,
): void {
  if (!activeTheme) {
    return;
  }

  const customOption = findThemeOption(activeTheme.id, root);
  const nativeAliasOption = findThemeOption(activeTheme.nativeAlias, root);
  if (!customOption || !nativeAliasOption) {
    return;
  }

  if (
    nativeAliasOption.hasAttribute('selected') ||
    nativeAliasOption.getAttribute('aria-selected') === 'true'
  ) {
    if (nativeAliasOption.getAttribute('aria-selected') !== 'false') {
      nativeAliasOption.setAttribute('aria-selected', 'false');
    }
    nativeAliasOption.removeAttribute('selected');
  }

  if (
    !customOption.hasAttribute('selected') ||
    customOption.getAttribute('aria-selected') !== 'true'
  ) {
    if (customOption.getAttribute('aria-selected') !== 'true') {
      customOption.setAttribute('aria-selected', 'true');
    }
    if (!customOption.hasAttribute('selected')) {
      customOption.setAttribute('selected', 'true');
    }
  }

  if (
    nativeAliasOption.classList.contains('lyteDropdownSelection') &&
    !nativeAliasOption.matches(':hover')
  ) {
    nativeAliasOption.classList.remove('lyteDropdownSelection');
    if (!customOption.classList.contains('lyteDropdownSelection')) {
      customOption.classList.add('lyteDropdownSelection');
    }
  }
}

async function persistCustomThemeId(customThemeId: string | null): Promise<void> {
  const latestSettings = await loadSettings();
  await saveSettings({
    ...latestSettings,
    customThemeId,
  });
}

function clearCustomOptionSelection(dropBody: Element): void {
  for (const option of dropBody.querySelectorAll(`lyte-drop-item[${CUSTOM_THEME_OPTION_ATTR}]`)) {
    setThemeOptionSelected(option, false);
  }
}

export function installThemeIntegration(initialCustomThemeId: string | null): void {
  let activeTheme = findTheme(initialCustomThemeId);
  let reconciliationQueued = false;

  const reconcile = () => {
    injectCustomThemeOptions();
    applyCustomThemePresentation(activeTheme);
    reconcileThemeSelection(activeTheme);
  };

  const queueReconciliation = () => {
    if (reconciliationQueued) {
      return;
    }

    reconciliationQueued = true;
    queueMicrotask(() => {
      reconciliationQueued = false;
      reconcile();
    });
  };

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const clickedOption = target.closest('lyte-drop-item');
      const dropBody = clickedOption?.closest('lyte-drop-body');
      if (!clickedOption || !dropBody || dropBody !== findThemeDropBody()) {
        return;
      }

      if (isCustomThemeOption(clickedOption)) {
        const clickedTheme = findTheme(getThemeId(clickedOption));
        if (!clickedTheme) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        activeTheme = clickedTheme;
        void persistCustomThemeId(clickedTheme.id);
        reconcile();

        const nativeAliasOption = findThemeOption(clickedTheme.nativeAlias);
        if (nativeAliasOption instanceof HTMLElement) {
          nativeAliasOption.click();
        }
        return;
      }

      if (event.isTrusted && isNativeThemeOption(clickedOption)) {
        activeTheme = null;
        void persistCustomThemeId(null);
        clearCustomOptionSelection(dropBody);
        applyCustomThemePresentation(activeTheme);
      }
    },
    true,
  );

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        queueReconciliation();
        return;
      }

      if (
        mutation.type === 'attributes' &&
        mutation.target instanceof Element &&
        mutation.target.matches('lyte-drop-item')
      ) {
        queueReconciliation();
        return;
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['selected', 'aria-selected', 'class'],
  });

  reconcile();
}
