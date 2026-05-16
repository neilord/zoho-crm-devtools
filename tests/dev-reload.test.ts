import { describe, expect, it, vi } from 'vitest';
import { createManifest } from '../manifest.config';
import { handleDevReloadMessage } from '../src/internal/dev-reload/background-handler';
import { installDevReloadBridge } from '../src/internal/dev-reload/content-bridge';
import {
  DEV_RELOAD_EVENT,
  DEV_RELOAD_MESSAGE_TYPE,
  isDevReloadMessage,
} from '../src/internal/dev-reload/protocol';

describe('development-only extension reload tooling', () => {
  it('recognizes only the internal reload message', () => {
    expect(isDevReloadMessage({ type: DEV_RELOAD_MESSAGE_TYPE })).toBe(true);
    expect(isDevReloadMessage({ type: 'reload' })).toBe(false);
    expect(isDevReloadMessage(null)).toBe(false);
  });

  it('bridges the Zoho-tab event into an extension message', () => {
    const sendMessage = vi.fn();

    installDevReloadBridge(window, { sendMessage });
    window.dispatchEvent(new Event(DEV_RELOAD_EVENT));

    expect(sendMessage).toHaveBeenCalledWith({ type: DEV_RELOAD_MESSAGE_TYPE });
  });

  it('reloads only after the expected internal message', () => {
    const runtime = { reload: vi.fn() };

    expect(handleDevReloadMessage({ type: 'other' }, runtime)).toBe(false);
    expect(runtime.reload).not.toHaveBeenCalled();

    expect(handleDevReloadMessage({ type: DEV_RELOAD_MESSAGE_TYPE }, runtime)).toBe(true);
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the dev reload entrypoints out of production manifests', () => {
    const productionManifest = createManifest('production');
    const developmentManifest = createManifest('development');

    expect(productionManifest.background).toBeUndefined();
    expect(productionManifest.content_scripts).toHaveLength(1);

    expect(developmentManifest.background).toEqual({
      service_worker: 'src/internal/dev-reload/background-entry.ts',
      type: 'module',
    });
    expect(developmentManifest.content_scripts).toHaveLength(2);
    expect(developmentManifest.content_scripts?.[1]).toEqual({
      matches: expect.any(Array),
      js: ['src/internal/dev-reload/content-entry.ts'],
      run_at: 'document_idle',
    });
  });
});
