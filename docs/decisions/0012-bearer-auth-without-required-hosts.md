# 0012 — Bearer authentication without required host permissions

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Store the extension's bearer token in `chrome.storage.local` and send it as
`Authorization: Bearer` over plain CORS with `credentials: 'omit'`. Add no required
`host_permissions` for the API. Sign in through `chrome.identity.launchWebAuthFlow` with PKCE,
or a login tab on our own site that securely returns the token.

Hold `optional_host_permissions` in reserve: request them only at a user click, and show any
prompt only to a user who chooses to sign in.

## Rationale

[Chromium's permission model](https://chromium.googlesource.com/chromium/src/+/main/extensions/docs/permissions.md#Determining-Privilege-Increase)
compares permission messages on update. A privilege increase disables the extension until the
user accepts. A required host permission for a new API origin adds a warning beyond today's
Zoho access, disabling it for every existing user, including free users. Adding optional
permissions never disables an extension; the
[`identity` permission](https://developer.chrome.com/docs/extensions/reference/permissions-list)
is messageless.

Bearer transport needs no host privilege when the server supports ordinary CORS and avoids
third-party-cookie dependence. This deliberately diverges from the sibling product's cookie
transport: that product shipped new, with no installed base to disable.

## Consequences

- `Authorization` is not CORS-safelisted: every authenticated call requires preflight approval
  (a cached approval can avoid a new OPTIONS request). The API must explicitly allow that header.
  See the [Fetch standard](https://fetch.spec.whatwg.org/#http-cors-protocol).
- The API must echo the exact allowlisted `chrome-extension://<id>` origin, never `*`, and allowlist
  both the published extension id and the pinned development id. Exact-origin responses are our
  policy; `credentials: 'omit'` alone does not make wildcard origins invalid under CORS.
- Access tokens must be short-lived because `chrome.storage.local` is unencrypted. Keep tokens
  out of page messages and sync storage; a login-tab return needs validated sender and state.
- Verify permission-warning assumptions with Chrome's Extension Update Testing Tool before
  submission, and test CORS from the production service worker (ADR 0014).
