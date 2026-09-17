import { browser } from '../../shared/browser';
import { normalizePromoState, type PromoState } from './schedule';

/**
 * Sync storage so a dismissal follows the user's Google account rather than
 * one browser profile; it is kept apart from `settings` so the reset flow does
 * not resurrect the card.
 */
const PROMO_STATE_KEY = 'promoAiAssistant';

export async function loadPromoState(): Promise<PromoState> {
  const stored = await browser.storage.sync.get<{ promoAiAssistant?: Partial<PromoState> }>([
    PROMO_STATE_KEY,
  ]);
  return normalizePromoState(stored.promoAiAssistant);
}

export async function savePromoState(state: PromoState): Promise<void> {
  await browser.storage.sync.set({ [PROMO_STATE_KEY]: state });
}
