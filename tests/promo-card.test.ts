import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_ASSISTANT_STORE_URL,
  PROMO_HOST_ID,
  type PromoOutcome,
  showPromoCard,
} from '../src/content/promo/card';

function query(selector: string): HTMLElement {
  const host = document.getElementById(PROMO_HOST_ID);
  const node = host?.shadowRoot?.querySelector<HTMLElement>(selector);
  if (!node) {
    throw new Error(`Missing ${selector}`);
  }
  return node;
}

describe('promo card', () => {
  afterEach(() => {
    document.getElementById(PROMO_HOST_ID)?.remove();
    vi.useRealTimers();
  });

  it('links to the store listing with campaign parameters in a new tab', () => {
    showPromoCard(() => {}, 0);
    const link = query('.promo-install') as HTMLAnchorElement;
    expect(link.href).toBe(AI_ASSISTANT_STORE_URL);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    const url = new URL(link.href);
    expect(url.searchParams.get('utm_source')).toBe('zoho-crm-devtools');
    expect(url.searchParams.get('utm_medium')).toBe('extension');
    expect(url.searchParams.get('utm_campaign')).toBe('ai-assistant-launch');
  });

  it.each<[string, PromoOutcome]>([
    ['.promo-install', 'install'],
    ['.promo-later', 'later'],
    ['.promo-close', 'close'],
  ])('reports %s as %s and removes itself', (selector, expected) => {
    const outcomes: PromoOutcome[] = [];
    showPromoCard((outcome) => outcomes.push(outcome), 0);
    query(selector).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(outcomes).toEqual([expected]);
    expect(document.getElementById(PROMO_HOST_ID)).toBeNull();
  });

  it('reports an untouched card as ignored after the auto-hide delay', () => {
    vi.useFakeTimers();
    const outcomes: PromoOutcome[] = [];
    showPromoCard((outcome) => outcomes.push(outcome), 1_000);
    vi.advanceTimersByTime(999);
    expect(outcomes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(outcomes).toEqual(['ignored']);
    expect(document.getElementById(PROMO_HOST_ID)).toBeNull();
  });

  it('replaces an existing card instead of stacking a second one', () => {
    showPromoCard(() => {}, 0);
    showPromoCard(() => {}, 0);
    expect(document.querySelectorAll(`#${PROMO_HOST_ID}`)).toHaveLength(1);
  });
});
