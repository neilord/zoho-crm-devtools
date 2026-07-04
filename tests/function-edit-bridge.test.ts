import { describe, expect, it } from 'vitest';
import { createManifest } from '../manifest.config';

describe('edit-in-crm bridge manifest wiring', () => {
  it('exposes the bridge as a web-accessible resource', () => {
    const manifest = createManifest('production');
    const resources = manifest.web_accessible_resources?.flatMap((entry) =>
      'resources' in entry ? entry.resources : [],
    );
    expect(resources).toContain('zcdt-function-edit-bridge.js');
  });

  it('does not register the bridge as a main-world content script', () => {
    const manifest = createManifest('production');
    const hasMainWorldScript = manifest.content_scripts?.some(
      (script) => (script as { world?: string }).world === 'MAIN',
    );
    expect(hasMainWorldScript).toBeFalsy();
  });
});
