import type { ZohoFunctionSummary } from '../functions/types';
import type { WorkflowAction } from './types';

export function joinFunction(
  action: Extract<WorkflowAction, { kind: 'function' }>,
  catalogue: readonly ZohoFunctionSummary[],
) {
  // An API-name mismatch must never silently fall back to a display-name guess.
  const matches = action.apiName
    ? catalogue.filter((s) => s.api_name === action.apiName)
    : catalogue.filter(
        (s) =>
          !!action.bindingName &&
          (s.display_name === action.bindingName || s.workflow?.name === action.bindingName),
      );
  if (!matches.length) return { summary: null, confidence: 'none' as const };
  // Duplicate pages/identical entries are one candidate; conflicting identity metadata
  // for the same ID stays unresolved. Neither catalogue ordering nor a first-match wins.
  const candidates = [...new Map(matches.map((entry) => [entry.id, entry])).values()];
  const candidateIds = new Set(candidates.map((entry) => entry.id));
  const identities = new Map(candidates.map((entry) => [entry.id, functionJoinIdentity(entry)]));
  const conflicting = catalogue.some(
    (entry) =>
      candidateIds.has(entry.id) && identities.get(entry.id) !== functionJoinIdentity(entry),
  );
  const unique = candidates.length === 1 && !conflicting;
  return {
    summary: unique ? candidates[0] : null,
    confidence: !unique
      ? ('none' as const)
      : action.apiName
        ? ('exact' as const)
        : ('uncertain' as const),
  };
}

/** Identity fields used for joins and source fetches, independent of property/page order. */
export function functionJoinIdentity(entry: ZohoFunctionSummary): string {
  return JSON.stringify([
    entry.api_name ?? null,
    entry.display_name,
    entry.source ?? 'crm',
    entry.language ?? 'deluge',
    entry.workflow?.name ?? null,
  ]);
}
