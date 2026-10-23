import { defineConfig } from 'vite';

// Development-only UI harness for the Automation Map (synthetic fixtures, no extension APIs).
// Run: npx vite --config vite.harness.config.ts → http://localhost:5174/<page>.html
const repoRoot = new URL('.', import.meta.url).pathname;

export default defineConfig({
  root: `${repoRoot}harness`,
  server: { port: 5174, strictPort: true, fs: { allow: [repoRoot] } },
});
