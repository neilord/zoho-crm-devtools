import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig(base, {
  testIgnore: [],
  testMatch: '**/automation-map.spec.ts',
  workers: 1,
});
