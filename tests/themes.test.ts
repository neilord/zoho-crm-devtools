import { describe, expect, it } from 'vitest';
import { findTheme, getTheme, themes } from '../src/themes/registry';

describe('theme registry', () => {
  it('returns proof-theme metadata by id', () => {
    expect(getTheme('vscode-dark')).toEqual({
      id: 'vscode-dark',
      label: 'VS Code Dark',
      nativeAlias: 'vs-dark',
      cssClass: 'zcdt-theme-vscode-dark',
    });
  });

  it('keeps proof themes on both native alias paths', () => {
    expect(new Set(themes.map((theme) => theme.nativeAlias))).toEqual(
      new Set(['vs-dark', 'vs-light']),
    );
  });

  it('keeps temporary audit themes out of the production registry', () => {
    expect(themes.map((theme) => theme.id)).toEqual(['vscode-dark', 'vscode-light']);
  });

  it('returns null when no custom theme is active', () => {
    expect(findTheme(null)).toBeNull();
  });
});
