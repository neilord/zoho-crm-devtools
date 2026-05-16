import { describe, expect, it, vi } from 'vitest';
import { createManifest } from '../manifest.config';
import { handleDevReloadCommand } from '../src/internal/dev-reload/background-handler';
import { DEV_RELOAD_COMMAND } from '../src/internal/dev-reload/protocol';

describe('development-only extension reload tooling', () => {
  it('reloads only after the expected internal command', () => {
    const runtime = { reload: vi.fn() };

    expect(handleDevReloadCommand('other', runtime)).toBe(false);
    expect(runtime.reload).not.toHaveBeenCalled();

    expect(handleDevReloadCommand(DEV_RELOAD_COMMAND, runtime)).toBe(true);
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the dev reload entrypoints out of production manifests', () => {
    const productionManifest = createManifest('production');
    const developmentManifest = createManifest('development');

    expect(productionManifest.background).toBeUndefined();
    expect(productionManifest.content_scripts).toHaveLength(1);
    expect(productionManifest.commands).toBeUndefined();

    expect(developmentManifest.background).toEqual({
      service_worker: 'src/internal/dev-reload/background-entry.ts',
      type: 'module',
    });
    expect(developmentManifest.content_scripts).toHaveLength(1);
    expect(developmentManifest.commands).toEqual({
      [DEV_RELOAD_COMMAND]: {
        suggested_key: {
          default: 'Alt+Shift+R',
          mac: 'Alt+Shift+R',
        },
        description: 'Reload the extension during local development.',
      },
    });
  });
});
