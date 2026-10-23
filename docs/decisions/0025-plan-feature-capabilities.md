# 0025 — Per-plan feature capabilities

- **Status:** Accepted
- **Date:** 2026-10-24

## Decision

Refine ADR 0023 for tiered features with the cloud-owned product contract 0.2.0. Each plan
defines capability keys: Free has none; Plus has `exportFunctions` and `workflowSearch`;
Pro and Max also have `automationMap`. Copy the generated public artifact unchanged.

Keep the six required entitlement fields and accept an optional `features` array of non-empty
strings. Ignore an invalid optional list without weakening the required-field validation.
`hasPlanFeature(entitlement, featureId)` first requires a resolved paid entitlement. Prefer a
server list when present, including an empty list; otherwise use the synced contract for known
plan keys. An unknown entitled paid key without a server list gets only the baseline capabilities
`exportFunctions` and `workflowSearch`. Never infer entitlement from status or local dates.

Register Automation Map as planned premium with its own enforced gate, routed through the
capability check. Preserve the existing any-paid gates for Export functions and Search All
Workflows, including the Plus trial and future entitled paid keys, regardless of feature lists.

## Rationale

Forward-compatible paid keys preserve existing access but cannot safely imply access to future
tiered features. A server list allows authoritative capability changes; the versioned contract
keeps older API responses and existing caches compatible during rollout. An explicit empty list
must not accidentally fall back to a more permissive local plan definition.

## Consequences

The background router, persistent entitlement cache and account API retain the optional list.
The popup view model projects display fields only; capability callers must use the original
entitlement snapshot. No new permissions, billing requests or CRM integration are introduced.
This remains a local licence/UX gate under ADR 0013. Automation Map's implementation and release
are separate work; registry presence does not advertise a shipped feature. The popup plan columns
currently list names and prices, so their copy is unchanged.
