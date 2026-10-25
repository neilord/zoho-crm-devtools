# STATE — what's happening now

The single living state document for this repository. It is a snapshot, not a changelog; completed
history lives in git and durable reasoning lives in ADRs.

_Last updated: 2026-10-26 — Automation Map is gated as Coming soon / Pro waitlist (PR #3, ADR 0035; store listing, privacy and changelog updated). The website pricing pages show a Coming soon badge (cloud PR #20, deployed). The 2.4.0 ZIP was rebuilt with the gate (SHA-256 `e827b59886369f9e7a80d02f47f6d3d55ca490d5c5dddd6d0126e58f0c698f83`); the owner waived the agent live Zoho check and will eyeball it. Earlier: production read-only acceptance passed in Andrew for the announcement, account, all exports, both searches and full Automation Map. Release-fix PR #2 is verified; store submission and the permission-update test remain pending._

## Current status

Owner-requested complimentary Pro access was applied in the private production backend on
2026-10-24 using the existing no-card local-trial mechanism through 2099-12-31. The production
resolver confirmed `pro` and `entitled: true`; no Stripe customer/subscription or charge was
created. Account identifiers and the pre-change rollback record remain outside this public repo.
The account UI can still describe this grant as a trial; extension entitlement caching lasts up
to five minutes. No application code or deployment changed (status note only).

Version 2.4.0 (optional account, paid plans, Export functions) is on `main` and packaged with
`npm run zip`. Production manifest: `storage` only, no host permissions, a module service worker,
Chrome 116 minimum. Verification: 1,261 tests, TypeScript, Biome, production build. 2.3.0 was
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
| What's new card | live acceptance passed; unreleased | Corner card announcing Search All Workflows, Automation Map (**Coming soon**, ADR 0035) and Export functions, with an interactive hero that previews each tool on row hover/focus/tap. Shows on every CRM org page load until Got it, close or any link click; sync-stored under `whatsNewWorkflowTools2026`, and other tabs drop it on acknowledgement. The AI Assistant promo waits while it is pending (ADR 0034). Verified by `npm run verify` (1,261 tests) and production live acceptance: render, bottom-bar clearance, map-link navigation from Functions, acknowledgement persistence and map layering. |
| AI Assistant promo card | release ready | One-time corner card on any CRM page, max two impressions, 3-day snooze once, sync-stored (ADR 0008). Uses the assistant's inlined icon and a DOM-built mini side-panel illustration (no image assets). Live-checked: render, bottom-bar clearance, snooze persistence, Install opens the tagged store URL and ends the card. Shipping in 2.3.0. |
| New Functions toolbar | release ready | Search All Functions sits beside the new native Search field. Legacy placement is unchanged (ADR 0007). Version 2.2.1 is verified and packaged; Chrome Web Store publication is pending. Live checks covered both versions of an authenticated EU org, version switches, reloads, dashboard opening, and a 1280px viewport. |
| Dashboard preview highlighting | done | Own Deluge tokenizer highlights the `fs-code` preview using Zoho's native light palette (ADR 0005). Shipping in 2.2.0. Theme-following deferred to a later release (needs the observed editor theme persisted first). |
| Paid tier and Export functions | release ready (2.4.0) | Optional account via normal-tab OAuth/PKCE, entitlement with Free fallback, Paid-entitlement-gated Export (JSON/CSV/Markdown) beside Search All Functions, upgrade modal, popup account card, one-time notice. Live-checked in an authenticated org. |
| Popup redesign | release ready | Landed on `main`: compact account sheet, Plus/Pro/Max checkout columns from the contract (`billing:openCheckout {plan}`, validated against paid keys → `/app/billing?checkout=<plan>`), single Manage billing (`/app/billing`), signed-out Start free trial + Log in, paywall link renamed "Log in". Trial buttons (popup and paywall) send `billing:signUp`, which adds `screen_hint=signup` so the account site opens /signup; Log in keeps /login (cloud PR #16, deployed and smoke-checked 2026-10-24). The once-only notice now leads with Export functions and Search All Workflows, keeping the account/data disclosure as a fine-print line. 503 tests and `npm run verify` pass; stubbed-`chrome` screenshots of every state. Owner reviewed the reloaded dev popup on 2026-10-23. Manage billing and production OAuth sign-out/login passed on 2026-10-25. Not clicked live: plan-column checkout (incl. plan change for an existing subscriber), sign-in-then-checkout. Signed-out + once-only notice is ~760px, so Chrome scrolls once. The sign-up hint was not clicked through in a real extension session. |
| Search All Workflows | release ready | Landed on `main` for any paid plan (ADR 0024); 493 tests and the Chromium harness (`npm run test:e2e:workflows`) pass. Authenticated US-org live acceptance passed on 2026-10-21: 327 rules, ~50 s cold index, cached search usable in ~3 s on reopen, 6 function-source gaps (1 unavailable, 5 name-only). Not verified live: free-user upgrade modal (jsdom only), other DCs, 1024/1280 widths, delete/score/Cliq types. Known nit: after Esc, a scope-chip click then immediate typing can miss search focus. Unreleased; upgrade-modal copy needs owner approval. |
| Automation Map | code on `main` (`b270898`); **gated as Coming soon** (PR #3, ADR 0035); agent live check waived by the owner, who will eyeball it | Every entry opens a Pro waitlist popup (static preview; signed-out/Free/Plus/Pro-Max states) instead of the map; the runtime is never loaded. Toolbar button, Setup entries and the What's new row say Coming soon. One switch, `AUTOMATION_MAP_COMING_SOON`, restores the map; the overlay's own Beta chip is kept but unreachable. `npm run test:e2e:automation-map` builds with `VITE_AUTOMATION_MAP_COMING_SOON=off`. Needs a live check of the popup, checkout hand-off and Setup/toolbar badges (unit tests and stubbed-`chrome` screenshots only). Earlier: integrated Pro/Max map and bounded fog teaser; acceptance and remaining owner steps below. Verified by `npm run verify`, the Chromium harness and full-Pro production acceptance on 2026-10-25 (Board/List/search/inspector/trace/field lens/warm reopen; partial coverage stays explicit). |
| Agent context | done | Closed docs taxonomy, ADR log, living state, and guardrails are installed. |
| Rare Zoho surfaces | in-progress | Editor mount/settings selectors and less common overlays still need observation as they appear. |

## In flight

- **Final 2.4.0 acceptance — 2026-10-25:** resumed Claude Code's "Release announcement
  notification design" session (`c06a20c0-0016-4b90-9413-9b4173444a80`). It explicitly keeps
  the unsubmitted release at **2.4.0**, including the map and announcement; this supersedes
  the older separate-map-release note below.
  - Loaded production `dist-local` in the **Andrew** Chrome profile through native computer use,
    replacing its unpacked dev-build path. Verified Pro account rendering, Sign out → Free,
    fresh OAuth login via the website session → Pro, callback tab closure, and Manage billing
    navigation. No purchase or subscription was created. The complimentary grant still displays
    as a long Pro trial (known grant representation).
  - `npm run verify` passes (1,261 tests). Workflow packaged regression passes. Map checks pass
    across the full run's eight successful cases plus a focused corrected teaser rerun: full and
    teaser, browser/worker restart, history, persistent-503 warm cache/Retry/Refresh and 1440/1024
    large-org visual states. The initial sandbox Chromium launch aborted; tests passed outside
    the sandbox. The teaser check now flies to the revealed module before expecting cards in
    the zoomed-out overview.
  - Found/fixed a real interaction bug: a delayed announcement shared the map's z-index and
    intercepted Refresh. Map now sits above corner cards and below the upgrade modal; the
    packaged regression requires the announcement to be visible while clicking Refresh.
  - Production Chromium with synthetic CRM fixtures passed announcement hover/focus previews,
    1280×657 and 375×700 layout (card clears the 56px bottom inset), map-link navigation from
    Setup, cross-tab acknowledgement and reload persistence. Screenshots were visually inspected
    outside the repo. This does **not** replace authenticated Zoho acceptance.
  - `PRIVACY.md` now covers workflow/map reads and local caches plus synced announcement state.
    Matching website disclosure fix: private cloud PR #19 merged as `65b1fb6`; production
    workflow `40195756769` succeeded. Live privacy page contains the workflow/IndexedDB text
    (HTTP 200); API readiness is HTTP 200. No new permissions or data destinations.
  - Authenticated production acceptance passed in Andrew after reloading `dist-local`, with the
    owner's explicit **no CRM writes** constraint. Only configuration reads and local analysis/
    downloads were exercised: no Save, Run/Execute, trigger, record or configuration mutation.
    Announcement renders above Zoho's bottom bar, its map link navigates from Functions to the
    workflow route and opens the full Pro map; it stays acknowledged on subsequent navigation.
    Map: 327 rules / 924 functions / 182 modules, 273 explicit coverage gaps; settled Board,
    List, search (including code), inspector, trace, field lens and warm reopen all work. Gaps
    include 82 unavailable sources, 168 partial analyses and configuration reads Zoho did not
    return; completeness is not claimed. Workflow search settles at 327 rules / 6 gaps and finds
    criteria and linked-source matches. Search All Functions and its source preview still work.
    JSON, CSV and Markdown downloads each account for 924 catalog entries: 842 sources plus
    82 explicit skipped/error entries. Local files were parsed for structure/counts; no client
    data, source, screenshots or identifiers were added to the repo.
  - Owner approved the public branch push; it succeeded. [Release-fix PR #2](https://github.com/neilord/zoho-crm-devtools/pull/2)
    has green CI; production dependency audit reports zero known vulnerabilities.
  - **Remaining before store submission:** Chrome's Extension Update Testing Tool against the
    published 2.3.0 build. Manifest comparison passed: `storage` only, no added required/optional
    permissions or hosts, identical content-script matches. The official tool is prepared in a
    temporary directory, but its macOS Chrome install flow needs device policy (or Chromium);
    no OS policy was changed. A completed live payment → webhook → entitlement remains unverified
    (test-mode lifecycle and live catalog configuration were checked previously). The store dashboard is now reachable through native computer use in the requested DevTools
    profile, but Google requires password/MFA re-verification; the owner was asked to complete it.
    Nothing was uploaded/submitted. `npm run zip` rebuilt the 2.4.0 production candidate with
    the stacking fix, correct worker, no pinned key or dev entries, `storage` only and no host
    permissions (SHA-256 `81675eb9…`). **Superseded 2026-10-26:** rebuilt from `feat/automation-map-coming-soon` (`909a9dc`) with the map gated: 2.4.0, `storage` only, no host permissions or key, loader imports `worker.ts-*`, SHA-256 `e827b59886369f9e7a80d02f47f6d3d55ca490d5c5dddd6d0126e58f0c698f83`.


- **Production service-worker fix** — landed on `main` (`cdb927f`). Every production build since the worker was added had `service-worker-loader.js` import
  the content-script chunk: CRXJS named both `src/background/index.ts` and `src/content/index.ts`
  chunks `index.ts-*` and the loader picked the wrong one. The worker never answered, so the
  popup account card and the Automation Map stayed on "Checking your plan…". Dev builds were
  unaffected (their worker entry has another name), which is why live acceptance missed it. The
  repo-root `zoho-crm-devtools.zip` was rebuilt from `b03c0a2` on 2026-10-25 (loader imports `worker.ts-*`; includes the What's new card); the earlier defective 2.4.0 ZIP is gone. Fix: worker
  entry renamed to `src/background/worker.ts`, a build guard fails when a loader imports the wrong
  chunk (proved by reintroducing the collision), and `npm run build:local` builds production code
  with the pinned unpacked key into `dist-local`. Verified: `npm run verify` (1,242 tests); headless
  Chromium with `dist` and `dist-local` both answer `billing:getEntitlement` and render the
  signed-out account card; an API call from the path-id `dist` worker fails CORS while the pinned
  id (`lkgcneekmlnpcjcfeieehpokgmefpdde`) gets HTTP 401 (allowed). Owner's Chrome with `dist-local` and fresh sign-in passed on 2026-10-25 (final acceptance above);
  the 2.4.0 ZIP must be rebuilt after the remaining release fix lands. The popup showed "Open Zoho CRM to use tools" on a CRM tab in the owner's
  report; not investigated.

- **Automation Map polish and performance** — landed on `main` (squashed, ADR 0033); not released.
  Owner accepted the teaser live check as sufficient on 2026-10-24: Arc/Dia-style shell (sliding view indicator, custom checkboxes, glass banner,
  popovers and zoom bar, inspector slide, focus rings), sparse/tonal zoom tiers with opacity
  crossfades, softer edges beneath titles, glass hover card and minimap, "1 rule" plurals, bounded
  fog (fixes the hard rectangular slabs), teaser rail/List fog counts agree, and the per-frame
  render budget. 330-rule fixture: pan style recalc 4.7ms→0.1ms per frame, slow zoom frames at 32%
  62→1–3 of 120, search work over 20 keys 437ms→119ms. Verified: `npm run verify`,
  `npm run test:e2e:automation-map`, two independent screenshot reviews against a baseline, and a
  read-only live pass in the owner's org, which is in **teaser** mode (no console errors; fog has no
  slabs; inspector framing good). Full (Pro) production mode passed live on 2026-10-25 (final acceptance above). Known open:
  floating chrome can overlap content after a user zoom or pan; at 1024px a column can touch the
  inspector at the 45% floor; wheel can pan into empty space (no pan limits); the zoom readout jumps
  to its final value during a glide; Upgrade CTA count unchanged (owner decision); dagre worker,
  hidden-view detach and minimap batching not done. Visual states: Playwright `-g "visual states"`
  with `AM_SHOTS`; perf: `playwright.automation-map-perf.config.ts`.

- **Automation Map** — landed on `main` as one squashed commit (`b270898`, ADRs
  0025–0032); not released. Latest automated verification: `npm run verify` passed
  **1,242 tests across 75 files**, TypeScript, Biome (one existing bridge warning) and production
  build; `npm run test:e2e:automation-map` **5/5** (incl. read-free warm reopen with persistent
  503s, targeted cached Retry, browser/worker restart, Back/Copy link); `npm run test:e2e:workflows`
  passed. Three authenticated, read-only passes in a US org (**327 rules / 923 functions**)
  confirmed: progressive cold indexing (~73–110 s, ~800 requests), warm reopen with **0 Zoho
  requests** inside the 15-minute window (data in ~130–230 ms, also after tab reload); declared and
  inferred writers checked against native configuration and source; chip/lens/group/aria-live
  counts agree; hash/Back/Forward and deep links; Show on map framing; search incl. code; native
  handoffs; no extension console errors; 1280×657 layout. Teaser: one revealed flow, 11 CRM reads,
  0 hidden workflow/function names across Board/List/Fields, Pro-only upgrade copy. The native
  NEW sparkle (Zoho's own `crmNewReleaseLoader_1/2/3` classes and animation, 32 px rows) was
  verified live by computed geometry; fresh live screenshots of the final build and fog were not
  possible (the display stopped rendering), so final fog/framing visuals are verified headless only.
  Persistent Zoho HTTP 503s on some blueprint-transition, approval-rule, custom-button and
  field-metadata reads remain explicit, retryable coverage gaps (paths match research; no
  client-side fix evidenced); 271 gaps live are mostly functions with partial/limited analysis.
  Not verified: other DCs, legacy Workflow UIs, very large orgs beyond this one.
  Remaining: the owner subsequently chose to include the map in the still-unsubmitted 2.4.0
  release (see final acceptance above); CHANGELOG already reflects it. Push/deploy cloud `feat/plan-features` for authoritative
  server feature lists (contract **0.2.0**); store release with matching version bump and
  CHANGELOG; owner approval of Pro-specific upgrade copy. Other DCs and legacy UIs, a real
  screen reader and trackpad remain unverified; client-script analysis is out of scope.
  Keep [`plans/automation-map.md`](plans/automation-map.md) and
  [`plans/automation-map-ux.md`](plans/automation-map-ux.md) until release, then fold remaining
  durable facts into their reference/ADR homes and delete both plans.

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

- **Release readiness check, 2026-10-25** (read-only, `e2bd1ba`):
  - **Passed:**
    - Live Stripe has three active DevTools products and prices ($23/$57/$143 monthly), plus once-coupons that match the $9/$35/$99 intro prices.
    - The account has `charges_enabled` and `payouts_enabled`, and the live webhook is enabled at `api.devtools.zsetup.com` for the four handled events.
    - API `/health` returns 200, and the pricing page lists all three paid features.
    - The ZIP is 2.4.0, `storage` only, and its worker hash equals a fresh `build:local`.
    - The production entitlement DTO has no `features` field, so the client falls back to the bundled 0.2.0 contract and Pro/Max get the map.
  - **Not passed or not verified:**
    - `npm run verify` failed twice in full runs on one test, the `workflow-search` 500-rule timing check (median 49/55 ms against a 40 ms bound). It passes alone, so it is a load-sensitive bound, not a product bug.
    - There are **zero live DevTools subscriptions**, so no real purchase → webhook → entitlement has ever completed.
    - Nothing in the production build has been live-tested in Zoho: sign-in, the What's new card, Automation Map full mode.
    - PRIVACY.md and the website privacy page don't mention the workflow caches or the Automation Map IndexedDB cache, though the store copy does.
    - The obsolete TEST webhook `we_1USYwvExZf6RntHfovTwGoJS` is still enabled.
    - The Plus product carries stale metadata `plan: pro`. The API reads only `plan_key`.
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

1. **CRM functionality map — in progress** as [Automation Map](plans/automation-map.md) on
   `main` (unreleased); see its In flight entry for acceptance and owner release steps.
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
