import { describe, expect, it } from 'vitest';
import { findTheme, getTheme, themes } from '../src/themes/registry';

describe('theme registry', () => {
  it('returns theme metadata by id', () => {
    expect(getTheme('vscode-dark')).toEqual({
      id: 'vscode-dark',
      label: 'VS Code Dark',
      nativeAlias: 'vs-dark',
      cssClass: 'zcdt-theme-vscode-dark',
    });
  });

  it('keeps custom themes on both native alias paths', () => {
    expect(new Set(themes.map((theme) => theme.nativeAlias))).toEqual(
      new Set(['vs-dark', 'vs-light']),
    );
  });

  it('keeps the production themes in dropdown order', () => {
    expect(themes).toEqual([
      {
        id: 'vscode-dark',
        label: 'VS Code Dark',
        nativeAlias: 'vs-dark',
        cssClass: 'zcdt-theme-vscode-dark',
      },
      {
        id: 'vscode-light',
        label: 'VS Code Light',
        nativeAlias: 'vs-light',
        cssClass: 'zcdt-theme-vscode-light',
      },
      {
        id: 'github-light',
        label: 'GitHub Light',
        nativeAlias: 'vs-light',
        cssClass: 'zcdt-theme-github-light',
      },
      {
        id: 'github-dark',
        label: 'GitHub Dark',
        nativeAlias: 'vs-dark',
        cssClass: 'zcdt-theme-github-dark',
      },
      {
        id: 'one-dark-pro',
        label: 'One Dark Pro',
        nativeAlias: 'vs-dark',
        cssClass: 'zcdt-theme-one-dark-pro',
      },
      {
        id: 'monokai-pro',
        label: 'Monokai Pro',
        nativeAlias: 'vs-dark',
        cssClass: 'zcdt-theme-monokai-pro',
      },
      {
        id: 'tokyo-night',
        label: 'Tokyo Night',
        nativeAlias: 'vs-dark',
        cssClass: 'zcdt-theme-tokyo-night',
      },
    ]);
  });

  it('returns null when no custom theme is active', () => {
    expect(findTheme(null)).toBeNull();
  });
});
