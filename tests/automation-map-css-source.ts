// @ts-expect-error The repo has no Node typings; vitest runs these tests under Node.
import { readFileSync } from 'node:fs';

/**
 * Raw source of a canvas stylesheet. vitest hands `?inline` and `?raw` CSS imports back empty
 * (CSS processing is off), so a test that guards a rule in the stylesheet reads the file itself.
 */
export function canvasCssSource(name: 'canvas' | 'fog' | 'trace'): string {
  const here = (import.meta as unknown as { dirname: string }).dirname;
  const text = readFileSync(
    `${here}/../src/content/automation-map/ui/canvas/${name}.css`,
    'utf8',
  ) as string;
  if (!text.includes('{')) throw new Error(`${name}.css read back empty`);
  return text;
}
