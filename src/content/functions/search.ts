import type { FunctionRecord, ZohoFunctionSummary } from './types';
import { getFunctionSource } from './types';

/** Minimum query length before search runs, mirroring the original tool. */
export const MIN_QUERY_LENGTH = 3;

/**
 * The category a function is grouped under. Extension functions are grouped by
 * their namespace (e.g. `leadfilter`); everything else by its coarse category.
 */
export function getCategoryKey(summary: ZohoFunctionSummary): string {
  const namespace = summary.workflow?.namespace;
  return namespace ? namespace : summary.category;
}

/** Human-friendly label for a category key, e.g. `extension_action` -> `Extension action`. */
export function getCategoryLabel(key: string): string {
  const spaced = key.replace(/_/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

/** Lowercases the query and drops a leading `%` wildcard (a no-op convenience). */
export function normalizeQuery(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith('%') ? trimmed.slice(1) : trimmed;
}

function buildHaystack(record: FunctionRecord): string {
  const { summary } = record;
  const parts = [
    summary.id,
    summary.display_name,
    summary.api_name,
    summary.description,
    getFunctionSource(record),
  ];
  return parts
    .filter((part): part is string => Boolean(part))
    .join(' || ')
    .toLowerCase();
}

/**
 * Whether a record matches the query. Searches id, display name, api name,
 * description, and (once loaded) the Deluge source. Returns `false` for queries
 * shorter than {@link MIN_QUERY_LENGTH}.
 */
export function matchesQuery(record: FunctionRecord, normalizedQuery: string): boolean {
  if (normalizedQuery.length < MIN_QUERY_LENGTH) {
    return false;
  }
  return buildHaystack(record).includes(normalizedQuery);
}

export interface CategoryCount {
  key: string;
  label: string;
  count: number;
}

/** Category counts in stable, alphabetical-by-label order for the filter rail. */
export function getCategoryCounts(records: FunctionRecord[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = getCategoryKey(record.summary);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: getCategoryLabel(key), count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export interface FilterOptions {
  category: string | null;
  query: string;
}

/**
 * Applies the active category filter and search query to the records. Records
 * keep their input order; callers sort separately.
 */
export function filterRecords(records: FunctionRecord[], options: FilterOptions): FunctionRecord[] {
  const normalized = normalizeQuery(options.query);
  const hasQuery = normalized.length >= MIN_QUERY_LENGTH;

  return records.filter((record) => {
    if (options.category && getCategoryKey(record.summary) !== options.category) {
      return false;
    }
    return hasQuery ? matchesQuery(record, normalized) : true;
  });
}

function toEpoch(value: string | number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  const time = new Date(numeric).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export type SortOrder = 'newest' | 'oldest';

/** Returns a new array sorted by last-modified time. */
export function sortByModified(records: FunctionRecord[], order: SortOrder): FunctionRecord[] {
  const direction = order === 'newest' ? -1 : 1;
  return [...records].sort(
    (a, b) => direction * (toEpoch(a.summary.updatedTime) - toEpoch(b.summary.updatedTime)),
  );
}
