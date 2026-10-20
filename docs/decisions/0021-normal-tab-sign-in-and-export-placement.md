# 0021 — Normal-tab sign-in and adjacent Export control

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Refine ADR 0017: replace identity.launchWebAuthFlow with a normal tab immediately after the
active tab and redirect to `src/billing/oauth-callback.html` in the extension. Store the PKCE
transaction in trusted storage.session for ten minutes. Validate the runtime sender as our own
callback page, frame and pending tab; validate URI, state, issuer and error before consuming it.
Consume before exchange, including network failures. Repeated clicks focus the pending tab;
closure or expiry stores cancellation. UI callers poll short runtime messages against durable results, so ten-minute sign-in does not rely on the five-minute worker request limit. Resume callback processing after worker restarts. Tokens
remain worker-owned, local, opaque and serialized under ADRs 0017–0018.

Remove identity permission. Retain Chrome 116 minimum from ADR 0020 for the existing browser
baseline, although the identity API lifecycle exception no longer applies. Suspended workers
have no in-memory caller; persisted expiry is enforced on subsequent events without an alarms
permission. The callback confirms success, closes itself, and the worker focuses the opener.

Chrome blocks top-level web-to-extension navigation unless the callback is web-accessible:
[Chrome documentation](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources).
Expose only this HTML resource to https://devtools.zsetup.com and https://api.devtools.zsetup.com.
Use dynamic URL false: a randomized host would break configured exact redirects. WAR is not a
host permission and adds no permission warning; tabs.create/update/removal events need no tabs
permission. Scripts remain packaged extension resources. No external messaging is enabled.

Refine ADR 0007's toolbar grouping: Export follows Search All Functions in both layouts and
fallback, with no PRO badge and a neutral tooltip. Keep formats and the existing upgrade modal.

## Rationale

The owner wants sign-in in their existing window and a neutral, discoverable export action beside
search. Durable transaction storage replaces reliance on an identity popup's lifetime. Exact
callback matching is shared with cloud ADR 0012; unused chromiumapp.org callbacks are removed.
