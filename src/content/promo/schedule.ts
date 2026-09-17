/**
 * Scheduling rules for the one-time Zoho CRM AI Assistant promo card. Pure
 * functions over a small persisted state so the policy is testable without
 * storage or DOM: the card shows at most twice per user, "Remind me later" and
 * an ignored card both defer it, and Install or close end it for good.
 */

export const PROMO_STATE_VERSION = 1;
export const MAX_PROMO_SHOWS = 2;
export const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

export type PromoStatus = 'pending' | 'snoozed' | 'done';

export interface PromoState {
  version: typeof PROMO_STATE_VERSION;
  status: PromoStatus;
  shownCount: number;
  /** Epoch ms after which a snoozed card may show again. */
  snoozeUntil: number | null;
}

export const defaultPromoState: PromoState = {
  version: PROMO_STATE_VERSION,
  status: 'pending',
  shownCount: 0,
  snoozeUntil: null,
};

export function normalizePromoState(input: Partial<PromoState> | undefined): PromoState {
  const status: PromoStatus =
    input?.status === 'snoozed' || input?.status === 'done' ? input.status : 'pending';
  const shownCount =
    typeof input?.shownCount === 'number' && Number.isFinite(input.shownCount)
      ? Math.max(0, Math.floor(input.shownCount))
      : 0;
  const snoozeUntil =
    typeof input?.snoozeUntil === 'number' && Number.isFinite(input.snoozeUntil)
      ? input.snoozeUntil
      : null;
  return { version: PROMO_STATE_VERSION, status, shownCount, snoozeUntil };
}

export function shouldShowPromo(state: PromoState, now: number): boolean {
  if (state.status === 'done' || state.shownCount >= MAX_PROMO_SHOWS) {
    return false;
  }
  if (state.status === 'snoozed') {
    return state.snoozeUntil !== null && now >= state.snoozeUntil;
  }
  return true;
}

/** Records an impression. Saved before the card renders so other tabs stay quiet. */
export function markPromoShown(state: PromoState): PromoState {
  return { ...state, status: 'pending', shownCount: state.shownCount + 1, snoozeUntil: null };
}

/**
 * "Remind me later" or an ignored card. Once the show cap is reached there is
 * nothing left to defer, so the promo ends instead of snoozing.
 */
export function snoozePromo(state: PromoState, now: number): PromoState {
  if (state.shownCount >= MAX_PROMO_SHOWS) {
    return finishPromo(state);
  }
  return { ...state, status: 'snoozed', snoozeUntil: now + SNOOZE_MS };
}

/** Install clicked or the card closed: never show again. */
export function finishPromo(state: PromoState): PromoState {
  return { ...state, status: 'done', snoozeUntil: null };
}
