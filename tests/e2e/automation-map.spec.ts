import { chromium, expect, type Page, test } from '@playwright/test';
import {
  automationMapResponse,
  fogSecrets,
  functionId,
  settingsHtml,
  sourceNeedle,
  workflowsHtml,
} from '../fixtures/automation-map-zoho';

const screenshots =
  '/private/tmp/claude-501/-Users-admin-Developer-zoho-crm-devtools/6343591f-b07c-4a8b-81de-7a58a586da91/scratchpad/integration';
const host = '#zcdt-automation-map-overlay';
const setupUrl = 'https://crm.zoho.com/crm/org123/settings/index';
const shot = async (page: Page, name: string) =>
  page.screenshot({ animations: 'disabled', path: `${screenshots}/${name}.png` });

for (const teaser of [false, true]) {
  test(`packaged Automation Map ${teaser ? 'teaser' : 'full'} end to end`, async () => {
    test.setTimeout(90_000);
    const dist = new URL(teaser ? '../../dist-dev/teaser' : '../../dist-dev', import.meta.url)
      .pathname;
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      reducedMotion: 'reduce',
      viewport: { width: 1440, height: 1000 },
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    const errors: string[] = [],
      unexpected: string[] = [],
      paths: string[] = [],
      scripts: string[] = [];
    let warmBarrier: Promise<void> | null = null;
    let releaseWarm = () => {};
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      worker.on('console', (m) => {
        if (m.type() === 'error') errors.push(`worker: ${m.text()}`);
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !m.text().includes('400 (Bad Request)')) errors.push(m.text());
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Debugger.enable');
      cdp.on('Debugger.scriptParsed', (event) => scripts.push(event.url));
      await context.route('https://crm.zoho.com/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/crm/org123/')) {
          await route.fulfill({
            contentType: 'text/html',
            body: url.pathname.endsWith('workflow-rules') ? workflowsHtml : settingsHtml,
          });
          return;
        }
        if (url.pathname === '/favicon.ico') {
          await route.fulfill({ status: 204 });
          return;
        }
        paths.push(`${url.pathname}${url.search}`);
        if (warmBarrier) await warmBarrier;
        const response = automationMapResponse(url);
        if (!response) {
          unexpected.push(url.href);
          await route.fulfill({ status: 404 });
          return;
        }
        await route.fulfill({
          status: response.status ?? 200,
          contentType: 'application/json',
          ...(response.status === 204
            ? {}
            : { body: response.raw ?? JSON.stringify(response.body) }),
        });
      });
      await page.goto(setupUrl);
      const row = page.locator('[data-zcdt-map-entry="home"]');
      const entry = row.locator('a');
      await expect(entry).toBeVisible();
      // Zoho's own markup: the marker follows the link as a sibling (it is not inside the anchor).
      await expect(
        row.locator(
          'a + .zcdt-map-new.right0.top2 > crm-ui-loaders > .crmNewReleaseLoader > .crmNewReleaseLoader_1',
        ),
      ).toHaveCount(1);
      await expect(row.locator('.crmNewReleaseLoader > div')).toHaveCount(3);
      await expect(row.locator('.zcdt-map-new')).toHaveText('');
      expect(
        await row
          .locator('.zcdt-map-new')
          .evaluate((el) => getComputedStyle(el, '::after').backgroundImage),
      ).toContain('data:image/svg+xml');
      expect(scripts.some((s) => /\/runtime-/.test(s))).toBe(false);
      expect(paths).toEqual([]);
      await entry.click();
      await expect(page.getByRole('dialog', { name: 'Automation Map', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'What can change a field?' })).toBeVisible();
      await expect
        .poll(() => scripts.some((s) => /^chrome-extension:\/\/.*\/runtime-/.test(s)))
        .toBe(true);
      await expect(page.locator(`${host} .footstatus`)).toContainText(
        teaser ? 'Preview' : '3 rules',
        { timeout: 20_000 },
      );
      await expect(page.locator(`${host} .wf-index .wf-pill`)).not.toContainText('Mapping');
      // Design review: muted text and lane labels clear 4.5:1 on white, grey surfaces and canvas.
      const ratios = await page.locator(host).evaluate((el) => {
        const css = getComputedStyle(el.shadowRoot?.querySelector('.am-root') as Element);
        const lum = (value: string) => {
          // The production build minifies #ffffff to #fff.
          const v = value.trim();
          const hex = v.length === 4 ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : v;
          const [r, g, b] = [1, 3, 5].map((i) => {
            const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const ratio = (a: string, b: string) => {
          const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
          return (hi + 0.05) / (lo + 0.05);
        };
        const surfaces = ['--fs-bg', '--fs-surface', '--am-canvas'].map((n) =>
          css.getPropertyValue(n),
        );
        return ['--fs-muted', '--am-lane-label'].flatMap((n) =>
          surfaces.map((surface) => ratio(css.getPropertyValue(n), surface)),
        );
      });
      for (const r of ratios) expect(r).toBeGreaterThanOrEqual(4.5);
      await shot(page, teaser ? 'teaser-fields' : 'full-fields');
      if (teaser) {
        // Scan text, attributes and hidden view markup, not just visible labels.
        const scan = async () => {
          const html = await page.locator(host).evaluate((el) => el.shadowRoot?.innerHTML ?? '');
          for (const secret of fogSecrets) expect(html).not.toContain(secret);
        };
        await scan();
        await page.getByRole('button', { name: 'Board', exact: true }).click();
        await expect(page.locator(`${host} .amc-fog`).first()).toBeVisible();
        await expect(page.locator(`${host} [data-island="Orchards"]`)).toHaveCount(1);
        await expect(page.locator(`${host} .am-fog-host`)).toContainText('1 flow');
        await scan();
        await shot(page, 'teaser-board');
        await expect(page.locator(`${host} .amc-k-rule`)).toBeVisible();
        await scan();
        await shot(page, 'teaser-flow');
        await page.getByRole('button', { name: 'List', exact: true }).click();
        await expect(page.locator(`${host} [role="treegrid"]`)).toContainText('Harvest flow');
        await expect(
          page.locator(`${host} .lt-row`).filter({ hasText: 'Workflow rule' }),
        ).toHaveCount(1);
        await scan();
        const teaserPaths = [...paths];
        // A Plus-style entry into a fogged sibling must neither stack the dashboard nor
        // carry that rule's identity into the map hash/Copy link state.
        await page.locator(`${host} .am-head [aria-label="Close Automation Map"]`).click();
        await page.goto('https://crm.zoho.com/crm/org123/settings/workflow-rules');
        await page.locator('#zcdt-workflow-search-button').click();
        await page
          .locator('#wf-results [role="option"]')
          .filter({ hasText: 'Fogged sibling rule' })
          .click();
        await page.getByRole('button', { name: 'Show on map' }).click();
        await expect(page.locator('#zcdt-workflow-search-overlay')).toHaveCount(0);
        await expect(page.locator(`${host} .am-insp.open`)).toHaveCount(0);
        await expect(page.locator(`${host} .amc-k-rule`)).toBeVisible();
        await expect.poll(() => page.evaluate(() => location.hash)).not.toContain('rule:102');
        await scan();
        await page.getByRole('button', { name: 'Upgrade to Pro', exact: true }).first().click();
        await expect(page.locator('[data-zcdt-upgrade-modal]')).toBeVisible();
        await expect(page.locator('[data-zcdt-upgrade-modal]')).toContainText(
          'Automation Map is a Pro feature',
        );
        await expect(page.locator('[data-zcdt-upgrade-action="sign-in"]')).toContainText('Log in');
        await expect(page.locator('[data-zcdt-upgrade-modal]')).toContainText(
          'every way a field can change',
        );
        expect(
          await page.evaluate(() =>
            Boolean(
              document
                .elementFromPoint(innerWidth / 2, innerHeight / 2)
                ?.closest('[data-zcdt-upgrade-modal]'),
            ),
          ),
        ).toBe(true);
        await shot(page, 'teaser-upgrade');
        await page.locator('[data-zcdt-upgrade-action="close"]').click();
        const allowed = new Set([
          '/crm/v2/settings/functions',
          `/crm/v2/settings/functions/${functionId}`,
          '/crm/v8/settings/automation/workflow_rules',
          '/crm/v8/settings/automation/workflow_rules/101',
          '/crm/v8/settings/automation/functions/301',
          '/crm/v8/settings/automation/field_updates/302',
          '/crm/v8/settings/modules',
          '/crm/v2.2/settings/modules',
        ]);
        expect(teaserPaths.every((p) => allowed.has(p.split('?')[0]))).toBe(true);
        expect(
          teaserPaths.filter((p) => /\/(workflow_rules|functions|field_updates)\/\d+/.test(p)),
        ).toHaveLength(4);
        expect(
          await worker.evaluate(async () => (await indexedDB.databases()).map((d) => d.name)),
        ).not.toContain('zcdt-automation-map-v1');
      } else {
        const picker = page.getByRole('combobox', { name: 'Pick a field' });
        await picker.fill('Orchards.Harvest');
        await page.getByRole('option').first().click();
        await expect(page.locator(`${host} #am-fields`)).toContainText('Declared in configuration');
        await expect(page.locator(`${host} #am-fields`)).toContainText('Ripen orchard');
        await expect(page.locator(`${host} #am-fields`)).toContainText('Functions · exact');
        await shot(page, 'full-field-lens');
        await page.getByRole('button', { name: 'Board', exact: true }).click();
        await expect(page.locator(`${host} [data-island="Orchards"]`)).toBeVisible();
        await shot(page, 'full-board');
        const search = page.getByRole('searchbox', { name: 'Search the map' });
        await search.fill(sourceNeedle);
        await expect(page.locator(`${host} .ritem`).first()).toContainText('Ripen orchard');
        await shot(page, 'full-source-search');
        await search.fill('');
        await page.locator(`${host} .am-head [aria-label="Close Automation Map"]`).click();
        await expect(entry).toBeFocused();
        expect(scripts.some((s) => /\/dagre\.esm-/.test(s))).toBe(false);
        await page.evaluate(() => {
          location.hash = '#zcdt-map=v1;view=trace;sel=rule:101;trace=rule:101,2,3';
        });
        await expect(page.getByRole('group', { name: 'Trace flowchart' })).toBeVisible();
        await expect(page.locator(`${host} #am-trace .amc-nd`).first()).toBeVisible();
        await expect
          .poll(() => scripts.some((s) => /^chrome-extension:\/\/.*\/dagre\.esm-/.test(s)))
          .toBe(true);
        await expect(page.locator(`${host} .footstatus`)).toContainText('3 rules');
        // Design review: with the inspector open, the trace bar's controls (Re-centre, Exit trace)
        // stay left of it instead of sitting under it.
        await expect
          .poll(() =>
            page.locator(host).evaluate((el) => {
              const sh = el.shadowRoot;
              const insp = sh?.querySelector('.am-insp.open');
              const bar = sh?.querySelector('.amc-tracebar');
              if (!insp || !bar) return null;
              const edge = insp.getBoundingClientRect().left;
              const shown = [...bar.children].filter((c) => c.getBoundingClientRect().width > 0);
              return Math.max(...shown.map((c) => c.getBoundingClientRect().right)) - edge;
            }),
          )
          .toBeLessThanOrEqual(1);
        await shot(page, 'full-trace');
        // A link typed into this tab sits right above the page: Back closes the map where the
        // page stood, Forward brings the same view back, and neither adds a dead entry.
        await expect.poll(() => page.evaluate(() => location.hash)).toContain('view=trace');
        const traced = await page.evaluate(() => location.hash);
        await page.goBack();
        await expect(page.locator(host)).toHaveCount(0);
        expect(await page.evaluate(() => location.href)).toBe(setupUrl);
        await page.goForward();
        await expect(page.getByRole('group', { name: 'Trace flowchart' })).toBeVisible();
        expect(await page.evaluate(() => location.hash)).toContain('view=trace');
        expect(await page.evaluate(() => location.hash)).toContain(traced.split(';')[2]);
        // Real extension-origin IndexedDB, with no refreshed response able to mask missing cache data.
        await expect
          .poll(() =>
            worker.evaluate(async () => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const r = indexedDB.open('zcdt-automation-map-v1', 1);
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error);
              });
              const count = await new Promise<number>((resolve) => {
                const r = db.transaction('partitions').objectStore('partitions').count();
                r.onsuccess = () => resolve(r.result);
              });
              db.close();
              return count;
            }),
          )
          .toBe(1);
        await page.locator(`${host} .am-head [aria-label="Close Automation Map"]`).click();
        for (const reload of [false, true]) {
          if (reload) await page.reload();
          warmBarrier = new Promise<void>((resolve) => {
            releaseWarm = resolve;
          });
          const beforeWarmRequests = paths.length;
          const start = Date.now();
          await entry.click();
          await expect(page.locator(`${host} .footstatus`)).toContainText('3 rules', {
            timeout: 2000,
          });
          await page.getByRole('searchbox', { name: 'Search the map' }).fill(sourceNeedle);
          await expect(page.locator(`${host} .ritem`).first()).toContainText('Ripen orchard', {
            timeout: 2000,
          });
          expect(paths.length).toBe(beforeWarmRequests);
          console.log({ reload, warmMs: Date.now() - start });
          releaseWarm();
          warmBarrier = null;
          await page.locator(`${host} .am-head [aria-label="Close Automation Map"]`).click();
        }
        await page.goto('https://crm.zoho.com/crm/org123/settings/workflow-rules');
        await page.locator('#zcdt-automation-map-button').click();
        await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await page.locator(`${host} .am-head [aria-label="Close Automation Map"]`).click();
        await page.locator('#zcdt-workflow-search-button').click();
        await page
          .locator('#wf-results [role="option"]')
          .filter({ hasText: 'Harvest flow' })
          .click();
        await expect(
          page.locator('#zcdt-workflow-search-overlay .wf-detail-footer button'),
        ).toHaveCount(3);
        for (const width of [1024, 1280]) {
          await page.setViewportSize({ width, height: 1000 });
          const buttonsFit = await page
            .locator('#zcdt-workflow-search-overlay .wf-detail-footer')
            .evaluate((footer) => {
              const rect = footer.getBoundingClientRect();
              return [...footer.querySelectorAll('button')].every((button) => {
                const b = button.getBoundingClientRect();
                return (
                  b.left >= rect.left &&
                  b.right <= rect.right + 1 &&
                  b.top >= rect.top &&
                  b.bottom <= rect.bottom + 1
                );
              });
            });
          expect(buttonsFit).toBe(true);
          await shot(page, `workflow-inspector-${width}`);
        }
        await page.getByRole('button', { name: 'Show on map' }).click();
        await expect(page.locator('#zcdt-workflow-search-overlay')).toHaveCount(0);
        await expect(
          page.getByRole('dialog', { name: 'Automation Map', exact: true }),
        ).toBeVisible();
        await expect(page.locator(`${host} .footstatus`)).toContainText('3 rules');
        await expect(page.locator(`${host} .am-insp`)).toContainText('Harvest flow');
        await expect.poll(() => page.evaluate(() => location.hash)).toContain('sel=rule:101');
        await expect.poll(() => page.evaluate(() => location.hash)).toContain('focus=Orchards');
        await shot(page, 'workflow-show-on-map');
      }
      // Escape ladder may first leave Trace/selection before closing.
      for (let i = 0; i < 5 && (await page.locator(host).count()); i++)
        await page.keyboard.press('Escape');
      await expect(page.locator(host)).toHaveCount(0);
      await expect(page.locator('#zcdt-workflow-search-button')).toBeFocused();
      expect(unexpected).toEqual([]);
      expect(errors).toEqual([]);
      console.log({
        teaser,
        scripts: scripts.filter((s) => /\/(runtime|dagre\.esm)-/.test(s)),
        requests: paths.length,
      });
    } finally {
      releaseWarm();
      await context.close();
    }
  });
}

test('map source cache survives a complete browser and service-worker restart', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const dist = new URL('../../dist-dev', import.meta.url).pathname;
  const profile = testInfo.outputPath('restart-profile');
  let release = () => {};
  for (const warm of [false, true]) {
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      await context.route('https://crm.zoho.com/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/crm/org123/')) {
          await route.fulfill({ contentType: 'text/html', body: settingsHtml });
          return;
        }
        if (url.pathname === '/favicon.ico') {
          await route.fulfill({ status: 204 });
          return;
        }
        if (warm) await barrier;
        const response = automationMapResponse(url);
        if (!response) throw new Error(`Unexpected synthetic request ${url.pathname}`);
        await route.fulfill({
          status: response.status ?? 200,
          contentType: 'application/json',
          ...(response.status === 204
            ? {}
            : { body: response.raw ?? JSON.stringify(response.body) }),
        });
      });
      const page = await context.newPage();
      await page.goto(setupUrl);
      const start = Date.now();
      await page.locator('[data-zcdt-map-entry="home"] a').click();
      await expect(page.locator(`${host} .footstatus`)).toContainText('3 rules', {
        timeout: warm ? 2000 : 15_000,
      });
      await page.getByRole('searchbox', { name: 'Search the map' }).fill(sourceNeedle);
      await expect(page.locator(`${host} .ritem`).first()).toContainText('Ripen orchard', {
        timeout: 2000,
      });
      if (warm) {
        console.log({ browserRestartWarmMs: Date.now() - start });
        await shot(page, 'full-browser-restart-cache');
      } else {
        // Wait for the advisory write before destroying the entire browser process.
        await expect
          .poll(() =>
            worker.evaluate(async () => {
              const db = await new Promise<IDBDatabase>((resolve) => {
                const request = indexedDB.open('zcdt-automation-map-v1', 1);
                request.onsuccess = () => resolve(request.result);
              });
              const count = await new Promise<number>((resolve) => {
                const request = db.transaction('partitions').objectStore('partitions').count();
                request.onsuccess = () => resolve(request.result);
              });
              db.close();
              return count;
            }),
          )
          .toBe(1);
      }
    } finally {
      release();
      await context.close();
    }
  }
});

test('Back closes the map and Copy link names the view you are looking at', async () => {
  test.setTimeout(90_000);
  const dist = new URL('../../dist-dev', import.meta.url).pathname;
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const errors: string[] = [];
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'https://crm.zoho.com',
    });
    await context.route('https://crm.zoho.com/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/crm/org123/')) {
        await route.fulfill({ contentType: 'text/html', body: settingsHtml });
        return;
      }
      if (url.pathname === '/favicon.ico') {
        await route.fulfill({ status: 204 });
        return;
      }
      const response = automationMapResponse(url);
      if (!response) {
        await route.fulfill({ status: 404 });
        return;
      }
      await route.fulfill({
        status: response.status ?? 200,
        contentType: 'application/json',
        ...(response.status === 204 ? {} : { body: response.raw ?? JSON.stringify(response.body) }),
      });
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const hash = () => page.evaluate(() => location.hash);
    const href = () => page.evaluate(() => location.href);
    const dialog = page.getByRole('dialog', { name: 'Automation Map', exact: true });

    // A link opened cold: the plain page goes under the map, so Back stays on the page.
    await page.goto('about:blank');
    await page.goto(`${setupUrl}#zcdt-map=v1;view=list`);
    await expect(dialog).toBeVisible();
    await expect(page.locator(`${host} [role="treegrid"]`)).toBeVisible();
    await page.goBack();
    await expect(page.locator(host)).toHaveCount(0);
    expect(await href()).toBe(setupUrl);
    await page.goForward();
    await expect(dialog).toBeVisible();
    expect(await hash()).toContain('view=list');

    // Closing from the UI pops the map's own entry.
    const length = await page.evaluate(() => history.length);
    await page.locator(`${host} .am-head [aria-label="Close Automation Map"]`).click();
    await expect(page.locator(host)).toHaveCount(0);
    await expect.poll(href).toBe(setupUrl);
    expect(await page.evaluate(() => history.length)).toBe(length);

    // Opening from the page adds exactly one entry; the hash follows the view and selection.
    await page.locator('[data-zcdt-map-entry="home"] a').click();
    await expect(dialog).toBeVisible();
    await expect.poll(hash).toContain('view=fields');
    expect(await page.evaluate(() => history.length)).toBe(length);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect.poll(hash).toContain('view=list');
    await expect(page.locator(`${host} [role="treegrid"]`)).toContainText('Harvest flow');
    await page.locator(`${host} .lt-row`).filter({ hasText: 'Harvest flow' }).first().click();
    await expect(page.locator(`${host} .am-insp.open`)).toContainText('Harvest flow');
    // Copy link right after a change, before the debounced write: it must name this view.
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await page.locator(`${host} .ins-acts button`, { hasText: 'Copy link' }).click();
    await expect(page.locator(`${host} .toast`)).toContainText('Link copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(await href());
    expect(copied).toContain('view=board');
    expect(copied).toContain('sel=rule:101');

    // The copied link reopens the same view in a fresh load.
    await page.goto('about:blank');
    await page.goto(copied);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator(`${host} .am-insp.open`)).toContainText('Harvest flow');

    // An edit to the hash while the map is open drives the view.
    await page.evaluate(() => {
      location.hash = '#zcdt-map=v1;view=list';
    });
    await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator(`${host} .am-insp.open`)).toHaveCount(0);
    // Back returns to the previous map state, and once more leaves the map.
    await page.goBack();
    await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.goBack();
    await expect(page.locator(host)).toHaveCount(0);
    expect(await href()).toBe(setupUrl);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('warm open with persistent HTTP 503 failures performs zero Zoho requests', async () => {
  test.setTimeout(90_000);
  const dist = new URL('../../dist-dev', import.meta.url).pathname;
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const paths: string[] = [];
  try {
    await context.route('https://crm.zoho.com/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/crm/org123/')) {
        await route.fulfill({ contentType: 'text/html', body: settingsHtml });
        return;
      }
      if (url.pathname === '/favicon.ico') {
        await route.fulfill({ status: 204 });
        return;
      }
      paths.push(url.pathname);
      if (url.pathname === '/crm/v9/settings/approval_process') {
        await route.fulfill({
          json: {
            approval_process: [
              {
                id: '901',
                name: 'Synthetic approval',
                module: { api_name: 'Orchards' },
                active: true,
              },
            ],
          },
        });
        return;
      }
      if (
        url.pathname === '/crm/v9/settings/approval_process/901/rules' ||
        (url.pathname === '/crm/v8/settings/fields' &&
          url.searchParams.get('module') === 'Orchards')
      ) {
        await route.fulfill({ status: 503, json: { code: 'INTERNAL_ERROR' } });
        return;
      }
      const response = automationMapResponse(url);
      if (!response) throw new Error(`Unexpected synthetic request ${url.pathname}`);
      await route.fulfill({
        status: response.status ?? 200,
        contentType: 'application/json',
        ...(response.status === 204 ? {} : { body: response.raw ?? JSON.stringify(response.body) }),
      });
    });
    const page = await context.newPage();
    await page.goto(setupUrl);
    const entry = page.locator('[data-zcdt-map-entry="home"] a');
    await entry.click();
    const pill = page.locator(`${host} .wf-pill`);
    await expect(pill).toContainText('Mapped', { timeout: 30_000 });
    await expect(page.locator(`${host} .footstatus`)).not.toContainText('refreshing');
    const failurePath = '/crm/v9/settings/approval_process/901/rules';
    expect(paths.filter((p) => p === failurePath).length).toBeGreaterThan(1);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await expect
      .poll(() =>
        worker.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve) => {
            const request = indexedDB.open('zcdt-automation-map-v1', 1);
            request.onsuccess = () => resolve(request.result);
          });
          const count = await new Promise<number>((resolve) => {
            const request = db.transaction('partitions').objectStore('partitions').count();
            request.onsuccess = () => resolve(request.result);
          });
          db.close();
          return count;
        }),
      )
      .toBe(1);
    // Reopen from persisted worker cache in a new content script, within the freshness window.
    await page.locator(`${host} [aria-label="Close Automation Map"]`).click();
    await expect(page.locator(host)).toHaveCount(0);
    await page.reload();
    const before = paths.length;
    await entry.click();
    await expect(page.locator(`${host} .footstatus`)).toContainText('3 rules', { timeout: 2000 });
    await expect(pill).toContainText('gap');
    await expect(page.locator(`${host} .footstatus`)).not.toContainText('refreshing');
    expect(paths.length).toBe(before);
    // Retry from a new document must use only the persisted failure identity.
    const beforeRetry = paths.length;
    await pill.click();
    await page.locator(`${host} [data-fk="retry-all"]`).click();
    await expect.poll(() => paths.length - beforeRetry, { timeout: 30_000 }).toBe(8);
    await expect(page.locator(`${host} .footstatus`)).not.toContainText('refreshing');
    await expect(pill).toContainText('Mapped', { timeout: 30_000 });
    expect(paths.slice(beforeRetry).sort()).toEqual(
      [...Array(4).fill(failurePath), ...Array(4).fill('/crm/v8/settings/fields')].sort(),
    );
    // Explicit refresh still revalidates unrelated dependencies.
    await expect(page.locator(`${host} .wf-pop`)).toContainText('Updated');
    const beforeRefresh = paths.length;
    await page.locator(`${host} [data-fk="refresh-now"]`).click();
    await expect
      .poll(() => paths.slice(beforeRefresh).filter((p) => p === failurePath).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await expect(page.locator(`${host} .footstatus`)).not.toContainText('refreshing', {
      timeout: 30_000,
    });
    expect(paths.slice(beforeRefresh).some((p) => p.endsWith('/settings/functions'))).toBe(true);
  } finally {
    await context.close();
  }
});
