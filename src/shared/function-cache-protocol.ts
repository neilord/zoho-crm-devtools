import type { FunctionRecord } from '../content/functions/types';

export interface FunctionCache {
  version: 1;
  records: FunctionRecord[];
}
export type FunctionCacheMessage =
  | { type: 'functions:readCache'; orgId: string }
  | { type: 'functions:writeCache'; orgId: string; value: FunctionCache };

export function isFunctionCacheMessage(value: unknown): value is FunctionCacheMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<FunctionCacheMessage>;
  if (typeof m.orgId !== 'string' || !/^\d+$/.test(m.orgId)) return false;
  if (m.type === 'functions:readCache') return Object.keys(m).length === 2;
  if (m.type !== 'functions:writeCache' || Object.keys(m).length !== 3) return false;
  const cache = m.value;
  return (
    !!cache &&
    cache.version === 1 &&
    Array.isArray(cache.records) &&
    cache.records.every(
      (record) =>
        record &&
        typeof record === 'object' &&
        record.summary &&
        typeof record.summary.id === 'string' &&
        (record.detail === null || (record.detail && typeof record.detail.id === 'string')),
    )
  );
}
