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

export function createManifest(mode: string): ManifestV3 {
  const manifest: ManifestV3 = {
    manifest_version: 3,
    name: 'Zoho CRM DevTools',
    version: '0.1.0',
    description: 'Enhance the Zoho CRM Deluge editor with themes and editor improvements.',
    icons: extensionIcons,
    permissions: ['storage'],
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
  };

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
