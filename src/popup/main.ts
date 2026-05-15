import { crmMatches } from '../../manifest.config';
import type { Settings } from '../settings/schema';
import { loadSettings, saveSettings } from '../settings/storage';
import { browser } from '../shared/browser';

const enabledInput = document.querySelector<HTMLInputElement>('#extension-enabled');
const pageStatus = document.querySelector<HTMLElement>('#page-status');

function isSupportedUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  return crmMatches.some((pattern) => {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '.*');
    return new RegExp(`^${escaped}$`).test(url);
  });
}

async function initializePopup(): Promise<void> {
  if (!enabledInput || !pageStatus) {
    return;
  }

  const [settings, tabs] = await Promise.all([
    loadSettings(),
    browser.tabs.query({ active: true, currentWindow: true }),
  ]);

  enabledInput.checked = settings.enabled;
  pageStatus.textContent = isSupportedUrl(tabs[0]?.url)
    ? 'Supported Zoho CRM page'
    : 'Open Zoho CRM to use editor tools';

  enabledInput.addEventListener('change', async () => {
    const nextSettings: Settings = {
      ...settings,
      enabled: enabledInput.checked,
    };
    await saveSettings(nextSettings);
  });
}

void initializePopup();
