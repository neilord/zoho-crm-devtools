# 0028 — Automation Map integration and bounded flow preview

- **Status:** Accepted
- **Date:** 2026-10-24

## Decision

Refine ADR 0026's revealed-island teaser to one representative active rule chain. Choose the
existing eligible module deterministically, then prefer a rule associated with a catalogue
function that declares CRM write tasks, otherwise a rule with known actions, otherwise the first
active rule. Do not probe other rules to improve the preview. Allow one rule detail, two action
resources and at most one exactly joined function source. Omitted rules/functions remain numeric
fog counts, including siblings in the revealed module. Publish only the selected flow and explicit
catalogue projections; never reuse full-mode cache in the teaser.

Load the map runtime (store, analyzer, graph, port, shell and canvas) on first open with a dynamic
import from the isolated-world content entry. Keep dagre's separate dynamic import for Trace.
Use CRXJS's generated web-accessible chunk declarations; packaged Chromium checks must prove the
chunks execute from the extension origin. Do not use the MAIN-world content loader for this.

The List twin derives eligible node identities from the board model, preserving island-level
module selection, trigger/flag seeds plus reach, and shared resources. Search intersects that
same visible set and must observe port-index readiness independently of graph identity.

Show NEW through the compile-time UTC date `2027-01-31`, inclusive. Do not persist dismissal or
first-open state. Development may force full or teaser access; force-teaser wins, and production
ignores both flags. Close existing function/workflow search overlays and upgrade dialogs before mounting the map.

## Rationale

A whole-module preview was too expensive and contradicted the four-detail-read UX budget. Reverse
catalogue associations provide a cheap useful selection without letting users walk other flows.
Explicit projections protect both the serialized snapshot and DOM. Lazy imports keep map-only
work off ordinary pages; checking actual packaged scripts catches page-origin import failures
that jsdom cannot. Sharing the board model prevents accessible and visual views from disagreeing.
A fixed badge deadline avoids another storage channel and lifecycle.

## Consequences

The packaged harness covers full/forced teaser modes, source search, dagre, real worker IndexedDB,
warm reopening with CRM responses blocked, entry points, overlay handoff, focus and privacy.
The teaser intentionally omits actions beyond its resource budget and never reads templates.
Authenticated Zoho visual/endpoint acceptance remains a separate release check.
