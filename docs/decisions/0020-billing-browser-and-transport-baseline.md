# 0020 — Billing browser and transport baseline

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Require Chrome 116 or newer for the account-enabled extension. Reject HTTP redirects on worker
API requests and same-origin Zoho function reads. Refresh remains demand-driven with the durable
journal and single-flight serialization from ADRs 0017–0018; do not add a timer or alarms permission.

## Rationale

Chrome 116 permits `identity.launchWebAuthFlow` to outlive the worker's ordinary five-minute
request limit and provides the AbortSignal composition used by export. See Chrome's
[worker lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#chrome-116).
Older browsers must not install a build whose sign-in or export relies on unavailable behavior.

A 307/308 can forward an OAuth form containing credentials to a redirect target. Fixed endpoint
strings alone do not constrain fetch's default redirect following. Zoho reads also carry org/CSRF
headers and must stay on their documented endpoints. An unexpected redirect fails closed.

## Consequences

- Older Chrome installations retain their previous compatible version until the browser updates.
- Every account request omits cookies and rejects redirects; tests cover the actual form encoding.
- Idle worker termination needs no scheduled refresh. A later request reads durable state and
  refreshes once if needed; an interrupted rotation never reuses an uncertain token.
- Redirecting service deployments must expose the exact configured endpoints instead of relying
  on client redirect following. No host or alarms permission is added.
