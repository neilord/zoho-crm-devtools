import { loadSettings } from '../../settings/storage';
import { type PromoOutcome, showPromoCard } from './card';
import { finishPromo, markPromoShown, shouldShowPromo, snoozePromo } from './schedule';
import { loadPromoState, savePromoState } from './storage';
import { isWhatsNewPending } from './whats-new-storage';

/** Give Zoho's own load-time toasts and layout a moment before the card slides in. */
const SHOW_DELAY_MS = 3_000;

/**
 * Shows the Zoho CRM AI Assistant promo card on any Zoho CRM page, at most
 * twice per user (see `schedule.ts`). The impression is persisted before the
 * card renders so concurrently open tabs do not each show one. It waits while
 * the "What's new" announcement is unacknowledged (ADR 0034).
 */
export async function bootstrapAiAssistantPromo(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.enabled) {
    return;
  }

  // One corner card at a time: the announcement goes first and records no impression here.
  if (await isWhatsNewPending()) {
    return;
  }

  const state = await loadPromoState();
  if (!shouldShowPromo(state, Date.now())) {
    return;
  }

  const shownState = markPromoShown(state);
  await savePromoState(shownState);

  const onOutcome = (outcome: PromoOutcome): void => {
    const next =
      outcome === 'install' || outcome === 'close'
        ? finishPromo(shownState)
        : snoozePromo(shownState, Date.now());
    void savePromoState(next);
  };

  setTimeout(() => {
    if (!document.body) {
      return;
    }
    showPromoCard(onOutcome);
  }, SHOW_DELAY_MS);
}
