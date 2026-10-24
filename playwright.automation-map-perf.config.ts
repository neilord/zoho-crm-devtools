import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Profiling only (tests/e2e/automation-map-perf.spec.ts); never part of CI.
export default defineConfig(base, {
  testIgnore: [],
  testMatch: '**/automation-map-perf.spec.ts',
  workers: 1,
  timeout: 300_000,
});
