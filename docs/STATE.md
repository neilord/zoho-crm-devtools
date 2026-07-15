# STATE — what's happening now

The single living state document for this repository. It is a snapshot, not a changelog; completed
history lives in git and durable reasoning lives in ADRs.

_Last updated: 2026-07-15 — Deluge syntax highlighting in the function-search preview; preparing the 2.2.0 release._

## Current status

Version 2.1.0 is published with editor themes, indent guides, syntax highlighting, and free
cross-function search. Version 2.2.0 is prepared on `feat/dashboard-preview-highlighting`: the
function-search dashboard preview renders Deluge with syntax highlighting via an own
dependency-free tokenizer (see ADR 0005), using Zoho's native light palette. Awaiting a live-org
visual pass, then squash-merge to `main` and a manual Chrome Web Store upload.

## Status table

| Area | Status | Notes |
|---|---|---|
| Editor enhancements | done | Themes, indent guides, and syntax highlighting are shipped. |
| Cross-function search | done | Search and native-editor handoff shipped in 2.1.0. |
| Dashboard preview highlighting | done | Own Deluge tokenizer highlights the `fs-code` preview using Zoho's native light palette (ADR 0005). Shipping in 2.2.0. Theme-following deferred to a later release (needs the observed editor theme persisted first). |
| Agent context | done | Closed docs taxonomy, ADR log, living state, and guardrails are installed. |
| Rare Zoho surfaces | in-progress | Editor mount/settings selectors and less common overlays still need observation as they appear. |

## In flight

- Nothing in flight.

## Blocked

- Nothing blocked.

## Next

1. Do a live-org visual pass on the function-search preview highlighting against real Deluge
   functions before cutting a release; the tokenizer was verified with unit tests and an isolated
   shadow-root render harness, not yet in an authenticated Zoho session.
2. Run a focused live-org regression pass when changing cross-function search or its undocumented
   Zoho endpoints and globals.
3. Ship the deferred theme-following for the preview: persist the observed Zoho editor theme
   (light/dark) and any selected custom theme, then source the preview palette from
   `--zcdt-theme-editor-*` so it matches the active editor (announced as a follow-up feature).
4. Capture and cover rare editor overlays only when live evidence exposes an unthemed or fragile
   surface.

## How to update this doc

At the end of each session, update only the rows or sections the work changed. Move completed work
out of "In flight," keep "Next" concrete, and prune finished history. During parallel work, keep
edits section-local; if `STATE.md` conflicts during a merge, preserve both branches' current facts.
