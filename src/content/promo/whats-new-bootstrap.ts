import { loadSettings } from '../../settings/storage';
import { resolveCrmContext } from '../zoho/crm-context';
import { showWhatsNewCard, type WhatsNewCardHandle } from './whats-new-card';
import {
  isWhatsNewPending,
  onWhatsNewAcknowledged,
  saveWhatsNewAcknowledged,
} from './whats-new-storage';

/** Give Zoho's own load-time toasts and layout a moment before the card slides in. */
const SHOW_DELAY_MS = 3_000;

/**
 * Shows the "What's new" announcement on any Zoho CRM org page until the user
 * acknowledges it (ADR 0034). Acknowledging in any tab removes the card from
 * the others.
 */
export async function bootstrapWhatsNew(): Promise<void> {
  const settings = await loadSettings();
  const context = resolveCrmContext();
  if (!settings.enabled || !context || !(await isWhatsNewPending())) {
    return;
  }

  let card: WhatsNewCardHandle | null = null;
  let acknowledged = false;

  // Registered before the delay so an acknowledgement elsewhere also cancels a card not yet shown.
  onWhatsNewAcknowledged(() => {
    acknowledged = true;
    card?.close();
  });

  setTimeout(() => {
    if (acknowledged || !document.body) {
      return;
    }
    card = showWhatsNewCard(context, () => {
      acknowledged = true;
      void saveWhatsNewAcknowledged();
    });
  }, SHOW_DELAY_MS);
}
