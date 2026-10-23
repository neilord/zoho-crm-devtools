// @vitest-environment node
import { build } from 'vite';
import { expect, it, vi } from 'vitest';

it.each([
  ['production', 'true', 'true', null],
  ['production', 'true', 'false', null],
  ['development', 'true', 'false', 'full'],
  ['development', 'true', 'true', 'teaser'],
  ['development', 'false', 'true', 'teaser'],
  ['development', 'false', 'false', null],
] as const)('compiles %s unlock=%s teaser=%s to %s', async (mode, unlock, teaser, expected) => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VITE_AUTOMATION_MAP_UNLOCK', unlock);
  vi.stubEnv('VITE_AUTOMATION_MAP_FORCE_TEASER', teaser);
  try {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      mode,
      build: {
        write: false,
        minify: false,
        lib: {
          entry: new URL('../src/content/automation-map/data/access.ts', import.meta.url).pathname,
          formats: ['es'],
          fileName: 'map-access',
        },
      },
    });
    const output = Array.isArray(result) ? result : [result];
    const code = output
      .flatMap((o) =>
        'output' in o ? o.output.filter((c) => c.type === 'chunk').map((c) => c.code) : [],
      )
      .join('\n');
    expect(code).toMatch(
      new RegExp(
        `function automationMapDevAccess\\(\\)\\s*\\{\\s*return ${expected === null ? 'null' : `["']${expected}["']`};`,
      ),
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
