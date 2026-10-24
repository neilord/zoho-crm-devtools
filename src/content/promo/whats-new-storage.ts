import { browser, onSyncStorageKeyChanged } from '../../shared/browser';
import {
  acknowledgeWhatsNew,
  defaultWhatsNewState,
  isWhatsNewPendingState,
  normalizeWhatsNewState,
  type WhatsNewState,
} from './whats-new-state';

/**
 * Sync storage so the acknowledgement follows the user's Google account. The
 * key names the campaign: a future announcement uses a new key and shows again.
 */
export const WHATS_NEW_STATE_KEY = 'whatsNewWorkflowTools2026';

export async function loadWhatsNewState(): Promise<WhatsNewState> {
  const stored = await browser.storage.sync.get<{
    whatsNewWorkflowTools2026?: Partial<WhatsNewState>;
  }>([WHATS_NEW_STATE_KEY]);
  return normalizeWhatsNewState(stored.whatsNewWorkflowTools2026);
}

export async function saveWhatsNewAcknowledged(): Promise<void> {
  await browser.storage.sync.set({
    [WHATS_NEW_STATE_KEY]: acknowledgeWhatsNew(defaultWhatsNewState),
  });
}

/** True while the announcement still owns the corner; the AI Assistant promo waits on this. */
export async function isWhatsNewPending(): Promise<boolean> {
  return isWhatsNewPendingState(await loadWhatsNewState());
}

/** Fires once another tab (or this one) acknowledges the announcement. */
export function onWhatsNewAcknowledged(listener: () => void): () => void {
  return onSyncStorageKeyChanged(WHATS_NEW_STATE_KEY, (value) => {
    if (!isWhatsNewPendingState(normalizeWhatsNewState(value as Partial<WhatsNewState>))) {
      listener();
    }
  });
}
