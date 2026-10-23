import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AutomationMapCacheStorage,
  type CacheEntry,
  registerAutomationMapCache,
} from '../src/background/automation-map-cache';
import { analyzeDelugeEffects } from '../src/content/automation-map/analyzer';
import { cacheInputs, hydrateInputs } from '../src/content/automation-map/data/cache';
import { catalogueInput } from '../src/content/automation-map/data/zoho-api';
import { normalizeRule } from '../src/content/workflows/normalize';
import {
  AUTOMATION_MAP_BUCKET_LIMIT,
  AUTOMATION_MAP_CACHE_LIMIT,
  AUTOMATION_MAP_PACKED_LIMIT,
  automationMapCacheKey,
  isAutomationMapCache,
  isAutomationMapCacheMessage,
  packAutomationMapCache,
  unpackAutomationMapCache,
} from '../src/shared/automation-map-cache-protocol';
import { isOwnSender, registerWorkerMessages } from '../src/shared/browser';
import { catalogue, context, rule } from './automation-map-data-fixtures';

vi.mock('../src/shared/browser', () => ({ registerWorkerMessages: vi.fn(), isOwnSender: vi.fn() }));
function cache() {
  const sourceText =
      'm = Map(); m.put("Harvest", "ready"); zoho.crm.updateRecord("Orchards", 1, m);',
    f = catalogueInput(catalogue());
  return cacheInputs({
    modules: [{ apiName: 'Orchards', label: 'Orchard garden', pluralLabel: 'Orchard gardens' }],
    fields: new Map([['Orchards', [{ apiName: 'Harvest', label: 'Harvest status' }]]]),
    rules: [normalizeRule(rule(), { ...rule(), conditions: [] })],
    functions: [
      {
        ...f,
        sourceState: 'available',
        sourceText,
        effects: analyzeDelugeEffects(sourceText, {
          functionId: f.delugeId,
          sourceRevision: 'revision-1',
        }),
      },
    ],
    buttons: [],
    schedules: [],
    transitions: [],
    approvals: [],
  });
}
class MemoryStorage implements AutomationMapCacheStorage {
  entries: CacheEntry[] = [];
  async read() {
    return structuredClone(this.entries);
  }
  async replace(entries: CacheEntry[]) {
    this.entries = structuredClone(entries);
  }
}
beforeEach(() => {
  vi.mocked(registerWorkerMessages).mockClear();
  vi.mocked(isOwnSender).mockReturnValue(true);
});
function channel(storage = new MemoryStorage()) {
  registerAutomationMapCache(Promise.resolve(), storage);
  const listener = vi.mocked(registerWorkerMessages).mock.calls[0][0];
  const send = (message: unknown) =>
    new Promise<{ ok: boolean; value?: unknown }>((resolve) => {
      expect(listener(message, {}, resolve)).toBe(true);
    });
  return { storage, listener, send };
}
const message = { type: 'automationMap:readCache', origin: context.origin, orgId: context.orgId };

describe('Automation Map worker cache', () => {
  it('accepts exact origin/org envelopes, no arbitrary keys, foreign senders or unsupported origins', () => {
    expect(isAutomationMapCacheMessage(message)).toBe(true);
    for (const invalid of [
      { ...message, key: 'billingSession' },
      { ...message, origin: 'https://evil.invalid' },
      { ...message, origin: `${context.origin}/crm` },
      { ...message, origin: `${context.origin}:8443` },
      { ...message, orgId: '../tokens' },
      { ...message, type: 'automationMap:deleteCache' },
    ])
      expect(isAutomationMapCacheMessage(invalid)).toBe(false);
    expect(
      isAutomationMapCacheMessage({ ...message, type: 'automationMap:writeCache', value: cache() }),
    ).toBe(true);
    const { listener } = channel();
    vi.mocked(isOwnSender).mockReturnValue(false);
    expect(listener(message, {}, vi.fn())).toBe(false);
  });
  it('round trips compressed sources/effects/metadata and re-normalizes cached rules', async () => {
    const value = cache();
    expect(isAutomationMapCache(value)).toBe(true);
    const packed = await packAutomationMapCache(value);
    expect(packed.encoding).toBe('gzip-base64');
    expect(packed.data.length).toBeLessThan(JSON.stringify(value).length);
    expect(await unpackAutomationMapCache(packed)).toEqual(JSON.parse(JSON.stringify(value)));
    const decoded = await unpackAutomationMapCache(packed);
    if (!decoded) throw new Error('Expected valid cache');
    const inputs = hydrateInputs(decoded);
    expect(inputs.fields.get('Orchards')?.[0].label).toBe('Harvest status');
    expect(inputs.functions[0].effects?.writes).toHaveLength(1);
    expect(inputs.rules[0].detailState).toBe('loaded');
  });
  it('isolates origins and organizations and evicts oldest of more than three partitions', async () => {
    const { send, storage } = channel();
    for (let n = 1; n <= 4; n++)
      await send({
        ...message,
        orgId: String(n),
        type: 'automationMap:writeCache',
        value: { ...cache(), savedAt: n },
      });
    expect(storage.entries).toHaveLength(3);
    expect(storage.entries.map((e) => e.value.savedAt)).toEqual([4, 3, 2]);
    expect(await send({ ...message, orgId: '1' })).toEqual({ ok: true, value: null });
    expect(await send({ ...message, orgId: '4', origin: 'https://crm.zoho.eu' })).toEqual({
      ok: true,
      value: null,
    });
    const reply = await send({ ...message, orgId: '4' });
    expect(reply.ok).toBe(true);
    expect(await unpackAutomationMapCache(reply.value)).toHaveProperty('savedAt', 4);
    expect(automationMapCacheKey(context.origin, '4')).not.toBe(
      automationMapCacheKey('https://crm.zoho.eu', '4'),
    );
    expect(new TextEncoder().encode(JSON.stringify(storage.entries)).length).toBeLessThan(
      AUTOMATION_MAP_BUCKET_LIMIT,
    );
  });
  it('validates nested inputs and independent compressed/decoded bounds', async () => {
    for (const mutate of [
      (v: ReturnType<typeof cache>) => {
        v.version = 99 as 1;
      },
      (v: ReturnType<typeof cache>) => {
        v.inputs.functions[0].places = [
          { type: 'rules', id: 19 as unknown as string, modulePluralLabel: null, raw: null },
        ];
      },
      (v: ReturnType<typeof cache>) => {
        const effects = v.inputs.functions[0].effects;
        if (effects) effects.writes[0].fields = null as never;
      },
      (v: ReturnType<typeof cache>) => {
        v.inputs.modules[0].apiName = 12 as never;
      },
      (v: ReturnType<typeof cache>) => {
        v.inputs.rules[0].conditions = null as never;
      },
    ]) {
      const value = cache();
      mutate(value);
      expect(isAutomationMapCache(value)).toBe(false);
    }
    const oversized = cache();
    oversized.inputs.functions[0].sourceText = 'x'.repeat(AUTOMATION_MAP_CACHE_LIMIT);
    expect(isAutomationMapCache(oversized)).toBe(false);
    await expect(packAutomationMapCache(oversized)).rejects.toThrow();
    expect(
      await unpackAutomationMapCache({
        encoding: 'gzip-base64',
        savedAt: 1,
        data: 'A'.repeat(AUTOMATION_MAP_PACKED_LIMIT + 4),
      }),
    ).toBeNull();
    expect(await unpackAutomationMapCache({ ...cache(), version: 99 })).toBeNull();
  });
  it('reports storage failures without poisoning subsequent serialized operations', async () => {
    const storage = new MemoryStorage();
    let fail = true;
    vi.spyOn(storage, 'replace').mockImplementation(async (entries) => {
      if (fail) throw new Error('quota');
      storage.entries = entries;
    });
    const { send } = channel(storage),
      write = { ...message, type: 'automationMap:writeCache', value: cache() };
    expect(await send(write)).toMatchObject({ ok: false });
    expect(storage.entries).toEqual([]);
    fail = false;
    expect(await send(write)).toEqual({ ok: true, value: null });
    expect((await send(message)).ok).toBe(true);
  });
  it('rejects corrupt gzip and ignores corrupted older partitions on write', async () => {
    const storage = new MemoryStorage();
    storage.entries = [
      { key: 'corrupt', value: { encoding: 'gzip-base64', savedAt: 99, data: 'AAAA' } },
    ];
    const { send } = channel(storage);
    expect(await send({ ...message, type: 'automationMap:writeCache', value: cache() })).toEqual({
      ok: true,
      value: null,
    });
    expect(storage.entries).toHaveLength(1);
    await expect(
      unpackAutomationMapCache({ encoding: 'gzip-base64', savedAt: 1, data: 'AAAA' }),
    ).rejects.toThrow();
  });
});

it('roundtrips optional freshness metadata and rejects invalid outcomes or timestamps', async () => {
  const original = cache();
  const category = { loaded: 1, failed: 0, unsupported: 0, state: 'loaded' as const };
  const revalidation = {
    lastRevalidatedAt: original.savedAt,
    categories: {
      buttons: category,
      schedules: category,
      blueprints: category,
      approvals: category,
    },
    failureIds: [],
  };
  const value = { ...original, revalidation };
  expect(await unpackAutomationMapCache(await packAutomationMapCache(value))).toEqual(value);
  expect(isAutomationMapCache(original)).toBe(true);
  expect(
    isAutomationMapCache({
      ...value,
      revalidation: { ...revalidation, lastRevalidatedAt: original.savedAt + 1 },
    }),
  ).toBe(false);
  expect(
    isAutomationMapCache({
      ...value,
      revalidation: {
        ...revalidation,
        categories: { ...revalidation.categories, buttons: { ...category, loaded: -1 } },
      },
    }),
  ).toBe(false);
});

it('validates bounded retry parent identities and per-dependency outcomes', async () => {
  const category = { loaded: 0, failed: 1, state: 'failed' as const };
  const value = {
    ...cache(),
    revalidation: {
      lastRevalidatedAt: null,
      categories: {
        buttons: category,
        schedules: category,
        blueprints: category,
        approvals: category,
      },
      failureIds: ['approvals:process:901'],
      dependencies: [
        {
          id: 'approvals:process:901',
          state: 'failed' as const,
          parent: {
            id: '901',
            name: 'Review',
            active: true,
            module: { api_name: 'Orchards' },
            field: { api_name: '' },
          },
        },
      ],
    },
  };
  expect(await unpackAutomationMapCache(await packAutomationMapCache(value))).toEqual(value);
  for (const parent of [
    { ...value.revalidation.dependencies[0].parent, id: '../901' },
    { ...value.revalidation.dependencies[0].parent, name: 'x'.repeat(1025) },
    { ...value.revalidation.dependencies[0].parent, active: 'true' },
    { ...value.revalidation.dependencies[0].parent, extra: true },
    { ...value.revalidation.dependencies[0].parent, module: { api_name: 'x'.repeat(257) } },
  ]) {
    expect(
      isAutomationMapCache({
        ...value,
        revalidation: {
          ...value.revalidation,
          dependencies: [{ ...value.revalidation.dependencies[0], parent }],
        },
      }),
    ).toBe(false);
  }
  expect(
    isAutomationMapCache({
      ...value,
      revalidation: {
        ...value.revalidation,
        dependencies: Array(10_001).fill(value.revalidation.dependencies[0]),
      },
    }),
  ).toBe(false);
});
