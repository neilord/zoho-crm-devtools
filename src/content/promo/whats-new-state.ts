/**
 * State for the one-time "What's new" announcement (ADR 0034). The card shows
 * on every page load until the user acknowledges it, so the only fact to
 * persist is whether that happened.
 */

export const WHATS_NEW_STATE_VERSION = 1;

export interface WhatsNewState {
  version: typeof WHATS_NEW_STATE_VERSION;
  acknowledged: boolean;
}

export const defaultWhatsNewState: WhatsNewState = {
  version: WHATS_NEW_STATE_VERSION,
  acknowledged: false,
};

export function normalizeWhatsNewState(input: Partial<WhatsNewState> | undefined): WhatsNewState {
  return { version: WHATS_NEW_STATE_VERSION, acknowledged: input?.acknowledged === true };
}

export function isWhatsNewPendingState(state: WhatsNewState): boolean {
  return !state.acknowledged;
}

export function acknowledgeWhatsNew(state: WhatsNewState): WhatsNewState {
  return { ...state, acknowledged: true };
}
