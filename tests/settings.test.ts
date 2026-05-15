import { describe, expect, it } from 'vitest';
import { defaultSettings, normalizeSettings } from '../src/settings/schema';

describe('settings schema', () => {
  it('uses the full default shape when nothing is stored', () => {
    expect(normalizeSettings(undefined)).toEqual(defaultSettings);
  });

  it('keeps known stored values while forcing the current version', () => {
    expect(
      normalizeSettings({
        version: 99 as 1,
        enabled: false,
        fontSizePx: 16,
      }),
    ).toMatchObject({
      version: 1,
      enabled: false,
      fontSizePx: 16,
    });
  });
});
