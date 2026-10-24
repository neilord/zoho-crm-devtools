// @ts-nocheck -- profiling tool (not CI): uses node:fs and raw CDP tracing events the repo tsconfig has no types for.
// Reusable Automation Map performance profiler (packaged extension, real Chromium).
// Not part of CI: it only runs through playwright.automation-map-perf.config.ts.
//
//   VITE_AUTOMATION_MAP_UNLOCK=true VITE_WORKFLOW_SEARCH_UNLOCK=true npm run build:dev
//   VITE_AUTOMATION_MAP_UNLOCK=true VITE_AUTOMATION_MAP_FORCE_TEASER=true \
//     VITE_WORKFLOW_SEARCH_UNLOCK=true npx vite build --mode development --outDir dist-dev/teaser
//   AM_PERF_OUT=<dir> [AM_PERF_RULES=330 AM_PERF_FUNCTIONS=500 AM_PERF_MODULES=150 \
//     AM_PERF_RULE_MODULES=60] npx playwright test --config playwright.automation-map-perf.config.ts \
//     [-g "open:|gestures|interactions|teaser|leaks"]
//
// Each scenario appends a JSON line to $AM_PERF_OUT/<label>.jsonl (label = AM_PERF_LABEL or
// "rules<N>"). Numbers come from CDP Performance.getMetrics deltas, in-page rAF frame deltas,
// PerformanceObserver longtasks and (for gestures/fog) a Tracing summary. Headless Chromium uses
// software raster, so absolute raster/paint numbers are inflated; compare before/after, not to 60fps.
import { appendFileSync, mkdirSync } from 'node:fs';
import {
  type BrowserContext,
  type CDPSession,
  chromium,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { settingsHtml, workflowsHtml } from '../fixtures/automation-map-zoho';
import { largeOrgResponse } from '../fixtures/automation-map-zoho-scaled';

declare const process: { env: Record<string, string | undefined> };
const OUT = process.env.AM_PERF_OUT ?? 'test-results/automation-map-perf';
const LABEL = process.env.AM_PERF_LABEL ?? `rules${process.env.AM_PERF_RULES ?? 25}`;
const RULES = Number(process.env.AM_PERF_RULES ?? 25);
const host = '#zcdt-automation-map-overlay';
const setupUrl = 'https://crm.zoho.com/crm/org123/settings/index';
mkdirSync(OUT, { recursive: true });
const record = (scenario: string, data: unknown) => {
  const line = JSON.stringify({ label: LABEL, scenario, ...(data as object) });
  appendFileSync(`${OUT}/${LABEL}.jsonl`, `${line}\n`);
  console.log(line);
};

type PW = {
  long: Array<[number, number]>;
  t0: number;
  watch: (s: unknown) => Promise<Record<string, number>>;
  deepCount: () => number;
  root: () => ShadowRoot;
  frameTimes: (ms: number) => Promise<number[]>;
  drive: (k: string, n: number) => Promise<{ deltas: number[]; handler: number[] }>;
};
// Typed accessor for the in-page helpers installed by INIT.
const P = () => (window as never as { __p: PW }).__p;

// ---- in-page instrumentation (main world; the overlay's shadow root is open) ----
const INIT = `
(() => {
  window.P = () => window.__p; // page-side twin of the typed P() below, used inside evaluate()
  const P = (window.__p = { long: [], frames: [], t0: 0 });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push([e.startTime, e.duration]); })
      .observe({ type: 'longtask', buffered: true });
  } catch {}
  const root = () => document.querySelector('#zcdt-automation-map-overlay')?.shadowRoot ?? null;
  P.root = root;
  P.watch = (sels) => new Promise((res) => {
    const seen = {};
    const tick = () => {
      const r = root();
      const now = performance.now();
      if (r) for (const [k, s] of Object.entries(sels)) {
        if (seen[k] !== undefined) continue;
        if (s === 'host') { seen[k] = now - P.t0; continue; }
        if (s.startsWith('text:')) { const [sel, t] = s.slice(5).split('|'); const el = r.querySelector(sel); if (el && el.textContent.includes(t)) seen[k] = now - P.t0; }
        else if (r.querySelector(s)) seen[k] = now - P.t0;
      }
      if (Object.keys(seen).length === Object.keys(sels).length || now - P.t0 > 25000) res(seen);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  P.deepCount = () => {
    let n = 0;
    const walk = (node) => { for (const c of node.children) { n++; walk(c); } };
    const r = root(); if (r) walk(r);
    return n;
  };
  P.frameTimes = (ms) => new Promise((res) => {
    const d = []; let last = performance.now(); const end = last + ms;
    const tick = (t) => { d.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else res(d); };
    requestAnimationFrame(tick);
  });
  // One synthetic event per animation frame on the board canvas; returns rAF deltas and the
  // synchronous dispatch cost (handler time, excluding the frame's style/layout/paint).
  P.drive = (kind, n) => new Promise((res) => {
    const r = root();
    const cv = r.querySelector('.amc-canvas');
    const b = cv.getBoundingClientRect();
    const cx = b.left + b.width * 0.5, cy = b.top + b.height * 0.55;
    const deltas = [], handler = []; let last = performance.now(), i = 0;
    const fire = () => {
      const t = performance.now();
      const phase = Math.floor(i / (n / 4)) % 2 ? -1 : 1;
      if (kind === 'wheel-pan') cv.dispatchEvent(new WheelEvent('wheel', { deltaX: 6 * phase, deltaY: 9 * phase, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
      else if (kind === 'wheel-zoom') cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -7 * phase, ctrlKey: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
      else if (kind === 'drag') {
        const x = cx + Math.sin(i / 12) * 160, y = cy + Math.cos(i / 15) * 90;
        const mk = (type) => new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
        if (i === 0) cv.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, clientX: cx, clientY: cy, button: 0, bubbles: true }));
        cv.dispatchEvent(mk('pointermove'));
      }
      handler.push(performance.now() - t);
    };
    const tick = (t) => {
      deltas.push(t - last); last = t;
      if (i < n) { fire(); i++; requestAnimationFrame(tick); }
      else {
        if (kind === 'drag') cv.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true }));
        res({ deltas, handler });
      }
    };
    requestAnimationFrame(tick);
  });
})();
`;

const stats = (xs: number[]) => {
  if (!xs.length) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const sum = xs.reduce((a, b) => a + b, 0);
  return {
    n: xs.length,
    mean: +(sum / xs.length).toFixed(2),
    p50: +q(0.5).toFixed(2),
    p95: +q(0.95).toFixed(2),
    max: +s[s.length - 1].toFixed(2),
  };
};
const round = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(3)]));

const METRICS = [
  'LayoutCount',
  'RecalcStyleCount',
  'LayoutDuration',
  'RecalcStyleDuration',
  'ScriptDuration',
  'TaskDuration',
  'Nodes',
  'JSEventListeners',
  'JSHeapUsedSize',
  'LayoutObjects',
];
async function metrics(cdp: CDPSession) {
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  const out: Record<string, number> = {};
  for (const x of m) if (METRICS.includes(x.name)) out[x.name] = x.value;
  return out;
}
const diff = (a: Record<string, number>, b: Record<string, number>) => {
  const o: Record<string, number> = {};
  for (const k of METRICS) o[k] = (b[k] ?? 0) - (a[k] ?? 0);
  // Durations are seconds in CDP; report ms.
  for (const k of ['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration'])
    o[k] *= 1000;
  return round(o);
};

interface TraceEvent {
  name: string;
  ph: string;
  dur?: number;
}
const TRACE_NAMES = [
  'UpdateLayoutTree',
  'Layout',
  'PrePaint',
  'Paint',
  'Layerize',
  'Commit',
  'RasterTask',
  'CompositeLayers',
  'FunctionCall',
  'FireAnimationFrame',
  'HitTest',
  'UpdateLayer',
];
async function traced<T>(cdp: CDPSession, fn: () => Promise<T>) {
  const events: TraceEvent[] = [];
  const onData = (e: { value: TraceEvent[] }) => events.push(...e.value);
  cdp.on('Tracing.dataCollected', onData);
  const complete = new Promise<void>((res) => cdp.once('Tracing.tracingComplete', () => res()));
  await cdp.send('Tracing.start', {
    traceConfig: { includedCategories: ['devtools.timeline', 'cc', 'gpu', 'viz', 'blink'] },
    transferMode: 'ReportEvents',
  } as never);
  const value = await fn();
  await cdp.send('Tracing.end');
  await complete;
  cdp.off('Tracing.dataCollected', onData);
  const sum: Record<string, { n: number; ms: number }> = {};
  for (const e of events) {
    if (!TRACE_NAMES.includes(e.name) || e.ph !== 'X') continue;
    sum[e.name] ??= { n: 0, ms: 0 };
    const s = sum[e.name];
    s.n++;
    s.ms += (e.dur ?? 0) / 1000;
  }
  for (const s of Object.values(sum)) s.ms = +s.ms.toFixed(2);
  return { value, trace: sum };
}

interface CpuNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount?: number;
}
/** Sampling CPU profile of `fn`; returns the top self-time functions (ms). */
async function profiled<T>(cdp: CDPSession, fn: () => Promise<T>, top = 14) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const value = await fn();
  const { profile } = (await cdp.send('Profiler.stop')) as unknown as {
    profile: { nodes: CpuNode[]; samples: number[]; timeDeltas: number[] };
  };
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map<string, number>();
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    if (!n) return;
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  });
  const rows = [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([k, ms]) => `${ms.toFixed(1)}ms ${k}`);
  return { value, top: rows };
}

async function launch(teaser: boolean, width = 1440, height = 900) {
  const dist = new URL(teaser ? '../../dist-dev/teaser' : '../../dist-dev', import.meta.url)
    .pathname;
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    reducedMotion: 'no-preference',
    viewport: { width, height },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  await context.addInitScript(INIT);
  await context.route('https://crm.zoho.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/crm/org123/')) {
      await route.fulfill({
        contentType: 'text/html',
        body: url.pathname.endsWith('workflow-rules') ? workflowsHtml : settingsHtml,
      });
      return;
    }
    const response = url.pathname === '/favicon.ico' ? { status: 204 } : largeOrgResponse(url);
    if (!response) return route.fulfill({ status: 404 });
    await route.fulfill({
      status: response.status ?? 200,
      contentType: 'application/json',
      ...(response.status === 204 || response.status === 404
        ? {}
        : { body: response.raw ?? JSON.stringify(response.body) }),
    });
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  return { context, page, cdp };
}

const OPEN_MARKS = (teaser: boolean) => ({
  host: 'host',
  head: '.am-head',
  rail: '.ritem, .opt',
  content: '[data-fk="coverage-pill"], [data-island], [role="treegrid"] [role="row"]',
  complete: `text:.footstatus|${teaser ? 'Preview' : `${RULES} rules`}`,
});

async function dismissPromo(page: Page) {
  const later = page.getByRole('button', { name: 'Remind me later' });
  if (
    await later.waitFor({ timeout: 4000 }).then(
      () => true,
      () => false,
    )
  )
    await later.click();
}

/** Clicks the entry; returns time marks (ms from click), long tasks and metric deltas. */
async function open(page: Page, cdp: CDPSession, teaser: boolean) {
  await page.evaluate(() => {
    const p = P();
    p.long = [];
    p.t0 = performance.now();
  });
  const before = await metrics(cdp);
  const marks = page.evaluate((sels) => P().watch(sels), OPEN_MARKS(teaser));
  await page.locator('[data-zcdt-map-entry="home"] a').click();
  const seen = await marks;
  const after = await metrics(cdp);
  const { long, t0, nodes } = await page.evaluate(() => ({
    long: P().long,
    t0: P().t0,
    nodes: P().deepCount(),
  }));
  const lt = long.map(([s, d]) => ({ at: +(s - t0).toFixed(0), ms: +d.toFixed(0) }));
  return {
    marksMs: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, +v.toFixed(0)])),
    longTasks: lt,
    longTaskTotalMs: lt.reduce((a, b) => a + b.ms, 0),
    delta: diff(before, after),
    overlayNodes: nodes,
  };
}

const view = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
const pct = async (page: Page) =>
  Number.parseInt(await page.locator(`${host} .amc-pct`).innerText(), 10);
async function zoomNear(page: Page, target: number) {
  for (let i = 0; i < 40; i++) {
    const now = await pct(page);
    const dir = now < target ? 'Zoom in (+)' : 'Zoom out (−)';
    const next = Math.round(now * (now < target ? 1.25 : 0.8));
    if (Math.abs(Math.log(next / target)) >= Math.abs(Math.log(now / target))) break;
    await page.locator(`${host} [aria-label="${dir}"]`).click();
  }
  const now = await pct(page);
  const box = await page.locator(`${host} .amc-canvas`).first().boundingBox();
  if (box && now !== target) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -Math.log(target / now) / 0.0015);
    await page.keyboard.up('Control');
  }
  await page.waitForTimeout(600);
  return pct(page);
}
const settle = (page: Page) => page.waitForTimeout(600);
const ready = (page: Page) =>
  expect(page.locator(`${host} .footstatus`)).toContainText(`${RULES} rules`, { timeout: 90_000 });
const overlayNodes = (page: Page) => page.evaluate(() => P().deepCount());

async function closeMap(page: Page) {
  await page.locator(`${host} [data-act="close"]`).click();
  await expect(page.locator(host)).toHaveCount(0, { timeout: 5000 });
  await page.waitForTimeout(500);
}

async function close(context: BrowserContext) {
  await context.close().catch(() => {});
}

test.describe.configure({ mode: 'serial' });

test('open: cold, warm (same page), warm (reload, cached)', async () => {
  test.setTimeout(240_000);
  const { context, page, cdp } = await launch(false);
  try {
    await page.goto(setupUrl);
    const cold = await open(page, cdp, false);
    record('open-cold', cold);
    await ready(page);
    await dismissPromo(page);
    await closeMap(page);
    const warm = await open(page, cdp, false);
    record('open-warm-same-page', warm);
    await closeMap(page);
    await page.reload();
    const reloaded = await open(page, cdp, false);
    record('open-warm-after-reload', reloaded);
  } finally {
    await close(context);
  }
});

test('gestures: pan and zoom on the board', async () => {
  test.setTimeout(300_000);
  const { context, page, cdp } = await launch(false);
  try {
    await page.goto(setupUrl);
    await page.locator('[data-zcdt-map-entry="home"] a').click();
    await ready(page);
    await dismissPromo(page);
    await view(page, 'Board');
    await expect(page.locator(`${host} [data-island]`).first()).toBeAttached();
    await settle(page);
    for (const target of [0, 32, 60, 100]) {
      const z = target ? await zoomNear(page, target) : await pct(page);
      for (const kind of ['wheel-pan', 'wheel-zoom', 'drag']) {
        const before = await metrics(cdp);
        const { value, trace } = await traced(cdp, () =>
          page.evaluate((k) => P().drive(k, 120), kind),
        );
        const after = await metrics(cdp);
        const frames = value.deltas.slice(2);
        record(`gesture-${kind}`, {
          zoomPct: z,
          label: target ? `${target}%` : 'fit',
          frameMs: stats(frames),
          over25ms: frames.filter((d) => d > 25).length,
          over50ms: frames.filter((d) => d > 50).length,
          handlerMs: stats(value.handler),
          perFrame: Object.fromEntries(
            Object.entries(diff(before, after)).map(([k, v]) => [
              k,
              +(v / Math.max(1, frames.length)).toFixed(3),
            ]),
          ),
          trace,
          boardNodes: await overlayNodes(page),
        });
        await settle(page);
      }
    }
  } finally {
    await close(context);
  }
});

test('interactions: search, views, inspector, rail, hover', async () => {
  test.setTimeout(300_000);
  const { context, page, cdp } = await launch(false);
  try {
    await page.goto(setupUrl);
    await page.locator('[data-zcdt-map-entry="home"] a').click();
    await ready(page);
    await dismissPromo(page);
    const run = async (name: string, fn: () => Promise<void>, samples = 1) => {
      for (let i = 0; i < samples; i++) {
        await settle(page);
        await page.evaluate(() => {
          P().long = [];
        });
        const before = await metrics(cdp);
        const t = await page.evaluate(() => performance.now());
        await fn();
        // Two rAFs: the frame after the work has been produced.
        await page.evaluate(
          () =>
            new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
        );
        const t1 = await page.evaluate(() => performance.now());
        const after = await metrics(cdp);
        const long = await page.evaluate(() => P().long);
        record(name, {
          sample: i,
          wallMs: +(t1 - t).toFixed(0),
          delta: diff(before, after),
          longTasks: long.map(([, d]) => +d.toFixed(0)),
          overlayNodes: await overlayNodes(page),
        });
      }
    };

    // Per-view node counts and switching cost (fields is the default view).
    for (const v of ['Board', 'List', 'Fields', 'Board', 'List', 'Fields']) {
      await run(`switch-to-${v}`, async () => {
        await view(page, v);
      });
    }

    // Search typing per view: keystroke -> last DOM mutation of that keystroke's response.
    for (const v of ['Fields', 'List', 'Board']) {
      await view(page, v);
      await settle(page);
      const q = 'synthetic function 1';
      await page.evaluate(() => {
        const r = P().root();
        const w = window as never as { __lat: number[]; __flush: () => void };
        w.__lat = [];
        let t0 = 0;
        let last = 0;
        new MutationObserver(() => {
          last = performance.now();
        }).observe(r, { subtree: true, childList: true, attributes: true, characterData: true });
        r.addEventListener(
          'input',
          () => {
            if (t0 && last > t0) w.__lat.push(last - t0);
            t0 = performance.now();
            last = 0;
          },
          true,
        );
        w.__flush = () => {
          if (t0 && last > t0) w.__lat.push(last - t0);
        };
      });
      await page.getByRole('searchbox', { name: 'Search the map' }).click();
      await run(`search-type-${v}`, async () => {
        await page.keyboard.type(q, { delay: 90 });
        await page.waitForTimeout(700);
        await page.evaluate(() => (window as never as { __flush: () => void }).__flush());
      });
      const lat = await page.evaluate(() => (window as never as { __lat: number[] }).__lat);
      record(`search-latency-${v}`, { keystrokeToLastMutationMs: stats(lat), query: q });
      await page.keyboard.press('Control+A');
      await run(`search-clear-${v}`, async () => {
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(500);
      });
    }

    // Inspector open from a link (hash), then closed.
    await view(page, 'Board');
    await settle(page);
    await run('inspector-open', async () => {
      await page.evaluate(() => {
        location.hash = '#zcdt-map=v1;view=board;sel=rule:1001';
      });
      await expect(page.locator(`${host} .am-insp.open`)).toBeVisible();
    });
    await run('inspector-close', async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    });

    // Rail: toggle modules and scope.
    const filtersButton = page.getByRole('button', { name: /filters/i }).first();
    if (await filtersButton.isVisible().catch(() => false)) await filtersButton.click();
    await run(
      'rail-toggle-module',
      async () => {
        await page.locator(`${host} [data-fk="mod:Leads"]`).click();
      },
      2,
    );
    await page.locator(`${host} [data-fk="mod:Leads"]`).click();
    await run('rail-scope-everything', async () => {
      await page
        .getByRole('button', { name: /everything/i })
        .first()
        .click();
    });
    await run('rail-scope-active', async () => {
      await page
        .getByRole('button', { name: /^active/i })
        .first()
        .click();
    });

    // Island hover at overview zoom.
    await page.mouse.move(700, 4);
    await settle(page);
    const titles = page.locator(`${host} [data-island] .amc-ttl`);
    const nTitles = await titles.count();
    let hovered = 0;
    for (let i = 0; i < Math.min(nTitles, 40) && hovered < 6; i++) {
      const box = await titles.nth(i).boundingBox();
      if (!box || box.y < 140 || box.y > 800 || box.x > 1100) continue;
      hovered++;
      await run('island-hover', async () => {
        await titles
          .nth(i)
          .hover({ timeout: 3000 })
          .catch(() => {});
      });
    }
  } finally {
    await close(context);
  }
});

test('profile: CPU hot spots for the heavy interactions', async () => {
  test.setTimeout(300_000);
  const { context, page, cdp } = await launch(false);
  try {
    await page.goto(setupUrl);
    await page.locator('[data-zcdt-map-entry="home"] a').click();
    await ready(page);
    await dismissPromo(page);
    const prof = async (name: string, fn: () => Promise<void>) => {
      await settle(page);
      const { top } = await profiled(cdp, async () => {
        await fn();
        await page.waitForTimeout(400);
      });
      record(`profile-${name}`, { top });
    };
    await prof('switch-board', () => view(page, 'Board'));
    await expect(page.locator(`${host} [data-island]`).first()).toBeAttached();
    await settle(page);
    await zoomNear(page, 60);
    await prof('wheel-zoom-60', async () => {
      await page.evaluate(() => P().drive('wheel-zoom', 120));
    });
    await prof('drag-60', async () => {
      await page.evaluate(() => P().drive('drag', 120));
    });
    await zoomNear(page, 32);
    await prof('drag-32', async () => {
      await page.evaluate(() => P().drive('drag', 120));
    });
    await page.getByRole('searchbox', { name: 'Search the map' }).click();
    await prof('search-board', async () => {
      await page.keyboard.type('synthetic function 1', { delay: 90 });
    });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await zoomNear(page, 60);
    await prof('inspector-open-hash', async () => {
      await page.evaluate(() => {
        location.hash = '#zcdt-map=v1;view=board;sel=rule:1001';
      });
      await expect(page.locator(`${host} .am-insp.open`)).toBeVisible();
    });
    await prof('switch-list', () => view(page, 'List'));
    await prof('switch-fields', () => view(page, 'Fields'));
    await page.getByRole('searchbox', { name: 'Search the map' }).click();
    await prof('search-fields', async () => {
      await page.keyboard.type('synthetic function 1', { delay: 90 });
    });
  } finally {
    await close(context);
  }
});

test('micro: what each camera write costs (forced style+layout)', async () => {
  test.setTimeout(240_000);
  const { context, page } = await launch(false);
  try {
    await page.goto(setupUrl);
    await page.locator('[data-zcdt-map-entry="home"] a').click();
    await ready(page);
    await dismissPromo(page);
    await view(page, 'Board');
    await expect(page.locator(`${host} [data-island]`).first()).toBeAttached();
    await settle(page);
    for (const target of [0, 32, 60, 100]) {
      const z = target ? await zoomNear(page, target) : await pct(page);
      const r = await page.evaluate(() => {
        const root = P().root();
        const cv = root.querySelector('.amc-canvas') as HTMLElement;
        const world = root.querySelector('.amc-world') as HTMLElement;
        const time = (write: (i: number) => void) => {
          let total = 0;
          const n = 60;
          for (let i = 0; i < n; i++) {
            write(i);
            const t = performance.now();
            cv.getBoundingClientRect(); // forces style recalc + layout
            total += performance.now() - t;
          }
          return +(total / n).toFixed(3);
        };
        const z0 = cv.style.getPropertyValue('--z') || '1';
        const out = {
          nodesInCanvas: cv.querySelectorAll('*').length,
          zVar: time((i) =>
            cv.style.setProperty('--z', String(Number(z0) * (1 + (i % 2) * 0.001))),
          ),
          gridVars: time((i) => {
            cv.style.setProperty('--gx', `${i}px`);
            cv.style.setProperty('--gy', `${i}px`);
          }),
          worldTransformOnly: time((i) => {
            world.style.transform = `translate3d(${i}px, 0px, 0) scale(${z0})`;
          }),
          unrelatedVar: time((i) => cv.style.setProperty('--zz-unused', String(i))),
        };
        cv.style.setProperty('--z', z0);
        return out;
      });
      record('micro-camera-write', { label: target ? `${target}%` : 'fit', zoomPct: z, ...r });
    }
  } finally {
    await close(context);
  }
});

test('teaser: fog animation cost while idle', async () => {
  test.setTimeout(120_000);
  const { context, page, cdp } = await launch(true);
  try {
    await page.goto(setupUrl);
    await page.locator('[data-zcdt-map-entry="home"] a').click();
    await expect(page.locator(`${host} .footstatus`)).toContainText('Preview', {
      timeout: 30_000,
    });
    await dismissPromo(page);
    await view(page, 'Board');
    await expect(page.locator(`${host} .amc-fog`).first()).toBeVisible();
    await settle(page);
    const layers: number[] = [];
    await cdp.send('LayerTree.enable');
    cdp.on('LayerTree.layerTreeDidChange', (e: { layers?: unknown[] }) =>
      layers.push(e.layers?.length ?? 0),
    );
    await page.waitForTimeout(500);
    const idle = async (label: string) => {
      const before = await metrics(cdp);
      const { value: frames, trace } = await traced(cdp, () =>
        page.evaluate(() => P().frameTimes(4000)),
      );
      const after = await metrics(cdp);
      const fog = await page.evaluate(() => {
        const r = P().root();
        const clouds = [...r.querySelectorAll('.amc-cloud')];
        return {
          fogIslands: r.querySelectorAll('.amc-fog').length,
          clouds: clouds.length,
          runningAnimations: (r as unknown as Document).getAnimations?.().length ?? -1,
          willChange: clouds.filter((c) => getComputedStyle(c).willChange !== 'auto').length,
        };
      });
      record(`fog-idle-${label}`, {
        frameMs: stats(frames.slice(2)),
        delta: diff(before, after),
        trace,
        layerCountSamples: layers.slice(-5),
        ...fog,
      });
    };
    await idle('fit');
    await zoomNear(page, 60);
    await idle('60pct');
  } finally {
    await close(context);
  }
});

test('leaks: listeners and nodes across open/close cycles', async () => {
  test.setTimeout(300_000);
  const { context, page, cdp } = await launch(false);
  try {
    await page.goto(setupUrl);
    const snap = async (label: string) => {
      await cdp.send('HeapProfiler.collectGarbage');
      await page.waitForTimeout(300);
      record('leak-sample', { label, ...(await metrics(cdp)) });
    };
    await snap('baseline');
    for (let cycle = 1; cycle <= 6; cycle++) {
      await page.locator('[data-zcdt-map-entry="home"] a').click();
      await ready(page);
      if (cycle === 1) await dismissPromo(page);
      await view(page, 'Board');
      await settle(page);
      await view(page, 'List');
      await settle(page);
      await view(page, 'Fields');
      await closeMap(page);
      await snap(`after-close-${cycle}`);
    }
  } finally {
    await close(context);
  }
});
