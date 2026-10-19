# 0013 — Entitlement is a licence check

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Treat client entitlement as a licence check and UX gate, not a security boundary. Read the
entitlement from the API and cache it briefly; signed-out, offline, and error states resolve to
Free and must never break a free feature. Do not add a signed entitlement token as anti-bypass
protection.

## Rationale

For editor features running in a public MIT extension, a user can patch out any client check.
Signing the answer adds no protection against that bypass: the verifier is the same patchable
code. Only a server doing work it can refuse can genuinely enforce premium access.

## Consequences

- Client gating communicates licence status; server endpoints must independently enforce paid
  access to their work. A purely local premium feature would not be enforceable at all.
- Both planned premium candidates in `src/features/registry.ts`, GitHub sync and bulk
  import/export (export/backup), are intended to use server-mediated work that can be refused.
  Their names alone do not require a server: choosing a purely local export would lose that
  enforcement. The premium feature must still be selected and designed.
- Whoever selects that feature must resolve the scope contradiction: `docs/product.md` lists
  GitHub sync as a non-goal while the registry lists it as planned premium. Bulk import/export
  is also currently a product non-goal. Neither is silently approved by this record.
- Offline premium access is sacrificed for a simple Free fallback; existing free capabilities
  remain available regardless of entitlement service availability.
