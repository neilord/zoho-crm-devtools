export type NativeThemeAlias = 'vs-dark' | 'vs-light';

export interface ThemeDefinition {
  id: string;
  label: string;
  nativeAlias: NativeThemeAlias;
  cssClass: string;
}

export const themes: readonly ThemeDefinition[] = [
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
] as const;

export function getTheme(id: string): ThemeDefinition {
  const theme = themes.find((candidate) => candidate.id === id);
  if (!theme) {
    throw new Error(`Unknown theme: ${id}`);
  }

  return theme;
}

export function findTheme(id: string | null): ThemeDefinition | null {
  if (!id) {
    return null;
  }

  return themes.find((candidate) => candidate.id === id) ?? null;
}
