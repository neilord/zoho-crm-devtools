# STATE — what's happening now

The single living state document for this repository. It is a snapshot, not a changelog; completed
history lives in git and durable reasoning lives in ADRs.

_Last updated: 2026-09-16 — version 2.2.1 packaged for Chrome Web Store submission._

## Current status

Version 2.2.0 remains published on the Chrome Web Store (listing checked September 8). Version
2.2.1 is built and packaged for submission with the new Functions toolbar compatibility fix; its
Chrome Web Store publication remains pending. The release zip contains only the current production
build and the store-listing description is ready. No product implementation is in flight.

## Status table

| Area | Status | Notes |
|---|---|---|
| Editor enhancements | done | Themes, indent guides, and syntax highlighting are shipped. |
| Cross-function search | done | Search and native-editor handoff shipped in 2.1.0. |
| New Functions toolbar | release ready | Search All Functions sits beside the new native Search field. Legacy placement is unchanged (ADR 0007). Version 2.2.1 is verified and packaged; Chrome Web Store publication is pending. Live checks covered both versions of an authenticated EU org, version switches, reloads, dashboard opening, and a 1280px viewport. |
| Dashboard preview highlighting | done | Own Deluge tokenizer highlights the `fs-code` preview using Zoho's native light palette (ADR 0005). Shipping in 2.2.0. Theme-following deferred to a later release (needs the observed editor theme persisted first). |
| Agent context | done | Closed docs taxonomy, ADR log, living state, and guardrails are installed. |
| Rare Zoho surfaces | in-progress | Editor mount/settings selectors and less common overlays still need observation as they appear. |

## In flight

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

1. Ship the deferred theme-following for the preview: persist the observed Zoho editor theme
   (light/dark) and any selected custom theme, then source the preview palette from
   `--zcdt-theme-editor-*` so it matches the active editor (announced as a follow-up feature).
2. Run a focused live-org regression pass when changing cross-function search or its undocumented
   Zoho endpoints and globals.
3. Capture and cover rare editor overlays only when live evidence exposes an unthemed or fragile
   surface.

## How to update this doc

At the end of each session, update only the rows or sections the work changed. Move completed work
out of "In flight," keep "Next" concrete, and prune finished history. During parallel work, keep
edits section-local; if `STATE.md` conflicts during a merge, preserve both branches' current facts.
