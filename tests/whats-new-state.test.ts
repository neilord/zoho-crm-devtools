import { describe, expect, it } from 'vitest';
import {
  acknowledgeWhatsNew,
  defaultWhatsNewState,
  isWhatsNewPendingState,
  normalizeWhatsNewState,
  WHATS_NEW_STATE_VERSION,
} from '../src/content/promo/whats-new-state';

describe('whats new state', () => {
  it('normalizes missing or malformed input to a pending state', () => {
    expect(normalizeWhatsNewState(undefined)).toEqual(defaultWhatsNewState);
    expect(normalizeWhatsNewState({ acknowledged: 'yes' as unknown as boolean })).toEqual(
      defaultWhatsNewState,
    );
    expect(normalizeWhatsNewState({ version: 99 as never, acknowledged: true })).toEqual({
      version: WHATS_NEW_STATE_VERSION,
      acknowledged: true,
    });
  });

  it('is pending until acknowledged', () => {
    expect(isWhatsNewPendingState(defaultWhatsNewState)).toBe(true);
    expect(isWhatsNewPendingState(acknowledgeWhatsNew(defaultWhatsNewState))).toBe(false);
  });
});
