// @vitest-environment node
import { build } from 'vite';
import { expect, it, vi } from 'vitest';

it.each([
  ['production', false],
  ['development', true],
] as const)('build mode %s compiles the flagged override to %s', async (mode, allowed) => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VITE_WORKFLOW_SEARCH_UNLOCK', 'true');
  try {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      mode,
      build: {
        write: false,
        minify: false,
        lib: {
          entry: decodeURIComponent(
            new URL('../src/content/workflows/controller.ts', import.meta.url).pathname,
          ),
          formats: ['es'],
          fileName: 'workflow-gate',
        },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const code = outputs
      .flatMap((output) => {
        if (!('output' in output)) throw new Error('Unexpected build output');
        return output.output.filter((chunk) => chunk.type === 'chunk').map((chunk) => chunk.code);
      })
      .join('\n');
    expect(code).toMatch(
      new RegExp(`function workflowSearchDevOverride\\(\\)\\s*\\{\\s*return ${allowed};`),
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
