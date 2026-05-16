export interface Settings {
  version: 1;
  enabled: boolean;
  customThemeId: string | null;
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  lineHeight: number;
  ligaturesEnabled: boolean;
  italicsEnabled: boolean;
  indentGuidesEnabled: boolean;
  syntaxEnhancementEnabled: boolean;
}

export const defaultSettings: Settings = {
  version: 1,
  enabled: true,
  customThemeId: null,
  fontFamily: 'JetBrains Mono',
  fontSizePx: 14,
  fontWeight: 400,
  lineHeight: 1.5,
  ligaturesEnabled: true,
  italicsEnabled: true,
  indentGuidesEnabled: true,
  syntaxEnhancementEnabled: true,
};

export function normalizeSettings(input: Partial<Settings> | undefined): Settings {
  return {
    ...defaultSettings,
    ...input,
    version: 1,
  };
}
