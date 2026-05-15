export interface ThemeDefinition {
  id: string;
  label: string;
  variables: Record<string, string>;
}

export const themes: readonly ThemeDefinition[] = [
  {
    id: 'zoho-default-light',
    label: 'Zoho Default Light',
    variables: {
      '--zcdt-editor-background': '#ffffff',
      '--zcdt-editor-foreground': '#1c1c1c',
    },
  },
  {
    id: 'night-owl',
    label: 'Night Owl',
    variables: {
      '--zcdt-editor-background': '#011627',
      '--zcdt-editor-foreground': '#d6deeb',
    },
  },
] as const;

export function getTheme(id: string): ThemeDefinition {
  const theme = themes.find((candidate) => candidate.id === id);
  if (!theme) {
    throw new Error(`Unknown theme: ${id}`);
  }

  return theme;
}
