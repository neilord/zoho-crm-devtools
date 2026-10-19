# 0009 — Additive paid tier

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Supersede only the "Billing, login, or locked features" non-goal in
[`product.md`](../product.md): accounts, billing, and premium gates are now in scope.
[ADR 0002](0002-monetization.md) remains in force: nothing already free becomes paid, and
premium capabilities are additive and premium from their first release.

## Rationale

The blanket non-goal prevents the additive monetization that ADR 0002 already anticipates.
Removing that prohibition lets new capabilities fund development without taking anything away
from existing users. Reclassifying shipped features would violate the existing commitment.

## Consequences

- Update the product scope; free use must not require an account or subscription.
- `src/features/registry.ts` already models `free | premium` and lists `githubSync` and
  `bulkImportExport` as planned premium. Wire this model to entitlement rather than inventing
  another feature-tier model.
- This accepts a direction, not a shipped account layer or a choice of premium feature.
