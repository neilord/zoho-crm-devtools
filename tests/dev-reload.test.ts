import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createManifest } from '../manifest.config';
import { handleDevReloadMessage } from '../src/internal/dev-reload/background-handler';
import { installDevReloadControl } from '../src/internal/dev-reload/control';
import {
  DEV_RELOAD_CONTROL_ATTR,
  DEV_RELOAD_MESSAGE_TYPE,
  isDevReloadMessage,
} from '../src/internal/dev-reload/protocol';

describe('development-only extension reload tooling', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(DEV_RELOAD_CONTROL_ATTR);
    document.querySelector(`[${DEV_RELOAD_CONTROL_ATTR}]`)?.remove();
  });

  it('recognizes only the internal reload message', () => {
    expect(isDevReloadMessage({ type: DEV_RELOAD_MESSAGE_TYPE })).toBe(true);
    expect(isDevReloadMessage({ type: 'reload' })).toBe(false);
    expect(isDevReloadMessage(null)).toBe(false);
  });

  it('installs one hidden dev control and sends the reload message when clicked', () => {
    const sendMessage = vi.fn();

    const firstControl = installDevReloadControl(document, { sendMessage });
    const secondControl = installDevReloadControl(document, { sendMessage });

    firstControl.click();

    expect(firstControl).toBe(secondControl);
    expect(document.querySelectorAll(`[${DEV_RELOAD_CONTROL_ATTR}]`)).toHaveLength(1);
    expect(firstControl.getAttribute('aria-hidden')).toBe('true');
    expect(firstControl.tabIndex).toBe(-1);
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
      js: ['src/internal/dev-tools/content-entry.ts'],
      run_at: 'document_idle',
    });
  });

  it('uses the bundled icon set for extension and toolbar surfaces', () => {
    const manifest = createManifest('production');
    const expectedIcons = {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    };

    expect(manifest.icons).toEqual(expectedIcons);
    expect(manifest.action?.default_icon).toEqual(expectedIcons);
  });
});
