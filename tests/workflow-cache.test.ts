import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWorkflowCache } from '../src/background/workflow-cache';
import { normalizeRule } from '../src/content/workflows/normalize';
import { browser, isOwnSender, registerWorkerMessages } from '../src/shared/browser';
import { isWorkflowCacheMessage, workflowCacheKey } from '../src/shared/workflow-cache-protocol';
import { context, summary } from './fixtures/workflows';

vi.mock('../src/shared/browser', () => ({
  registerWorkerMessages: vi.fn(),
  isOwnSender: vi.fn(),
  browser: { storage: { local: { get: vi.fn(), set: vi.fn() } } },
}));
const cache = () => ({
  version: 1 as const,
  savedAt: Date.now(),
  rules: [normalizeRule(summary())],
});
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.stubEnv('MODE', 'development');
  vi.mocked(registerWorkerMessages).mockClear();
  vi.mocked(isOwnSender).mockReturnValue(true);
});
describe('workflow cache boundary', () => {
  it('allows exact envelopes and supported origins only', () => {
    const m = { type: 'workflows:readCache', origin: context.origin, orgId: context.orgId };
    expect(isWorkflowCacheMessage(m)).toBe(true);
    for (const invalid of [
      { ...m, key: 'billingSession' },
      { ...m, origin: 'https://evil.invalid' },
      { ...m, origin: `${context.origin}:8443` },
      { ...m, orgId: '../billingSession' },
      { ...m, origin: `${context.origin}/x` },
    ])
      expect(isWorkflowCacheMessage(invalid)).toBe(false);
    expect(isWorkflowCacheMessage({ ...m, type: 'workflows:writeCache', value: cache() })).toBe(
      true,
    );
    expect(
      isWorkflowCacheMessage({
        ...m,
        type: 'workflows:writeCache',
        value: { ...cache(), version: 99 },
      }),
    ).toBe(false);
  });
  it('isolates origin and org and rejects other senders', async () => {
    const data: Record<string, unknown> = {};
    vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...data }));
    vi.mocked(browser.storage.local.set).mockImplementation(async (value) => {
      Object.assign(data, value);
    });
    registerWorkflowCache(Promise.resolve());
    const listener = vi.mocked(registerWorkerMessages).mock.calls[0][0];
    const send = (m: unknown) =>
      new Promise<unknown>((resolve) => {
        expect(listener(m, {}, resolve)).toBe(true);
      });
    const message = {
      type: 'workflows:writeCache',
      origin: context.origin,
      orgId: context.orgId,
      value: cache(),
    };
    await send(message);
    expect(
      await send({ type: 'workflows:readCache', origin: context.origin, orgId: context.orgId }),
    ).toMatchObject({ ok: true, value: { version: 1 } });
    for (const identity of [
      { origin: 'https://crm.zoho.eu', orgId: context.orgId },
      { origin: context.origin, orgId: '999002' },
    ])
      expect(await send({ type: 'workflows:readCache', ...identity })).toEqual({
        ok: true,
        value: null,
      });
    expect(workflowCacheKey(context.origin, context.orgId)).not.toBe(
      workflowCacheKey('https://crm.zoho.eu', context.orgId),
    );
    vi.mocked(isOwnSender).mockReturnValue(false);
    expect(listener(message, {}, vi.fn())).toBe(false);
  });
});

it('evicts oldest partitions and rejects oversized snapshots', async () => {
  const data: Record<string, unknown> = {};
  vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...data }));
  vi.mocked(browser.storage.local.set).mockImplementation(async (value) => {
    Object.assign(data, value);
  });
  registerWorkflowCache(Promise.resolve());
  const listener = vi.mocked(registerWorkerMessages).mock.calls[0][0];
  const send = (m: unknown) =>
    new Promise<unknown>((resolve) => {
      listener(m, {}, resolve);
    });
  for (let i = 1; i <= 4; i++)
    await send({
      type: 'workflows:writeCache',
      origin: context.origin,
      orgId: String(i),
      value: { ...cache(), savedAt: i },
    });
  expect(await send({ type: 'workflows:readCache', origin: context.origin, orgId: '1' })).toEqual({
    ok: true,
    value: null,
  });
  expect(
    await send({ type: 'workflows:readCache', origin: context.origin, orgId: '4' }),
  ).toMatchObject({ ok: true, value: { savedAt: 4 } });
  const oversized = cache();
  oversized.rules[0].description = 'x'.repeat(32_000_001);
  expect(
    isWorkflowCacheMessage({
      type: 'workflows:writeCache',
      origin: context.origin,
      orgId: '4',
      value: oversized,
    }),
  ).toBe(false);
});

it('never reads storage if trusted-storage initialization fails, even on a later message', async () => {
  vi.mocked(browser.storage.local.get).mockClear();
  registerWorkflowCache(Promise.reject(new Error('initialization failed')));
  const listener = vi.mocked(registerWorkerMessages).mock.calls[0][0];
  const message = { type: 'workflows:readCache', origin: context.origin, orgId: context.orgId };
  for (let i = 0; i < 2; i++) {
    const reply = await new Promise<unknown>((resolve) => {
      listener(message, {}, resolve);
    });
    expect(reply).toEqual({ ok: false, error: 'Workflow cache unavailable' });
  }
  expect(browser.storage.local.get).not.toHaveBeenCalled();
});

it('fits a full large index by storing shared source and templates only once', () => {
  const source = 'info "synthetic fruit";\n'.repeat(800);
  const shared = normalizeRule(summary());
  const legacy = {
    version: 1,
    savedAt: Date.now(),
    rules: Array.from({ length: 327 }, (_, i) => ({
      ...shared,
      id: String(i + 1000),
      raw: { ...summary(String(i + 1000)), source },
    })),
  };
  const compact = {
    version: 2,
    savedAt: Date.now(),
    summaries: legacy.rules.map((r) => ({ ...r.raw, source: undefined })),
    details: [],
    resources: [],
    templates: [],
    fields: [],
    catalogue: null,
    sources: [['501', source]],
  };
  const envelope = { type: 'workflows:writeCache', origin: context.origin, orgId: context.orgId };
  expect(JSON.stringify(legacy).length).toBeGreaterThan(3_000_000);
  expect(isWorkflowCacheMessage({ ...envelope, value: compact })).toBe(true);
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(legacy).length / 10);
});

it('persists 206 distinct sources and 92 templates across worker restart within the existing budget', async () => {
  const { packWorkflowCache, unpackWorkflowCache } = await import(
    '../src/shared/workflow-cache-codec'
  );
  const graph = {
    version: 2 as const,
    savedAt: Date.now(),
    summaries: Array.from({ length: 327 }, (_, i) => summary(String(1000 + i))),
    details: Array.from({ length: 327 }, (_, i): [string, unknown] => [
      String(1000 + i),
      {
        id: String(1000 + i),
        conditions: [{ sequence_number: 1, instant_actions: [] }],
      },
    ]),
    resources: [],
    fields: [],
    catalogue: null,
    sources: Array.from({ length: 206 }, (_, i): [string, string] => [
      String(5000 + i),
      Array.from(
        { length: 650 },
        (_, j) =>
          `result_${j} = zoho.crm.getRecordById("Synthetic_Module_${i}", "${1000000 + i * 650 + j}");`,
      ).join('\n'),
    ]),
    templates: Array.from({ length: 92 }, (_, i): [string, unknown] => [
      String(8000 + i),
      {
        id: String(8000 + i),
        content: Array.from(
          { length: 100 },
          (_, j) =>
            `<p>Synthetic notification ${i}, item ${j}: &nbsp; Please review the orchard details.</p>`,
        ).join(''),
      },
    ]),
  };
  const rawBytes = new TextEncoder().encode(JSON.stringify(graph)).length;
  const packed = await packWorkflowCache(graph);
  const storedBytes = new TextEncoder().encode(JSON.stringify(packed)).length;
  console.info(`Synthetic workflow cache: raw=${rawBytes} bytes; gzip/base64=${storedBytes} bytes`);
  expect(rawBytes).toBeGreaterThan(10 * 1024 * 1024);
  expect(storedBytes).toBeLessThan(3_000_000);
  expect(await unpackWorkflowCache(packed)).toEqual(graph);
  const data: Record<string, unknown> = {};
  vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...data }));
  vi.mocked(browser.storage.local.set).mockImplementation(async (value) => {
    if (JSON.stringify(value).length > 6_000_000) throw new Error('QUOTA_BYTES');
    Object.assign(data, JSON.parse(JSON.stringify(value)));
  });
  registerWorkflowCache(Promise.resolve());
  const send = (m: unknown) =>
    new Promise<unknown>((resolve) => {
      vi.mocked(registerWorkerMessages).mock.calls.at(-1)?.[0](m, {}, resolve);
    });
  const identity = { origin: context.origin, orgId: context.orgId };
  expect(await send({ type: 'workflows:writeCache', ...identity, value: packed })).toEqual({
    ok: true,
    value: null,
  });
  registerWorkflowCache(Promise.resolve());
  expect(await send({ type: 'workflows:readCache', ...identity })).toEqual({
    ok: true,
    value: graph,
  });
  vi.mocked(browser.storage.local.set).mockRejectedValueOnce(new Error('QUOTA_BYTES'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(await send({ type: 'workflows:writeCache', ...identity, value: packed })).toEqual({
    ok: false,
    error: 'Workflow cache unavailable',
  });
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('cache operation failed'),
    expect.any(Error),
  );
  warn.mockRestore();
  expect(await send({ type: 'workflows:readCache', ...identity })).toEqual({
    ok: true,
    value: graph,
  });
});
