import { describe, expect, it } from 'vitest';
import type { FoggedIsland, TeaserFog } from '../src/content/automation-map/types';
import {
  fogChips,
  fogCountsText,
  fogSize,
  quietNote,
  summarizeFog,
} from '../src/content/automation-map/ui/fog-model';
import { skewedFog } from './fixtures/automation-map-port';

const island = (
  slot: number,
  rules: number,
  functions: number,
  buttons = 0,
  schedules = 0,
): FoggedIsland => ({ slot, counts: { rules, functions, buttons, schedules }, recordWrites: 0 });
const fogOf = (fogged: FoggedIsland[], quietModules?: number): TeaserFog => ({
  fogged,
  ...(quietModules === undefined ? {} : { quietModules }),
  totals: { rules: 0, functions: 0, modules: fogged.length },
});

describe('fog summary', () => {
  it('lists the islands worth drawing, largest first, and counts the quiet modules once', () => {
    const fog = skewedFog(9);
    const { areas, quiet } = summarizeFog(fog);
    expect(quiet).toBe(9);
    expect(areas.every((f) => fogSize(f) > 0)).toBe(true);
    const sizes = areas.map(fogSize);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });

  it('never draws a zero-count slot, and never adds quietModules to the slots it removed', () => {
    const slots = [island(0, 4, 3), island(1, 0, 0), island(2, 0, 0)];
    // An older snapshot: empty slots carry the information, there is no aggregate.
    expect(summarizeFog(fogOf(slots)).quiet).toBe(2);
    expect(summarizeFog(fogOf(slots)).areas.map((f) => f.slot)).toEqual([0]);
    // The store's aggregate wins; it is not summed with the empty slots.
    expect(summarizeFog(fogOf(slots, 7)).quiet).toBe(7);
    expect(summarizeFog(fogOf([island(0, 4, 3)], 0)).quiet).toBe(0);
  });

  it('writes counts and notes without any name', () => {
    expect(fogCountsText(island(0, 1, 1))).toBe('1 rule · 1 function');
    expect(fogCountsText(island(0, 0, 3))).toBe('3 functions');
    expect(fogCountsText(island(0, 30, 50, 2))).toBe('30 rules · 50 functions · 2 buttons');
    expect(fogCountsText(island(0, 0, 12, 0, 3))).toBe('3 schedules · 12 API functions');
    expect(quietNote(1)).toBe('1 other module without automation');
    expect(quietNote(9)).toBe('9 other modules without automation');
  });
});

describe('fog chip weight', () => {
  const chips = fogChips(summarizeFog(skewedFog()).areas);

  it('is not a grid of identical chips: size and opacity follow the counts', () => {
    const tiers = new Set([...chips.values()].map((c) => c.tier));
    expect(tiers.size).toBeGreaterThanOrEqual(4);
    expect(tiers.has('xl') && tiers.has('tiny')).toBe(true);
    const ordered = summarizeFog(skewedFog()).areas.map((f) => chips.get(f.slot));
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]?.scale).toBeLessThanOrEqual(ordered[i - 1]?.scale as number);
      expect(ordered[i]?.opacity).toBeLessThanOrEqual(ordered[i - 1]?.opacity as number);
    }
    const sizes = new Set([...chips.values()].map((c) => c.scale));
    expect(sizes.size).toBeGreaterThanOrEqual(3);
  });

  it('hides the chip of a tiny island until it is hovered or focused, and lets the big ones carry it', () => {
    const { areas } = summarizeFog(skewedFog());
    const biggest = chips.get(areas[0].slot);
    const tail = areas.filter((f) => f.counts.rules <= 1 && f.counts.functions <= 1);
    expect(tail.length).toBeGreaterThan(5);
    expect(biggest).toMatchObject({ tier: 'xl', opacity: 1 });
    for (const f of tail) expect(chips.get(f.slot)).toMatchObject({ tier: 'tiny', opacity: 0 });
  });

  it('scales its cut-offs to a small estate, so the biggest island still carries a chip', () => {
    const small = [island(0, 6, 4), island(1, 3, 2), island(2, 1, 1)];
    const out = fogChips(small);
    expect(out.get(0)?.opacity).toBeGreaterThan(0.8);
    expect(out.get(0)?.tier).not.toBe('tiny');
    expect(out.get(2)?.tier).toBe('tiny');
  });
});
