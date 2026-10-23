import type { AutomationMapCache } from '../../../shared/automation-map-cache-protocol';
import { normalizeAction, normalizeRule, normalizeTemplate } from '../../workflows/normalize';
import { joinFunction } from '../../workflows/related-functions';
import type { WorkflowAction } from '../../workflows/types';
import type { AutomationGraphInputs } from '../types';

export function cacheInputs(
  inputs: AutomationGraphInputs,
  revalidation?: AutomationMapCache['revalidation'],
): AutomationMapCache {
  return {
    version: 1,
    savedAt: Date.now(),
    ...(revalidation ? { revalidation } : {}),
    inputs: {
      ...inputs,
      rules: inputs.rules.map((r) => ({
        ...r,
        conditions: r.conditions.map((c) => ({
          ...c,
          instantActions: c.instantActions.map(stripSource),
          scheduledActions: c.scheduledActions.map((s) => ({
            ...s,
            actions: s.actions.map(stripSource),
          })),
        })),
      })),
      transitions: inputs.transitions.map((t) => ({ ...t, actions: t.actions.map(stripSource) })),
      approvals: inputs.approvals.map((a) => ({ ...a, actions: a.actions.map(stripSource) })),
      fields: [...inputs.fields].map(([key, fields]) => [key, [...fields]]),
      functions: inputs.functions.map((f) =>
        f.sourceState === 'failed'
          ? { ...f, summary: { ...f.summary, updatedTime: undefined } }
          : f,
      ),
    },
  };
}
/** Re-normalize raw action/trigger unions; never trust cached normalized discriminants. */
export function hydrateInputs(cache: AutomationMapCache): AutomationGraphInputs {
  const i = cache.inputs;
  const enrich = (a: WorkflowAction): WorkflowAction => {
    let next = normalizeAction(a.raw, a.resourceRaw);
    if (
      next.kind === 'emailNotification' &&
      next.template &&
      a.kind === 'emailNotification' &&
      a.template?.state === 'loaded'
    )
      next = { ...next, template: normalizeTemplate(a.template.raw) };
    if (next.kind === 'function') {
      const join = joinFunction(
          next,
          i.functions.map((f) => f.summary),
        ),
        source =
          join.confidence === 'exact' && join.summary
            ? i.functions.find((f) => f.delugeId === join.summary?.id)
            : null;
      next = {
        ...next,
        joinConfidence: join.confidence,
        delugeFunctionId: join.summary?.id ?? null,
        sourceState: source?.sourceState === 'available' ? 'available' : 'unavailable',
        sourceText: source?.sourceText ?? null,
      };
    }
    return next;
  };
  return {
    ...i,
    fields: new Map(i.fields),
    rules: i.rules.map((r) => {
      const next = normalizeRule(r.raw, r.detailRaw);
      return {
        ...next,
        conditions: next.conditions.map((c, index) => ({
          ...c,
          instantActions: (r.conditions[index]?.instantActions ?? c.instantActions).map(enrich),
          scheduledActions: c.scheduledActions.map((s, n) => ({
            ...s,
            actions: (r.conditions[index]?.scheduledActions[n]?.actions ?? s.actions).map(enrich),
          })),
        })),
      };
    }),
    transitions: i.transitions.map((t) => ({ ...t, actions: t.actions.map(enrich) })),
    approvals: i.approvals.map((a) => ({ ...a, actions: a.actions.map(enrich) })),
  };
}

/** The all-function table is the single source store, even for heavily shared bindings. */
function stripSource(action: WorkflowAction): WorkflowAction {
  return action.kind === 'function' ? { ...action, sourceText: null } : action;
}
