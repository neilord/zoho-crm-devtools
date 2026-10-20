# 0018 — Refresh reuse blast radius and ambiguous outcome recovery

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Refine ADR 0017 with the verified backend behavior: reuse interval zero means a spent refresh
returns HTTP 400 `invalid_grant` and deletes **all** refresh tokens for that user+client across
all devices/authorizations, plus associated access tokens. Never replay a possibly spent token.

Keep single-flight refresh in the worker. Persist a rotation journal before the request and the
replacement pair before releasing waiters. On `invalid_grant`, clear locally and report signed out.
On an ambiguous network/persistence outcome, report `signedIn: false, signedOutPending: true`
with Free entitlement. The next read rechecks storage once: only a different, committed, unmarked
pair may be validated with one entitlement call; never refresh during recovery. Otherwise clear
and report signed out. A restarted worker applies the same rule to an interrupted journal.

## Rationale

The verified revocation scope is broader than a grant family, so retries can disconnect every
device. A storage write can commit despite a lost acknowledgement; a readback may safely recover
that replacement. Neither an old access token nor an elapsed lease proves a refresh is safe.

The signed website continuation is replayable for 600 seconds. Exact Chrome redirect and PKCE
bind the issued code to its initiating attempt. Generate fresh state/verifier per attempt and
keep them only in that attempt's local scope; do not persist or reuse them after completion.

## Consequences

- UI may show checking sign-in with Free while recovery is pending; it must never label this Pro.
- Storage failure or worker interruption can require sign-in again. No automatic refresh retry.
- Trusted local storage also contains the existing search cache. Content scripts use a separate
  exact `functions:readCache`/`functions:writeCache` channel restricted to numeric-org cache keys,
  preserving warm search without granting access to credential keys. This local-only channel
  does not call the billing client or transmit function data to any backend.
