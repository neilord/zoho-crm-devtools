import { Analyzer } from './interpreter';
import type { AnalyzeOptions, FunctionEffects } from './types';

/** Bump whenever recognition, registry, confidence, or serialized output changes. */
export const DELUGE_EFFECTS_VERSION = 2;
export type * from './types';

/** Pure, synchronous, bounded analysis; callers schedule/yield between functions. */
export function analyzeDelugeEffects(
  source: string,
  options: AnalyzeOptions = {},
): FunctionEffects {
  return new Analyzer(source, options, DELUGE_EFFECTS_VERSION).run();
}
