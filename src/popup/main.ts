import { crmMatches } from '../../manifest.config';
import type { Settings } from '../settings/schema';
import { loadSettings, saveSettings } from '../settings/storage';
import { browser } from '../shared/browser';
import { mountAccount, mountNotice } from './account';

const enabledInput = document.querySelector<HTMLInputElement>('#extension-enabled');
const pageStatus = document.querySelector<HTMLElement>('#page-status');
const pageStatusText = document.querySelector<HTMLElement>('#page-status-text');

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
  if (!enabledInput || !pageStatus || !pageStatusText) {
    return;
  }

  const [settings, tabs] = await Promise.all([
    loadSettings(),
    browser.tabs.query({ active: true, currentWindow: true }),
  ]);

  enabledInput.checked = settings.enabled;
  enabledInput.setAttribute('aria-checked', String(settings.enabled));
  const onCrm = isSupportedUrl(tabs[0]?.url);
  pageStatus.classList.toggle('on', onCrm);
  pageStatus.classList.toggle('off', !onCrm);
  pageStatusText.textContent = onCrm ? 'On Zoho CRM' : 'Open Zoho CRM to use tools';

  enabledInput.addEventListener('change', async () => {
    enabledInput.setAttribute('aria-checked', String(enabledInput.checked));
    const latestSettings = await loadSettings();
    const nextSettings: Settings = {
      ...latestSettings,
      enabled: enabledInput.checked,
    };
    await saveSettings(nextSettings);
  });
}

void initializePopup();

const accountRoot = document.querySelector<HTMLElement>('[data-account]');
if (accountRoot) mountAccount(accountRoot, { version: browser.runtime.version() });
const noticeRoot = document.querySelector<HTMLElement>('[data-notice]');
if (noticeRoot) mountNotice(noticeRoot);
