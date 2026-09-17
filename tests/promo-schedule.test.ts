import { describe, expect, it } from 'vitest';
import {
  defaultPromoState,
  finishPromo,
  MAX_PROMO_SHOWS,
  markPromoShown,
  normalizePromoState,
  SNOOZE_MS,
  shouldShowPromo,
  snoozePromo,
} from '../src/content/promo/schedule';

const NOW = 1_800_000_000_000;

describe('promo schedule', () => {
  it('shows a fresh user the card once', () => {
    expect(shouldShowPromo(defaultPromoState, NOW)).toBe(true);
    const shown = markPromoShown(defaultPromoState);
    expect(shown.shownCount).toBe(1);
    // Still "pending" while the card is on screen; a second tab must not show another.
    expect(shouldShowPromo(shown, NOW)).toBe(true);
  });

  it('never shows again after install or close', () => {
    const done = finishPromo(markPromoShown(defaultPromoState));
    expect(done.status).toBe('done');
    expect(shouldShowPromo(done, NOW)).toBe(false);
    expect(shouldShowPromo(done, NOW + 365 * SNOOZE_MS)).toBe(false);
  });

  it('brings a snoozed card back after three days, then stops for good', () => {
    const snoozed = snoozePromo(markPromoShown(defaultPromoState), NOW);
    expect(snoozed.status).toBe('snoozed');
    expect(shouldShowPromo(snoozed, NOW)).toBe(false);
    expect(shouldShowPromo(snoozed, NOW + SNOOZE_MS - 1)).toBe(false);
    expect(shouldShowPromo(snoozed, NOW + SNOOZE_MS)).toBe(true);

    const shownAgain = markPromoShown(snoozed);
    expect(shownAgain.shownCount).toBe(MAX_PROMO_SHOWS);
    const ignoredAgain = snoozePromo(shownAgain, NOW + SNOOZE_MS);
    expect(ignoredAgain.status).toBe('done');
    expect(shouldShowPromo(ignoredAgain, NOW + 10 * SNOOZE_MS)).toBe(false);
  });

  it('normalizes garbage into a safe default', () => {
    expect(normalizePromoState(undefined)).toEqual(defaultPromoState);
    expect(
      normalizePromoState({
        status: 'nope' as never,
        shownCount: Number.NaN,
        snoozeUntil: 'soon' as never,
      }),
    ).toEqual(defaultPromoState);
    expect(normalizePromoState({ status: 'snoozed', shownCount: 1.7, snoozeUntil: 5 })).toEqual({
      version: 1,
      status: 'snoozed',
      shownCount: 1,
      snoozeUntil: 5,
    });
  });
});
