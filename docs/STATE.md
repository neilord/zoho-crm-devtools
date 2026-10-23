# STATE — what's happening now

The single living state document for this repository. It is a snapshot, not a changelog; completed
history lives in git and durable reasoning lives in ADRs.

_Last updated: 2026-10-24 — popup redesign, feature-led notice and sign-up hint landed on `main` (unreleased); 2.4.0 store submission remains pending._

## Current status

Version 2.4.0 (optional account, paid plans, Export functions) is on `main` and packaged with
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
| Paid tier and Export functions | release ready (2.4.0) | Optional account via normal-tab OAuth/PKCE, entitlement with Free fallback, Paid-entitlement-gated Export (JSON/CSV/Markdown) beside Search All Functions, upgrade modal, popup account card, one-time notice. Live-checked in an authenticated org. |
| Popup redesign | release ready | Landed on `main`: compact account sheet, Plus/Pro/Max checkout columns from the contract (`billing:openCheckout {plan}`, validated against paid keys → `/app/billing?checkout=<plan>`), single Manage billing (`/app/billing`), signed-out Start free trial + Log in, paywall link renamed "Log in". Trial buttons (popup and paywall) send `billing:signUp`, which adds `screen_hint=signup` so the account site opens /signup; Log in keeps /login (cloud PR #16, deployed and smoke-checked 2026-10-24). The once-only notice now leads with Export functions and Search All Workflows, keeping the account/data disclosure as a fine-print line. 503 tests and `npm run verify` pass; stubbed-`chrome` screenshots of every state. Owner reviewed the reloaded dev popup on 2026-10-23. Not clicked live: Manage billing, plan-column checkout (incl. plan change for an existing subscriber), sign-in-then-checkout. Signed-out + once-only notice is ~760px, so Chrome scrolls once. The sign-up hint was not clicked through in a real extension session. |
| Search All Workflows | release ready | Landed on `main` for any paid plan (ADR 0024); 493 tests and the Chromium harness (`npm run test:e2e:workflows`) pass. Authenticated US-org live acceptance passed on 2026-10-21: 327 rules, ~50 s cold index, cached search usable in ~3 s on reopen, 6 function-source gaps (1 unavailable, 5 name-only). Not verified live: free-user upgrade modal (jsdom only), other DCs, 1024/1280 widths, delete/score/Cliq types. Known nit: after Esc, a scope-chip click then immediate typing can miss search focus. Unreleased; upgrade-modal copy needs owner approval. |
| Agent context | done | Closed docs taxonomy, ADR log, living state, and guardrails are installed. |
| Rare Zoho surfaces | in-progress | Editor mount/settings selectors and less common overlays still need observation as they appear. |

## In flight

- **Three-tier pricing before 2.4.0 submission** — implemented in `fix/billing-three-tiers`
  worktree. Plus/Pro/Max and future non-empty plan keys use server paid entitlement; popup
  names and trial/intro copy use the synced contract. ADR 0023 records the rule. Unit verification:
  300 tests in 27 files, TypeScript, Biome and production build passed; all three isolated
  Playwright checks passed on rerun. First Playwright run observed a transient local-storage
  isolation assertion failure before the successful rebuilt run; no account credentials entered.
  Signed-out modal screenshots at 1280×800 and 375×700 were visually inspected in an isolated
  harness: all copy/actions fit without changing modal styles. `build:dev` passed and owner folder refreshed; previous contents saved to
  `/Users/admin/Developer/zoho-crm-devtools-dev-build-before-three-tiers-20261020-224936`.
  Live check pending: self-reload removed the dev controls; owner must reload the extension
  once in Chrome. Automated access to `chrome://extensions` was blocked by browser policy.
  Do not land until the changed modal is checked in authenticated Zoho. No store submission
  or cloud repository changes performed.

- **2.4.0 store submission** — upload the ZIP, set "Contains in-app purchases", the listing URLs,
  privacy-practice answers and reviewer instructions from
  [`store-listing/2.4.0-submission.md`](store-listing/2.4.0-submission.md), then submit. Before
  submitting, run Chrome's Extension Update Testing Tool against the published build to confirm no
  permission warning. Terms and Privacy on the website are drafts pending owner/legal review.
  Next export work (selection-based export inside the Search All Functions dashboard, cleaner
  Markdown) is a separate effort. The broader billing plan remains on `docs/billing-plan`.
  Preflight on 2026-10-21: another session landed three-tier billing as `0581c44` while release
  checks were running; the regenerated ZIP includes that commit. Chrome Web Store dashboard
  access through Aside requires fresh Google verification. No dashboard fields were changed
  and nothing was uploaded or submitted. The published-build permission-update test and the
  changed modal's authenticated Zoho check remain outstanding.

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

## Blocked

- Nothing blocked.

## Next

1. **CRM functionality map (next major feature)** — a flowchart of everything configured in the CRM (functions, workflows and their relations) to view, sort, filter and understand in one place. Not started; plan it under `docs/plans/` and record scope decisions as an ADR.
2. After 2.3.0 is published, watch the AI Assistant listing's `utm_source=zoho-crm-devtools`
   traffic to judge whether in-extension promotion is worth repeating.
3. Ship the deferred theme-following for the preview: persist the observed Zoho editor theme
   (light/dark) and any selected custom theme, then source the preview palette from
   `--zcdt-theme-editor-*` so it matches the active editor (announced as a follow-up feature).
4. Run a focused live-org regression pass when changing cross-function search or its undocumented
   Zoho endpoints and globals.
5. Capture and cover rare editor overlays only when live evidence exposes an unthemed or fragile
   surface.

## How to update this doc

At the end of each session, update only the rows or sections the work changed. Move completed work
out of "In flight," keep "Next" concrete, and prune finished history. During parallel work, keep
edits section-local; if `STATE.md` conflicts during a merge, preserve both branches' current facts.
