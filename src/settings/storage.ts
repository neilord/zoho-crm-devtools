import { browser } from '../shared/browser';
import { defaultSettings, normalizeSettings, type Settings } from './schema';

const SETTINGS_KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get<{ settings?: Partial<Settings> }>([SETTINGS_KEY]);
  return normalizeSettings(stored.settings);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.sync.set({ [SETTINGS_KEY]: settings });
}

export async function resetSettings(): Promise<Settings> {
  await saveSettings(defaultSettings);
  return defaultSettings;
}
