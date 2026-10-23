import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/workflow-cache.spec.ts', '**/automation-map.spec.ts'],
  timeout: 30_000,
  use: {
    trace: 'retain-on-failure',
  },
});
