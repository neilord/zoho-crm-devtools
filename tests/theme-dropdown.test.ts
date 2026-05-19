import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCustomThemePresentation,
  CUSTOM_THEME_ACTIVE_CLASS,
  CUSTOM_THEME_SHADOW_LABEL_CLASS,
  ensureNativeThemeAlias,
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

  it('keeps only the active custom theme selected when switching themes', () => {
    const firstTheme = getTheme('vscode-dark');
    const secondTheme = getTheme('github-dark');
    injectCustomThemeOptions();

    reconcileThemeSelection(firstTheme);
    reconcileThemeSelection(secondTheme);

    const firstCustomOption = document.querySelector('lyte-drop-item[data-value="vscode-dark"]');
    const secondCustomOption = document.querySelector('lyte-drop-item[data-value="github-dark"]');

    expect(firstCustomOption?.getAttribute('aria-selected')).toBe('false');
    expect(firstCustomOption?.hasAttribute('selected')).toBe(false);
    expect(secondCustomOption?.getAttribute('aria-selected')).toBe('true');
    expect(secondCustomOption?.getAttribute('selected')).toBe('true');
  });

  it('reapplies the matching native alias when restoring a persisted custom theme', () => {
    const theme = getTheme('github-light');
    const dropdown = findThemeDropdown();
    const lightAlias = document.querySelector('lyte-drop-item[data-value="vs-light"]');
    dropdown?.setAttribute('lt-prop-selected', 'vs-dark');
    const click = vi.spyOn(lightAlias as HTMLElement, 'click');

    ensureNativeThemeAlias(theme);

    expect(click).toHaveBeenCalledTimes(1);
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
