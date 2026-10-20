import { expect, it } from 'vitest';
import type { ZohoFunctionSummary } from '../src/content/functions/types';
import { normalizeAction } from '../src/content/workflows/normalize';
import { joinFunction } from '../src/content/workflows/related-functions';
import { binding, catalogue, functionResource } from './fixtures/workflows';

const action = normalizeAction(binding, functionResource);
if (action.kind !== 'function') throw new Error('Invalid synthetic fixture');
const permutations = <T>(items: T[]): T[][] =>
  items.length === 0
    ? [[]]
    : items.flatMap((item, i) =>
        permutations(items.filter((_, j) => i !== j)).map((rest) => [item, ...rest]),
      );
const legacy = {
  ...catalogue[0],
  api_name: null,
  display_name: 'Different title',
  workflow: { name: binding.name },
};
for (const [name, entries, confidence, apiName, bindingName] of [
  [
    'exact',
    [...catalogue, { ...catalogue[0] }],
    'exact',
    functionResource.function.api_name,
    binding.name,
  ],
  [
    'nullable name-only',
    [legacy, { id: '999', api_name: null, display_name: 'Unbound', category: '' }],
    'uncertain',
    null,
    binding.name,
  ],
  ['ambiguous names', [legacy, { ...legacy, id: '502' }], 'none', null, binding.name],
  [
    'conflicting source enum',
    [...catalogue, { ...catalogue[0], source: 'extension' }],
    'none',
    functionResource.function.api_name,
    binding.name,
  ],
  [
    'conflicting API name',
    [...catalogue, { ...catalogue[0], api_name: 'different' }],
    'none',
    functionResource.function.api_name,
    binding.name,
  ],
  ['empty name', [{ ...catalogue[0], display_name: '' }], 'none', null, ''],
  ['API mismatch never falls back', catalogue, 'none', 'missing', binding.name],
] as const) {
  it(`keeps ${name} joins stable across every catalogue ordering and JSON hydration`, () => {
    for (const ordered of permutations([...entries])) {
      for (const list of [ordered, JSON.parse(JSON.stringify(ordered)) as ZohoFunctionSummary[]]) {
        const joined = joinFunction({ ...action, apiName, bindingName }, list);
        expect(joined.confidence).toBe(confidence);
        expect(joined.summary?.id ?? null).toBe(confidence === 'none' ? null : '501');
      }
    }
  });
}
