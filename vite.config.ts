import { crx } from '@crxjs/vite-plugin';
import { defineConfig } from 'vite';
import { createManifest } from './manifest.config';

export default defineConfig(({ mode }) => ({
  plugins: [crx({ manifest: createManifest(mode) })],
  build: {
    sourcemap: true,
  },
}));
