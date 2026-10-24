import { afterEach, describe, expect, it, vi } from 'vitest';
import { contract } from '../src/billing/config';
import { showWhatsNewCard, WHATS_NEW_HOST_ID } from '../src/content/promo/whats-new-card';

const context = { origin: 'https://crm.zoho.eu', orgId: '123' };
const BASE = 'https://crm.zoho.eu/crm/org123/settings';

function root(): ShadowRoot {
  const shadow = document.getElementById(WHATS_NEW_HOST_ID)?.shadowRoot;
  if (!shadow) {
    throw new Error('Card is not mounted');
  }
  return shadow;
}

function query(selector: string): HTMLElement {
  const node = root().querySelector<HTMLElement>(selector);
  if (!node) {
    throw new Error(`Missing ${selector}`);
  }
  return node;
}

const click = (node: Element) =>
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('whats new card', () => {
  afterEach(() => {
    document.getElementById(WHATS_NEW_HOST_ID)?.remove();
    vi.useRealTimers();
  });

  it('links each row and the primary button to the org pages in the same tab', () => {
    showWhatsNewCard(context, () => {});
    const links = [...root().querySelectorAll<HTMLAnchorElement>('.wn-link')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `${BASE}/workflow-rules`,
      `${BASE}/workflow-rules#zcdt-map=v1`,
      `${BASE}/functions`,
    ]);
    const primary = query('.wn-primary') as HTMLAnchorElement;
    expect(primary.getAttribute('href')).toBe(`${BASE}/workflow-rules`);
    for (const link of [...links, primary]) {
      expect(link.hasAttribute('target')).toBe(false);
    }
  });

  it('marks only Automation Map as Beta and exposes the landmark and hidden hero', () => {
    showWhatsNewCard(context, () => {});
    const rows = [...root().querySelectorAll('.wn-row')];
    expect(rows.map((row) => row.querySelector('.wn-beta') !== null)).toEqual([false, true, false]);
    expect(query('.wn-card').getAttribute('role')).toBe('complementary');
    expect(query('.wn-card').getAttribute('aria-label')).toBe("What's new in Zoho CRM DevTools");
    expect(query('.wn-hero').getAttribute('aria-hidden')).toBe('true');
  });

  it('takes the trial length from the product contract', () => {
    showWhatsNewCard(context, () => {});
    expect(query('.wn-fine').textContent).toBe(
      `Included in paid plans · ${contract.trial.days}-day free trial`,
    );
  });

  it.each(['.wn-ghost', '.wn-close'])('acknowledges and removes the card on %s', (selector) => {
    const onAcknowledge = vi.fn();
    showWhatsNewCard(context, onAcknowledge);
    click(query(selector));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    expect(document.getElementById(WHATS_NEW_HOST_ID)).toBeNull();
  });

  it('acknowledges a link click without blocking navigation, then removes the card', () => {
    vi.useFakeTimers();
    const targets = [
      '.wn-primary',
      '.wn-row[data-i="0"] a',
      '.wn-row[data-i="1"] a',
      '.wn-row[data-i="2"] a',
    ];
    for (const selector of targets) {
      const onAcknowledge = vi.fn();
      showWhatsNewCard(context, onAcknowledge);
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      query(selector).dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(onAcknowledge).toHaveBeenCalledTimes(1);
      vi.runAllTimers();
      expect(document.getElementById(WHATS_NEW_HOST_ID)).toBeNull();
    }
  });

  it('previews a row on hover, focus and background click, but not on a link click', () => {
    showWhatsNewCard(context, () => {});
    const card = query('.wn-card');
    expect(card.dataset.active).toBe('0');
    query('.wn-row[data-i="1"]').dispatchEvent(new Event('pointerenter'));
    expect(card.dataset.active).toBe('1');
    query('.wn-row[data-i="2"]').dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(card.dataset.active).toBe('2');
    click(query('.wn-row[data-i="0"] .wn-row-desc'));
    expect(card.dataset.active).toBe('0');
    click(query('.wn-row[data-i="1"] a'));
    expect(card.dataset.active).toBe('0');
  });

  it('never hides itself', () => {
    vi.useFakeTimers();
    showWhatsNewCard(context, () => {});
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(document.getElementById(WHATS_NEW_HOST_ID)).not.toBeNull();
  });

  it('replaces an existing card instead of stacking a second one', () => {
    showWhatsNewCard(context, () => {});
    showWhatsNewCard(context, () => {});
    expect(document.querySelectorAll(`#${WHATS_NEW_HOST_ID}`)).toHaveLength(1);
  });
});
