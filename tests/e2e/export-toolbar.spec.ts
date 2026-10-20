import { chromium, expect, test } from '@playwright/test';
import { createServer } from 'vite';

// Sanitized new Zoho toolbar hooks from functions-page.test.ts; no real org or account access.
test('1280px export popover preserves the toolbar through progress, error, retry and partial success', async () => {
  const server = await createServer({
    configFile: false,
    root: new URL('../..', import.meta.url).pathname,
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.route('**/org42/settings/functions', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8"><style>
        body { margin: 0; font: 14px system-ui; color: #313949; background: #fafbfc; }
        header { padding: 20px 28px; background: #fff; border-bottom: 1px solid #e3e6eb; }
        h1 { font-size: 20px; margin: 0 0 24px; }
        .flexAlignCenter { display: flex; align-items: center; overflow: hidden; }
        .fg1 { margin-left: auto; } input { width: 225px; height: 34px; box-sizing: border-box; padding: 8px; border: 1px solid #c7ced8; border-radius: 6px; }
        main { margin: 28px; padding: 18px; background: white; border: 1px solid #e3e6eb; }
      </style></head><body><header><h1>Functions</h1><div class="flexAlignCenter">
      <div>All Functions (918)　 Sort　 Filter</div>
      <div data-zcqa="fxn_lv_search_parent" class="fg1"><lyte-input data-zcqa="fxn_lv_search"><input placeholder="Search"></lyte-input></div>
      </div></header><main>Sanitized toolbar harness · no customer data</main>
      <script type="module">
        import { mountFunctionExport } from '/src/content/functions/export-ui.ts';
        import { injectSearchButton } from '/src/content/functions/toolbar-button.ts';
        import { FREE } from '/src/billing/entitlement.ts';
        window.chrome = { storage: { sync: { get: async () => ({}) } } };
        const search = injectSearchButton(document.querySelector('[data-zcqa="fxn_lv_search_parent"]'), () => {});
        const root = document.createElement('section'); root.id = 'zcdt-function-export'; search.after(root);
        window.mode = 'error'; window.downloads = [];
        mountFunctionExport(root, {
          getEntitlement: async () => ({ signedIn: true, entitlement: { ...FREE, plan: 'pro', entitled: true, status: 'trialing', checkedAt: new Date().toISOString() } }),
          contextIsCurrent: () => true,
          download: file => window.downloads.push(file),
          load: async (_context, progress) => {
            progress({ loaded: 120, total: 918 });
            await new Promise(resolve => { window.finish = resolve; });
            if (window.mode === 'error') throw new Error('fixture failure');
            return {
              records: Array.from({ length: 915 }, (_, i) => ({ summary: { id: String(i + 1), display_name: 'Fixture ' + i, category: 'Standalone' }, detail: { id: String(i + 1), script: 'info 1;' } })),
              skipped: [916, 917, 918].map(id => ({ id: String(id), name: 'Unavailable ' + id, apiName: 'fixture_' + id, reason: 'Zoho returned HTTP 503' }))
            };
          }
        });
      </script></body></html>`,
      }),
    );
    await page.goto(`${server.resolvedUrls?.local[0]}org42/settings/functions`);
    const trigger = page.locator('[data-zcdt-export-run]');
    const status = page.locator('[data-zcdt-export-status]');
    await expect(trigger).toBeVisible();
    const baseline = await trigger.boundingBox();
    const folder = test.info().outputPath('screenshots');
    const screenshot = (name: string) => page.screenshot({ path: `${folder}/${name}.png` });
    await trigger.click();
    await screenshot('format-menu-1280');
    await page.locator('[data-zcdt-export-format="json"]').click();
    await expect(status).toContainText('Exporting 120 of 918');
    await expect(trigger).toHaveText('Export');
    expect(await trigger.boundingBox()).toEqual(baseline);
    await screenshot('progress-1280');
    await page.evaluate('window.finish()');
    await expect(status).toContainText('No file was downloaded');
    expect(await trigger.boundingBox()).toEqual(baseline);
    const card = await status.boundingBox();
    expect(card?.width).toBe(320);
    expect(card?.y).toBe((baseline?.y ?? 0) + (baseline?.height ?? 0) + 6);
    expect((card?.x ?? 0) + (card?.width ?? 0)).toBeLessThanOrEqual(1272);
    const message = await status.locator('.zx-msg').boundingBox();
    const actions = await status.locator('.zx-actions').boundingBox();
    expect(actions?.y).toBeGreaterThan((message?.y ?? 0) + (message?.height ?? 0));
    await screenshot('error-1280');
    await page.clock.fastForward(7000);
    await expect(status).toBeVisible();
    await page.evaluate("window.mode = 'partial'");
    await status.getByRole('button', { name: 'Try again' }).click();
    await expect(status).toContainText('Exporting 120 of 918');
    await page.evaluate('window.finish()');
    await expect(status).toContainText(
      "Exported 915 of 918 functions — 3 couldn't be read from Zoho (listed in the file)",
    );
    expect(await trigger.boundingBox()).toEqual(baseline);
    const resultText = await status.locator('.zx-msg > span').boundingBox();
    expect(resultText?.width).toBeGreaterThan(240);
    expect(resultText?.height).toBeLessThan(120);
    await screenshot('partial-success-1280');
    expect(await page.evaluate('JSON.parse(window.downloads[0].content).skipped.length')).toBe(3);
    await page.clock.fastForward(6100);
    await expect(status).toBeHidden();
    await expect(trigger).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await server.close();
  }
});
