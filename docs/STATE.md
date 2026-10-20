# STATE — what's happening now

The single living state document for this repository. It is a snapshot, not a changelog; completed
history lives in git and durable reasoning lives in ADRs.

_Last updated: 2026-10-20 — 2.4.0 (account, Pro plan, Export functions) landed on `main` after live acceptance; store submission next._

## Current status

Version 2.4.0 (optional account, Pro plan, Export functions) is on `main` and packaged with
`npm run zip`. Production manifest: `storage` only, no host permissions, a module service worker,
Chrome 116 minimum. Verification: 274 tests, TypeScript, Biome, production build. 2.3.0 was
submitted to the Chrome Web Store before this release. The backend and website
(https://devtools.zsetup.com, https://api.devtools.zsetup.com) are live in the private
`zsetup/zoho-crm-devtools-cloud` repository, with Stripe in **live** mode.

Live acceptance on 2026-10-20 in an authenticated US org (~918 functions, read-only): Search All
Functions and Export render side by side in the new toolbar; signed-out Export opens the upgrade
modal; "Start free trial" signs in through a normal adjacent tab and resumes the export; JSON, CSV
and Markdown downloads each contained 836 functions plus an explicit list of 82 that Zoho would not
return source for (all lacked a `source` value in the list response; cause unconfirmed); Search All
Functions still works. Not checked
live: popup account card states, disconnect, and the existing-user notice (covered by jsdom tests).

Listing copy and paste-ready dashboard/privacy/reviewer/What's new fields are in
[`store-listing/2.4.0-submission.md`](store-listing/2.4.0-submission.md).

## Status table

| Area | Status | Notes |
|---|---|---|
| Editor enhancements | done | Themes, indent guides, and syntax highlighting are shipped. |
| Cross-function search | done | Search and native-editor handoff shipped in 2.1.0. |
| AI Assistant promo card | release ready | One-time corner card on any CRM page, max two impressions, 3-day snooze once, sync-stored (ADR 0008). Uses the assistant's inlined icon and a DOM-built mini side-panel illustration (no image assets). Live-checked: render, bottom-bar clearance, snooze persistence, Install opens the tagged store URL and ends the card. Shipping in 2.3.0. |
| New Functions toolbar | release ready | Search All Functions sits beside the new native Search field. Legacy placement is unchanged (ADR 0007). Version 2.2.1 is verified and packaged; Chrome Web Store publication is pending. Live checks covered both versions of an authenticated EU org, version switches, reloads, dashboard opening, and a 1280px viewport. |
| Dashboard preview highlighting | done | Own Deluge tokenizer highlights the `fs-code` preview using Zoho's native light palette (ADR 0005). Shipping in 2.2.0. Theme-following deferred to a later release (needs the observed editor theme persisted first). |
| Paid tier and Export functions | release ready (2.4.0) | Optional account via normal-tab OAuth/PKCE, entitlement with Free fallback, Pro-gated Export (JSON/CSV/Markdown) beside Search All Functions, upgrade modal, popup account card, one-time notice. Live-checked in an authenticated org. |
| Agent context | done | Closed docs taxonomy, ADR log, living state, and guardrails are installed. |
| Rare Zoho surfaces | in-progress | Editor mount/settings selectors and less common overlays still need observation as they appear. |

## In flight

- **2.4.0 store submission** — upload the ZIP, set "Contains in-app purchases", the listing URLs,
  privacy-practice answers and reviewer instructions from
  [`store-listing/2.4.0-submission.md`](store-listing/2.4.0-submission.md), then submit. Before
  submitting, run Chrome's Extension Update Testing Tool against the published build to confirm no
  permission warning. Terms and Privacy on the website are drafts pending owner/legal review.
  Next export work (selection-based export inside the Search All Functions dashboard, cleaner
  Markdown) is a separate effort. The broader billing plan remains on `docs/billing-plan`.

- Growth planning: reviewed the authenticated GA4 listing-acquisition reports and Chrome Web
  Store developer metrics. A private task report proposes search-led positioning, partner/trainer
  distribution, practical tutorials, and a capped paid experiment toward 1,000 store users.
  Detailed account analytics remain outside the public repository. The settled September 6–12
  read confirms the ZUG CommunitySpaces source was the week's largest acquisition channel and
  directly produced three install events. The live public installed-user count increased, but the
  developer-dashboard session still requires fresh authentication, so uninstall and weekly-user
  detail remain unverified. Next: use the observed community conversion as evidence for the next
  distribution experiment while keeping store visitors, reported installs, installed users, and
  actual feature usage as separate measures.
- Community outreach: introductions are published in both the Admins and Developers ZUG spaces.
  The [Admins post](posts/2026-09-09-admins-zug-search-all-functions.md) is retained locally; the
  Developers post URL/final copy has not yet been recorded. Zoho confirmed that its weekly
  Community Digest and monthly Developer Community Digest exclude third-party tools, including
  free and Marketplace-approved tools. Continue relevant disclosed participation under ADR 0006.
  Next Zoho-owned opportunities to validate are an educational Developer Hangout, ZUG meetup
  sponsorship, and eligibility for Zoho One's browser-extension catalog. ADR 0003 still prohibits
  per-release Forum topics.

## Owner polish — 2026-10-20

Normal-tab OAuth and neutral adjacent toolbar Export implemented under ADR 0021. Cloud contract
uses the exact extension callback; copied into this branch. `npm run verify` passes 266 tests, TypeScript, production build and Biome (five unchanged bridge warnings).
`npm run build:dev` passed; output copied to `/Users/admin/Developer/zoho-crm-devtools-dev-build`,
with pinned id `lkgcneekmlnpcjcfeieehpokgmefpdde`. Both authenticated legacy and new Functions
views were checked for adjacent, level-aligned Export, no badge, neutral tooltip and a visible
three-format menu. Zoho's overflow clipping required fixed, viewport-clamped menu positioning;
no native styles were changed. New Functions view restored. Backend source `952a913` is pushed
on cloud main; its [CI/deployment](https://github.com/zsetup/zoho-crm-devtools-cloud/actions/runs/39419136680) succeeded, with post-rollout readiness HTTP 200. Final Chrome auth round trip remains manual after
reloading the final copied candidate; no claim of completed login/export downloads. Extension
stays committed on `feat/billing-frontend`, unmerged and unpublished.

## Live sign-in failure — 2026-10-20

The owner Chrome profile immediately reached OAuth callback using an existing website session.
A debugger capture identified native `WorkerGlobalScope.fetch` throwing `Illegal invocation`: the
client stored unbound native fetch and invoked it as an instance method. Bind the default fetch to
`globalThis`, fixing token, entitlement and revoke transport. Callback consumption previously wrote
`cancelled` even before exchange; it now persists `failed` before exchange, with separate provider
failure/access-denial outcomes and distinct popup/modal messages. Dev-only diagnostics log safe
stage/error categories, never credentials. Sender-id validation already permits own content scripts;
trusted session storage remains worker-only and needs no content-script access-level expansion.

`npm run verify` passes 273 tests in 27 files, TypeScript, production build and the five existing
Biome warnings. Two new isolated Playwright extension checks pass against production: popup and
content Export → JSON → trial, adjacent login tab with OAuth query preserved, cancellation, storage
isolation, and synthetic invalid-code callback reaching token HTTP 400 through native fetch. Unit
tests cover successful callback/exchange, restart, replay and content sender/token isolation. Curl
authorize returns 302 to login for the exact pinned dev redirect; server provisioning and the client
agree on `chrome-extension://<id>/src/billing/oauth-callback.html`. No backend change was needed.

The refreshed owner dev-build folder was reloaded in Chrome and the authenticated Zoho Functions
page reloaded; Export → JSON shows the signed-out trial modal. No account was created or credentials
entered; successful owner login and real exports remain acceptance checks. The failed pre-fix
callback was inspected without logging codes or tokens. Version stays 2.4.0; branch remains unmerged
and unpublished. The release ZIP is regenerated with this fix.

## Export detail failures and status layout — 2026-10-20

Owner evidence of successful pagination followed by detail 503s exposed export's abort-on-first-error
policy. Search and export share the same URL/source/header contract; search uses cached details and
tolerates failures. Zoho's underlying 503 cause remains unconfirmed. No source remapping or alternate
endpoint was introduced. ADR 0022 supersedes the all-or-nothing policy with explicit partial exports.

Export keeps four workers, retries 429/5xx three times with exponential backoff/jitter and Retry-After,
and includes every unreadable identity/reason in JSON `skipped`, CSV error rows and Markdown's "Not
exported" section. Failed lists, zero readable sources, cancellation and navigation prevent download.
The trigger stays visible at its original size; a separate anchored 320px card wraps progress/results/
errors with actions on their own row. Success dismisses at six seconds; errors persist until dismissed.

`npm run verify` passes 274 tests in 27 files, TypeScript and production build, with five unchanged
bridge lint warnings. The isolated Playwright new-toolbar harness passes at 1280px: unchanged button
bounds, popover geometry, progress, persistent error/retry, 915/918 partial result and auto-dismissal.
Screenshots were visually inspected and saved outside the repo in the requested `export-fix` scratchpad.
`npm run build:dev` passes; the owner dev-build folder is refreshed and its prior contents moved to
`/Users/admin/Developer/zoho-crm-devtools-dev-build-before-export-fix-20261020-215222`.
`npm run zip` regenerates the 2.4.0 release candidate. No real-org requests or function writes were
performed. The required authenticated Zoho export/both-toolbar acceptance remains outstanding;
keep this work committed on `feat/billing-frontend`, unmerged and unpublished.

## Blocked

- Nothing blocked.

## Next

1. After 2.3.0 is published, watch the AI Assistant listing's `utm_source=zoho-crm-devtools`
   traffic to judge whether in-extension promotion is worth repeating.
2. Ship the deferred theme-following for the preview: persist the observed Zoho editor theme
   (light/dark) and any selected custom theme, then source the preview palette from
   `--zcdt-theme-editor-*` so it matches the active editor (announced as a follow-up feature).
3. Run a focused live-org regression pass when changing cross-function search or its undocumented
   Zoho endpoints and globals.
4. Capture and cover rare editor overlays only when live evidence exposes an unthemed or fragile
   surface.

## How to update this doc

At the end of each session, update only the rows or sections the work changed. Move completed work
out of "In flight," keep "Next" concrete, and prune finished history. During parallel work, keep
edits section-local; if `STATE.md` conflicts during a merge, preserve both branches' current facts.
