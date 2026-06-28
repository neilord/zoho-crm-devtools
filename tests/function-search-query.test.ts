import { describe, expect, it } from 'vitest';
import {
  filterRecords,
  getCategoryCounts,
  getCategoryKey,
  getCategoryLabel,
  matchesQuery,
  normalizeQuery,
  sortByModified,
} from '../src/content/functions/search';
import type { FunctionRecord, ZohoFunctionSummary } from '../src/content/functions/types';

function record(
  summary: Partial<ZohoFunctionSummary> &
    Pick<ZohoFunctionSummary, 'id' | 'display_name' | 'category'>,
  detail: FunctionRecord['detail'] = null,
): FunctionRecord {
  return { summary: summary as ZohoFunctionSummary, detail };
}

describe('category grouping', () => {
  it('prefers the workflow namespace over the coarse category', () => {
    expect(
      getCategoryKey({
        category: 'Automation',
        workflow: { namespace: 'leadfilter' },
      } as ZohoFunctionSummary),
    ).toBe('leadfilter');
  });

  it('falls back to the category when there is no namespace', () => {
    expect(getCategoryKey({ category: 'Standalone' } as ZohoFunctionSummary)).toBe('Standalone');
  });

  it('humanizes a category key for display', () => {
    expect(getCategoryLabel('extension_action')).toBe('Extension action');
  });

  it('counts records per category, sorted by label', () => {
    const counts = getCategoryCounts([
      record({ id: '1', display_name: 'a', category: 'Standalone' }),
      record({ id: '2', display_name: 'b', category: 'Automation' }),
      record({ id: '3', display_name: 'c', category: 'Automation' }),
    ]);

    expect(counts).toEqual([
      { key: 'Automation', label: 'Automation', count: 2 },
      { key: 'Standalone', label: 'Standalone', count: 1 },
    ]);
  });
});

describe('query normalization and matching', () => {
  it('lowercases and drops a leading wildcard', () => {
    expect(normalizeQuery('  %ScreenLead ')).toBe('screenlead');
  });

  it('matches on display name case-insensitively', () => {
    const fn = record({ id: '1', display_name: 'LIVE_ScreenLead', category: 'Standalone' });
    expect(matchesQuery(fn, 'screenlead')).toBe(true);
  });

  it('ignores queries shorter than the minimum length', () => {
    const fn = record({ id: '1', display_name: 'abc', category: 'Standalone' });
    expect(matchesQuery(fn, 'ab')).toBe(false);
  });

  it('matches against loaded source code', () => {
    const fn = record(
      { id: '1', display_name: 'noMatch', category: 'Standalone' },
      { id: '1', script: 'zoho.crm.getRecordById(...)' },
    );
    expect(matchesQuery(fn, 'getrecordbyid')).toBe(true);
  });
});

describe('filtering and sorting', () => {
  const records = [
    record({ id: '1', display_name: 'Alpha', category: 'Standalone', updatedTime: 100 }),
    record({ id: '2', display_name: 'Beta', category: 'Automation', updatedTime: 300 }),
    record({ id: '3', display_name: 'Gamma', category: 'Automation', updatedTime: 200 }),
  ];

  it('filters by category', () => {
    const result = filterRecords(records, { category: 'Automation', query: '' });
    expect(result.map((r) => r.summary.id)).toEqual(['2', '3']);
  });

  it('filters by query within a category', () => {
    const result = filterRecords(records, { category: 'Automation', query: 'gam' });
    expect(result.map((r) => r.summary.id)).toEqual(['3']);
  });

  it('sorts newest and oldest first', () => {
    expect(sortByModified(records, 'newest').map((r) => r.summary.id)).toEqual(['2', '3', '1']);
    expect(sortByModified(records, 'oldest').map((r) => r.summary.id)).toEqual(['1', '3', '2']);
  });
});
