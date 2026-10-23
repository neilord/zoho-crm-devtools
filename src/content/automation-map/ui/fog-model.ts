/**
 * Pure view-model for the teaser's fog: what the preview may say about the modules it does not
 * reveal. It reads `FoggedIsland` (counts and an opaque slot) and the aggregate `quietModules`,
 * so nothing here can name a module, rule or function.
 */
import type { FoggedIsland, TeaserFog } from '../types';

const n = (value: number, one: string, many = `${one}s`) => `${value} ${value === 1 ? one : many}`;

/** The Org-wide area: schedules and API functions only. The contract has no flag for it. */
export const isOrgLike = (f: FoggedIsland): boolean =>
  f.counts.rules === 0 && f.counts.buttons === 0 && f.counts.schedules > 0;

/** Everything the island holds, for ordering and for scaling what is drawn for it. */
export const fogSize = (f: FoggedIsland): number =>
  f.counts.rules + f.counts.functions + f.counts.buttons + f.counts.schedules;

/** A module with no list-visible automation: counted in one note, never drawn as an island. */
export const isQuiet = (f: FoggedIsland): boolean => fogSize(f) === 0;

/** "11 rules · 9 functions · 2 buttons": counts only, zero parts left out. */
export function fogCountsText(f: FoggedIsland): string {
  if (isQuiet(f)) return 'No rules or functions';
  if (isOrgLike(f))
    return [n(f.counts.schedules, 'schedule'), n(f.counts.functions, 'API function')].join(' · ');
  const parts: string[] = [];
  if (f.counts.rules) parts.push(n(f.counts.rules, 'rule'));
  if (f.counts.functions) parts.push(n(f.counts.functions, 'function'));
  if (f.counts.buttons) parts.push(n(f.counts.buttons, 'button'));
  if (f.counts.schedules) parts.push(n(f.counts.schedules, 'schedule'));
  return parts.join(' · ');
}

export interface FogSummary {
  /** Islands worth drawing, largest first. */
  areas: FoggedIsland[];
  /** Modules without automation: one aggregate note. */
  quiet: number;
}

/**
 * The store removes quiet modules from `fogged` and reports how many in `quietModules`. A snapshot
 * that predates that carries them as empty slots instead; they are counted here, never drawn.
 * It is one or the other, never the sum.
 */
export function summarizeFog(fog: TeaserFog): FogSummary {
  const areas = fog.fogged
    .filter((f) => !isQuiet(f))
    .sort((a, b) => fogSize(b) - fogSize(a) || a.slot - b.slot);
  return { areas, quiet: fog.quietModules ?? fog.fogged.length - areas.length };
}

/** "9 other modules without automation". */
export const quietNote = (quiet: number): string =>
  `${n(quiet, 'other module')} without automation`;

/* ---------- lock chip weight ---------- */

export type FogTier = 'xl' | 'lg' | 'md' | 'sm' | 'tiny';

export interface FogChip {
  tier: FogTier;
  /** Chip scale relative to the standard chip. */
  scale: number;
  /** Resting opacity; a `tiny` chip rests at 0 and appears on hover or focus. */
  opacity: number;
}

const CHIP: Record<FogTier, Omit<FogChip, 'tier'>> = {
  xl: { scale: 1.18, opacity: 1 },
  lg: { scale: 1, opacity: 0.94 },
  md: { scale: 0.84, opacity: 0.8 },
  sm: { scale: 0.7, opacity: 0.6 },
  tiny: { scale: 0.7, opacity: 0 },
};

/** What an island holds in one number: rules and buttons weigh most, functions about half. */
const weight = (f: FoggedIsland): number =>
  f.counts.rules + f.counts.buttons + f.counts.schedules + f.counts.functions * 0.5;

/**
 * Chip weight per island, so the fog is not a grid of identical chips: the big modules carry a
 * full chip, middling ones a smaller and fainter one, the one-rule long tail none until hovered.
 * Cut-offs are absolute for a real org and shrink with the largest island of a small one, where
 * absolute cut-offs would leave every island tiny. Counts in, numbers out.
 */
export function fogChips(areas: readonly FoggedIsland[]): Map<number, FogChip> {
  const largest = areas.reduce((max, f) => Math.max(max, weight(f)), 0);
  const k = Math.min(1, Math.max(0.25, largest / 70));
  const cuts = { tiny: Math.max(1.6, 3 * k), sm: 8 * k, md: 25 * k, lg: 70 * k };
  const out = new Map<number, FogChip>();
  for (const f of areas) {
    const w = weight(f);
    const tier: FogTier =
      w < cuts.tiny ? 'tiny' : w < cuts.sm ? 'sm' : w < cuts.md ? 'md' : w < cuts.lg ? 'lg' : 'xl';
    out.set(f.slot, { tier, ...CHIP[tier] });
  }
  return out;
}
