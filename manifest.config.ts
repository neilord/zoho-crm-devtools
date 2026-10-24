import type { ManifestV3Export } from '@crxjs/vite-plugin';

type ManifestV3 = Extract<Awaited<ManifestV3Export>, { manifest_version: number }>;

const extensionIcons = {
  '16': 'icons/icon-16.png',
  '32': 'icons/icon-32.png',
  '48': 'icons/icon-48.png',
  '128': 'icons/icon-128.png',
} as const;

const crmMatches = [
  'https://crm.zoho.com/*',
  'https://crm.zoho.au/*',
  'https://crm.zoho.eu/*',
  'https://crm.zoho.com.au/*',
  'https://crm.zoho.com.cn/*',
  'https://crm.zoho.jp/*',
  'https://crm.zoho.in/*',
  'https://crm.zohoportal.com/*',
  'https://crm.zohoportal.au/*',
  'https://crm.zohoportal.eu/*',
  'https://crm.zohoportal.com.au/*',
  'https://crm.zohoportal.com.cn/*',
  'https://crm.zohoportal.jp/*',
  'https://crm.zohoportal.in/*',
  'https://*.zohoportal.com/*',
  'https://*.zohoportal.au/*',
  'https://*.zohoportal.eu/*',
  'https://*.zohoportal.com.au/*',
  'https://*.zohoportal.com.cn/*',
  'https://*.zohoportal.jp/*',
  'https://*.zohoportal.in/*',
] as const;

// Stable public key for unpacked OAuth/CORS testing only; no private key is retained.
const DEV_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnk1tNv9wRqMVufnHVAcFtruaZiBL4QoksLocJJCY3QwbBMqhuOcYNaBVcFMBTecwzvg2fi3ayuga3e8ZmJsSXsA9OhKMqI5sCh6UglYZt1+3bd8838VkSQg/m/sPhcWZTGI1B0lBwe31y4MAs3uHPEBMmXZBfcyyM0tIASnUDdgwXRLsQTfqx0Wve+N5sPnMjPfh3LI8rHbwzATOzs6/98NQwie/ucahA10Pg/JtP0/z2/gKN2UhQ5+ArQCRA7vhyLuPVIP3HmhQiecXPukc0Xl6A/OcKZJ11uTNCmqiS758tWoUOOUelOlYYas1UvX2euaGpsWtMQfh/OmGGE4VVQIDAQAB';

export function createManifest(
  mode: string,
  { pinDevKey = false }: { pinDevKey?: boolean } = {},
): ManifestV3 {
  const manifest: ManifestV3 = {
    manifest_version: 3,
    minimum_chrome_version: '116',
    name: 'Zoho CRM DevTools',
    version: '2.4.0',
    description: 'Enhance the Zoho CRM Deluge editor with themes and editor improvements.',
    icons: extensionIcons,
    permissions: ['storage'],
    background: { service_worker: 'src/background/worker.ts', type: 'module' },
    action: {
      default_title: 'Zoho CRM DevTools',
      default_popup: 'src/popup/index.html',
      default_icon: extensionIcons,
    },
    content_scripts: [
      {
        matches: [...crmMatches],
        js: ['src/content/index.ts'],
        run_at: 'document_idle',
      },
    ],
    // The "Edit in CRM" bridge runs in the page's main world to reach Zoho
    // globals. The content script injects it on demand as a page <script>;
    // exposing it here lets that injected script bypass the page CSP.
    web_accessible_resources: [
      {
        resources: ['src/billing/oauth-callback.html'],
        matches: ['https://devtools.zsetup.com/*', 'https://api.devtools.zsetup.com/*'],
        use_dynamic_url: false,
      },
      {
        resources: ['zcdt-function-edit-bridge.js'],
        matches: [...crmMatches],
      },
    ],
  };

  // The account API allowlists only the store id and this pinned unpacked id (ADR 0012).
  if (mode === 'development' || pinDevKey) manifest.key = DEV_PUBLIC_KEY;

  if (mode === 'development') {
    manifest.background = {
      service_worker: 'src/internal/dev-reload/background-entry.ts',
      type: 'module',
    };
    manifest.content_scripts?.push({
      matches: [...crmMatches],
      js: ['src/internal/dev-tools/content-entry.ts'],
      run_at: 'document_idle',
    });
  }

  return manifest;
}

export { crmMatches };
export default createManifest('production');
