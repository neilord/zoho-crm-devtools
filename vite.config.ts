import { crx } from '@crxjs/vite-plugin';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { createManifest } from './manifest.config';

/**
 * CRXJS loaders point at entry chunks by output name. Two `index.ts` entries once made the
 * service-worker loader import the content-script chunk, so the worker never answered. Fail the
 * build if a loader does not import the chunk built from its own entry.
 */
function assertLoaderTargets(): Plugin {
  return {
    name: 'zcdt-assert-loader-targets',
    apply: 'build',
    writeBundle(_options, bundle) {
      const chunkFor = (fileName: string) => {
        const output = bundle[fileName];
        if (output?.type !== 'chunk') throw new Error(`Loader target ${fileName} is not a chunk`);
        return output;
      };
      const expect = (loader: string, target: RegExp, entry: string) => {
        const output = bundle[loader];
        const source = output?.type === 'asset' ? String(output.source) : output?.code;
        const fileName = source && target.exec(source)?.[1];
        if (!fileName) throw new Error(`Cannot read the import in ${loader}`);
        if (!chunkFor(fileName).moduleIds.some((id) => id.endsWith(entry)))
          throw new Error(`${loader} imports ${fileName}, which was not built from ${entry}`);
      };
      expect('service-worker-loader.js', /import '\.\/(.+?)'/, 'src/background/worker.ts');
      const contentLoader = Object.keys(bundle).find((name) => /index\.ts-loader-/.test(name));
      if (!contentLoader) throw new Error('Content script loader missing');
      expect(contentLoader, /getURL\("(.+?)"\)/, 'src/content/index.ts');
    },
  };
}

export default defineConfig(({ mode }) => {
  // Production code with the pinned unpacked id, so a local copy can reach the account API.
  const pinDevKey = loadEnv(mode, '.', 'ZCDT_').ZCDT_PIN_DEV_KEY === 'true';
  return {
    plugins: [crx({ manifest: createManifest(mode, { pinDevKey }) }), assertLoaderTargets()],
    build: {
      sourcemap: true,
      rollupOptions: { input: { callback: 'src/billing/oauth-callback.html' } },
    },
  };
});
