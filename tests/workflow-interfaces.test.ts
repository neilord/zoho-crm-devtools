import { expect, expectTypeOf, it, vi } from 'vitest';
import type { MatchProvenance, WorkflowAction } from '../src/content/workflows/types';
import { WorkflowIndex } from '../src/content/workflows/workflow-store';
import { context } from './fixtures/workflows';

it('preserves frozen UI types and constructor without I/O', () => {
  expectTypeOf<Extract<WorkflowAction, { kind: 'function' }>['joinConfidence']>().toEqualTypeOf<
    'exact' | 'uncertain' | 'none'
  >();
  expectTypeOf<
    Extract<MatchProvenance, { location: 'functionSource' }>['lineNumber']
  >().toEqualTypeOf<number>();
  const f = vi.fn(),
    index = new WorkflowIndex({ context, fetch: f }),
    listener = vi.fn();
  const unsubscribe = index.subscribe(listener);
  expect(listener.mock.calls[0][0].progress.isComplete).toBe(false);
  expect(f).not.toHaveBeenCalled();
  unsubscribe();
  unsubscribe();
  index.dispose();
  index.dispose();
});
