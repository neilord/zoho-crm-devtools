import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyCustomThemePresentation,
  CUSTOM_THEME_ACTIVE_CLASS,
  CUSTOM_THEME_SHADOW_LABEL_CLASS,
  injectCustomThemeOptions,
  reconcileThemeSelection,
} from '../src/content/editor/themes';
import { findThemeDropBody, findThemeDropdown } from '../src/content/zoho/theme-dropdown';
import { getTheme, themes } from '../src/themes/registry';
import fixture from './fixtures/theme-dropdown.html?raw';

describe('Zoho native theme dropdown integration', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture;
    document.body.className = '';
  });

  it('finds the native theme dropdown and body', () => {
    expect(findThemeDropdown()).not.toBeNull();
    expect(findThemeDropBody()?.id).toBe('Lyte_Drop_Body_4');
  });

  it('injects custom themes once before the no-result row', () => {
    expect(injectCustomThemeOptions()).toBe(themes.length);
    expect(injectCustomThemeOptions()).toBe(0);

    const values = [...document.querySelectorAll('lyte-drop-body > *')].map((node) =>
      node instanceof Element ? (node.getAttribute('data-value') ?? node.className) : '',
    );
    expect(values).toEqual([
      'vs-dark',
      'vs-darkplus',
      'vs-light',
      ...themes.map((theme) => theme.id),
      'lyteDropdownNoResult',
    ]);
  });

  it('shadows the native label and applies one custom theme class', () => {
    const theme = getTheme('vscode-dark');
    applyCustomThemePresentation(theme);

    const nativeLabel = document.querySelector('.lyteDropdownLabel:not(.zcdt-custom-theme-label)');
    const shadowLabel = document.querySelector(`.${CUSTOM_THEME_SHADOW_LABEL_CLASS}`);

    expect(document.body.classList.contains(theme.cssClass)).toBe(true);
    expect(document.body.classList.contains(CUSTOM_THEME_ACTIVE_CLASS)).toBe(true);
    expect((nativeLabel as HTMLElement).style.display).toBe('none');
    expect(shadowLabel?.textContent).toBe('VS Code Dark');
  });

  it('moves visible selection from the native alias to the active custom option', () => {
    const theme = getTheme('vscode-dark');
    injectCustomThemeOptions();
    reconcileThemeSelection(theme);

    const nativeAlias = document.querySelector('lyte-drop-item[data-value="vs-dark"]');
    const customOption = document.querySelector('lyte-drop-item[data-value="vscode-dark"]');

    expect(nativeAlias?.getAttribute('aria-selected')).toBe('false');
    expect(nativeAlias?.hasAttribute('selected')).toBe(false);
    expect(customOption?.getAttribute('aria-selected')).toBe('true');
    expect(customOption?.getAttribute('selected')).toBe('true');
  });

  it('stops mutating once the active custom option is already reconciled', () => {
    const theme = getTheme('vscode-dark');
    injectCustomThemeOptions();
    reconcileThemeSelection(theme);

    const observer = new MutationObserver(() => {});
    observer.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['selected', 'aria-selected', 'class'],
    });

    reconcileThemeSelection(theme);
    const mutations = observer.takeRecords();
    observer.disconnect();

    expect(mutations).toEqual([]);
  });
});
