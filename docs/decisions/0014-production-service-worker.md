# 0014 — Production service worker for API access

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Add a production service worker and route the content script's API access only through it.
The worker performs the bearer/CORS requests defined in ADR 0012. Currently
`manifest.config.ts` registers `background` only in development mode.

## Rationale

[Chrome's network documentation](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
states that content-script requests use the host page's origin and CORS rules. Calling our API
directly would use Zoho's origin rather than the allowlisted extension origin. The worker uses
the extension origin; ordinary server-approved CORS avoids requiring new host privileges.

## Consequences

- Implement a narrow, validated message API for entitlement operations, not an arbitrary URL
  proxy; keep bearer tokens inside extension contexts.
- Adding the manifest `background` key is not adding a permission, so no warning is expected.
  This is an inference from the
  [permission-warning model](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings),
  not an explicit guarantee about that key. Verify with Chrome's Extension Update Testing Tool
  against the currently published build before submission.
- Account for worker suspension and restart; durable token storage and entitlement fallback
  cannot depend on worker memory. Development reload infrastructure must remain development-only.
