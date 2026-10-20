import { chromium, expect, test } from '@playwright/test';
import { detail, summary } from '../fixtures/workflows';

// Opt-in: npm run test:e2e:workflows. All CRM traffic is synthetic.
test('built workflow index survives close/reopen and reload with realistic sources and gaps', async () => {
  test.setTimeout(120_000);
  const dist = new URL('../../dist-dev', import.meta.url).pathname;
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const logs: string[] = [];
  const counts = new Map<string, number>();
  let failSources = false;
  let warmBarrier: Promise<void> | null = null;
  let releaseWarm = () => {};
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    worker.on('console', (m) => logs.push(`worker ${m.type()}: ${m.text()}`));
    const page = await context.newPage();
    page.on('console', (m) => logs.push(`content ${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
    const catalogue = Array.from({ length: 217 }, (_, i) => ({
      id: String(5000 + i),
      api_name: `wf_synthetic_${i}`,
      display_name: `Synthetic function ${i}`,
      source: 'crm',
      language: 'deluge',
      category: 'Automation',
      updatedTime: '2030-01-01',
    }));
    // Deterministic varied source text: 2–20 KB, invented and free of customer data.
    const sources = catalogue.map((_, i) =>
      Array.from(
        { length: 40 + (i % 19) * 20 },
        (_, j) =>
          `info "synthetic_${i}_${j}_${Math.imul(i + 1, j + 76543) >>> 0}"; // orchard workflow\n`,
      ).join(''),
    );
    await context.route('https://crm.zoho.com/**', async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.match(/\/crm\/v[28]\//)) {
        await route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html><body><h1>Workflow Rules</h1><list-workflows><div><input id="wfSearchWithName1" placeholder="Search"></div></list-workflows></body></html>',
        });
        return;
      }
      counts.set(url.pathname, (counts.get(url.pathname) ?? 0) + 1);
      if (warmBarrier) await warmBarrier;
      // Give cold work measurable cost and keep warm revalidation in progress during assertions.
      await new Promise((resolve) => setTimeout(resolve, 15));
      const id = Number(url.pathname.split('/').at(-1));
      let body: unknown;
      if (url.pathname.endsWith('/workflow_rules')) {
        const start = (Number(url.searchParams.get('page')) - 1) * 200;
        body = {
          workflow_rules: Array.from({ length: 330 }, (_, i) => summary(String(1000 + i))).slice(
            start,
            start + 200,
          ),
          info: { more_records: start === 0 },
        };
      } else if (url.pathname.includes('/workflow_rules/')) {
        const i = id - 1000;
        const actions = [
          {
            id: String(3000 + (i % 217)),
            name: `Synthetic function ${i % 217}`,
            type: 'functions',
          },
          {
            id: String(4000 + (i % 92)),
            name: `Synthetic email ${i % 92}`,
            type: 'email_notifications',
          },
        ];
        body = { workflow_rules: [detail(String(id), actions)] };
      } else if (url.pathname.includes('/automation/functions/')) {
        const i = id - 3000;
        body = {
          functions: [
            {
              id: String(id),
              name: `Synthetic function ${i}`,
              function: { ...(i < 212 ? { api_name: `wf_synthetic_${i}` } : {}) },
            },
          ],
        };
      } else if (url.pathname.includes('/email_notifications/')) {
        body = {
          email_notifications: [
            {
              id: String(id),
              name: `Resource-only marigold ${id}`,
              template: { id: String(id + 2000) },
            },
          ],
        };
      } else if (url.pathname.includes('/email_templates/')) {
        body = {
          email_templates: [
            {
              id: String(id),
              name: `Synthetic template ${id}`,
              subject: 'Orchard reminder',
              content: `<html><body>${'<p>Synthetic orchard notification</p>'.repeat(180)}</body></html>`,
            },
          ],
        };
      } else if (url.pathname.endsWith('/fields')) {
        body = { fields: [{ id: '71', api_name: 'Fruit', field_label: 'Fruit' }] };
      } else if (url.pathname.endsWith('/settings/functions')) {
        const start = Number(url.searchParams.get('start')) - 1;
        body = {
          functions: [
            ...catalogue,
            { id: '5999', api_name: null, display_name: 'Unbound legacy function' },
          ].slice(start, start + 200),
        };
      } else if (url.pathname.includes('/settings/functions/')) {
        if (failSources && id >= 5001 && id <= 5004) {
          await route.fulfill({ status: 403, json: { error: 'synthetic transient read failure' } });
          return;
        }
        body = {
          functions: [
            { ...catalogue[id - 5000], ...(id === 5000 ? {} : { script: sources[id - 5000] }) },
          ],
        };
      } else throw new Error(`Unexpected synthetic request ${url}`);
      await route.fulfill({ json: body });
    });
    const open = async () => {
      await page.getByRole('button', { name: 'Search All Workflows', exact: true }).click();
    };
    await page.goto('https://crm.zoho.com/crm/org999001/settings/workflow-rules');
    await open();
    const pill = page.locator('#zcdt-workflow-search-overlay [data-fk="pill"]');
    await expect(pill).toHaveAttribute('data-status', 'gaps', { timeout: 90_000 });
    await pill.click();
    await expect(page.locator('#wf-coverage')).toContainText('92/92');
    await expect(pill).toContainText('6 gaps');
    const stored = await worker.evaluate(async () => {
      const data = await chrome.storage.local.get('zcdt-workflow-caches-v1');
      return JSON.stringify(data).length;
    });
    console.log({ stored, requests: [...counts.values()].reduce((a, b) => a + b, 0), logs });
    // The UI completes just before compression/storage acknowledgement; poll actual storage.
    await expect
      .poll(async () =>
        worker.evaluate(
          async () =>
            Object.keys(
              (await chrome.storage.local.get('zcdt-workflow-caches-v1'))[
                'zcdt-workflow-caches-v1'
              ] ?? {},
            ).length,
        ),
      )
      .toBe(1);
    for (const reload of [false, true]) {
      await page.locator('[data-act="close"]').click();
      if (reload) {
        failSources = true;
        for (let i = 1; i <= 4; i++) catalogue[i].updatedTime = '2030-02-01';
        await page.reload();
      }
      warmBarrier = new Promise<void>((resolve) => {
        releaseWarm = resolve;
      });
      const before = [...counts.values()].reduce((a, b) => a + b, 0);
      const start = Date.now();
      await open();
      await pill.click();
      await expect(page.locator('#wf-coverage')).toContainText('211/217', { timeout: 2000 });
      await expect(page.locator('#wf-coverage')).toContainText('92/92');
      const requested = [...counts.values()].reduce((a, b) => a + b, 0) - before;
      const warmMs = Date.now() - start;
      expect(warmMs).toBeLessThan(2000);
      expect(requested).toBeLessThan(64);
      // The unchanged rule list must reuse every detail, rather than start another full index.
      expect(
        [...counts]
          .filter(([path]) => path.includes('/workflow_rules/'))
          .every(([, count]) => count === 1),
      ).toBe(true);
      await expect(pill).toHaveText('Indexed · 6 gaps · refreshing…');
      const query = page.getByRole('combobox', { name: 'Search workflow rules' });
      for (const [scope, term] of [
        ['code', 'synthetic_1_0_'],
        ['actions', 'Synthetic orchard notification'],
        ['actions', 'Resource-only marigold'],
      ]) {
        await page.locator(`[data-scope="${scope}"]`).click();
        await query.fill(term);
        await expect(page.locator('#wf-results [role="option"]').first()).toBeVisible({
          timeout: 2000,
        });
        if (scope === 'code')
          await expect(page.locator('#wf-results [role="option"]')).toHaveCount(2);
        await expect(page.getByText('Indexing is still running.', { exact: false })).toHaveCount(0);
      }
      await query.fill('');
      await page.locator('[data-scope="all"]').click();
      releaseWarm();
      warmBarrier = null;
      await expect(pill).not.toContainText('refreshing', { timeout: 30000 });
      for (const [path, count] of counts)
        if (/\/settings\/functions\/5\d+/.test(path))
          expect(count).toBe(reload && /\/500[1-4]$/.test(path) ? 2 : 1);
      console.log({ reload, warmMs, requested });
    }
    // Same graph: 6 durable gaps + 4 retryable failures = 10, then back to 6.
    await expect(pill).toHaveText('Indexed · 10 gaps', { timeout: 30_000 });
    await pill.click();
    await expect(page.locator('#wf-coverage')).toContainText('4 failed to load (retryable)');
    failSources = false;
    await page.locator('[data-act="retry-all"]').click();
    await expect(pill).toHaveText('Indexed · 6 gaps');
    await expect(page.locator('#wf-coverage')).toContainText('5 uncertain (matched by name only)');
    await expect(page.locator('#wf-coverage')).toContainText('1 unavailable');
    expect(logs.filter((line) => line.includes(' error: '))).toEqual(
      Array(4).fill(
        'content error: Failed to load resource: the server responded with a status of 403 (Forbidden)',
      ),
    );
    expect(
      logs.filter((l) => /workflow cache .*failed|pageerror|Illegal invocation/.test(l)),
    ).toEqual([]);
  } finally {
    releaseWarm();
    console.log(logs);
    await context.close();
  }
});
