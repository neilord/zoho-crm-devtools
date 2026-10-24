import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  sync: {} as Record<string, unknown>,
  listeners: [] as Array<(value: unknown) => void>,
}));
const settings = vi.hoisted(() => ({ enabled: true }));
const crm = vi.hoisted(() => ({
  context: { origin: 'https://crm.zoho.eu', orgId: '123' } as unknown,
}));

vi.mock('../src/shared/browser', () => ({
  browser: {
    storage: {
      sync: {
        get: async (keys: string[]) =>
          Object.fromEntries(keys.filter((k) => k in store.sync).map((k) => [k, store.sync[k]])),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store.sync, items);
        },
      },
    },
  },
  onSyncStorageKeyChanged: (_key: string, listener: (value: unknown) => void) => {
    store.listeners.push(listener);
    return () => {};
  },
}));
vi.mock('../src/settings/storage', () => ({
  loadSettings: async () => ({ enabled: settings.enabled }),
}));
vi.mock('../src/content/zoho/crm-context', () => ({ resolveCrmContext: () => crm.context }));

import { bootstrapAiAssistantPromo } from '../src/content/promo/bootstrap';
import { PROMO_HOST_ID } from '../src/content/promo/card';
import { bootstrapWhatsNew } from '../src/content/promo/whats-new-bootstrap';
import { WHATS_NEW_HOST_ID } from '../src/content/promo/whats-new-card';
import { WHATS_NEW_STATE_KEY } from '../src/content/promo/whats-new-storage';

const flush = () => vi.advanceTimersByTimeAsync(3_000);
const present = (id: string) => document.getElementById(id) !== null;

describe('whats new coordination', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.sync = {};
    store.listeners = [];
    settings.enabled = true;
    crm.context = { origin: 'https://crm.zoho.eu', orgId: '123' };
  });

  afterEach(() => {
    document.getElementById(WHATS_NEW_HOST_ID)?.remove();
    document.getElementById(PROMO_HOST_ID)?.remove();
    vi.useRealTimers();
  });

  it('shows the announcement after three seconds and holds the AI promo back without an impression', async () => {
    await bootstrapWhatsNew();
    await bootstrapAiAssistantPromo();
    expect(present(WHATS_NEW_HOST_ID)).toBe(false);
    await flush();
    expect(present(WHATS_NEW_HOST_ID)).toBe(true);
    expect(present(PROMO_HOST_ID)).toBe(false);
    expect(store.sync.promoAiAssistant).toBeUndefined();
  });

  it('persists the acknowledgement, then lets the AI promo follow its own schedule', async () => {
    await bootstrapWhatsNew();
    await flush();
    (
      document
        .getElementById(WHATS_NEW_HOST_ID)
        ?.shadowRoot?.querySelector('.wn-ghost') as HTMLElement
    ).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.sync[WHATS_NEW_STATE_KEY]).toEqual({ version: 1, acknowledged: true });

    await bootstrapWhatsNew();
    await bootstrapAiAssistantPromo();
    await flush();
    expect(present(WHATS_NEW_HOST_ID)).toBe(false);
    expect(present(PROMO_HOST_ID)).toBe(true);
    expect(store.sync.promoAiAssistant).toMatchObject({ shownCount: 1 });
  });

  it('removes the card when another tab acknowledges', async () => {
    await bootstrapWhatsNew();
    await flush();
    for (const listener of store.listeners) {
      listener({ version: 1, acknowledged: true });
    }
    expect(present(WHATS_NEW_HOST_ID)).toBe(false);
  });

  it('does not show if another tab acknowledges during the delay', async () => {
    await bootstrapWhatsNew();
    for (const listener of store.listeners) {
      listener({ version: 1, acknowledged: true });
    }
    await flush();
    expect(present(WHATS_NEW_HOST_ID)).toBe(false);
  });

  it('shows nothing when the extension is disabled', async () => {
    settings.enabled = false;
    await bootstrapWhatsNew();
    await bootstrapAiAssistantPromo();
    await flush();
    expect(present(WHATS_NEW_HOST_ID)).toBe(false);
    expect(present(PROMO_HOST_ID)).toBe(false);
  });

  it('shows no announcement without an org id', async () => {
    crm.context = null;
    await bootstrapWhatsNew();
    await flush();
    expect(present(WHATS_NEW_HOST_ID)).toBe(false);
  });
});
