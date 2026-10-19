# 0011 — Two plans and one shared contract

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Offer two plans: `free` (Free), perpetual at $0 with no card, and `pro` (Pro), $23/month.
A missing or inactive subscription resolves to Free without creating a synthetic subscription
row: a free user creates no billing record and nothing expires.

New accounts receive the temporary Pro trial defined in [ADR 0016](0016-no-card-pro-trial.md)
as an additional entitlement grant; perpetual Free remains the subscription fallback.

Keep plan facts (id, name, price) in one shared immutable contract owned by the private backend
repository. Every surface consumes that contract; never maintain a second handwritten definition.
The registry's `premium` feature tier maps to the paid plan, not another billing plan.

## Rationale

A perpetual default preserves frictionless free use. Synthetic free subscriptions add billing
state and expiry handling for users who have bought nothing. One immutable contract prevents
checkout, website, API, and extension copy from drifting independently.

## Consequences

- Resolve entitlement from subscription state rather than requiring a billing row for every user.
- Deliver a public-safe contract artifact to the extension without private package access
  (ADR 0010); coordinate contract versions across surfaces.
- A future plan or price change must update the shared contract and its consumers, rather than
  patching constants independently. This record captures the decision, not a runtime data source.
