# 0017 — Extension OAuth authorization code with PKCE

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Refine ADR 0012's sign-in choice to OAuth 2.1 authorization code with S256 PKCE through
`chrome.identity.launchWebAuthFlow`. Validate the exact Chrome redirect origin/path, state,
error and API issuer before exchanging the single-use code. Tokens are opaque: short-lived
access tokens and rotating refresh tokens, kept only in local extension storage restricted to
trusted extension contexts. Token and entitlement calls originate exclusively in the worker,
use ordinary CORS with credentials omitted, and require no API host permissions.

## Rationale

The backend implements a public OAuth client with no client secret. PKCE binds the code to the
initiating worker; state and issuer validation prevent callback substitution. This removes the
login-tab alternative without changing ADR 0012's permission decision.

## Consequences

- Consume the backend's public-safe product contract artifact; no private dependencies or secrets.
- Serialize account mutations in the sole worker instance and coalesce entitlement reads. Before
  refresh, atomically persist a session record marked in progress; after success, atomically replace
  it with the new token pair. A restarted worker discards an in-progress session. Never lease-expire
  and replay an uncertain refresh: reuse interval zero can revoke the grant family. A lost response
  or failed persistence costs a new sign-in, rather than a replay. Storage is a restart journal,
  not a cross-process compare-and-swap lock; only the worker may mutate the session.
- Disconnect clears locally before best-effort refresh-token revocation, so interruption during
  the network call cannot restore local credentials.
- Cache server-resolved entitlement for five minutes; failures resolve to Free. Stage 1 keeps
  the premium gate disabled under ADR 0015.
- Before release, validate CORS for both published and pinned dev ids, the installed-version
  update, signed-out Zoho behavior, and the specialist-designed prominent notice/account UI.
