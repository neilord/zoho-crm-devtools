# Plan — Automation Map (Pro/Max)

Temporary build plan; retain with the UX spec until release, then fold remaining facts into
STATE/reference docs/ADRs and delete both plans. UX spec:
[`automation-map-ux.md`](automation-map-ux.md). Decisions: ADR 0025 (plan capabilities) and
ADR 0026 (Automation Map architecture).

## Goal

A full-viewport, searchable, filterable map of everything that can run or change data in a Zoho
CRM org, answering "what runs here?" and, as the headline, "what are all the possible ways field
X can be updated?". Pro and Max unlock it; everyone else gets a fogged teaser.

## Scope (v1)

In: workflow rules (all actions), every catalogue function (source + Deluge effects analysis),
custom buttons (function/url/client-script), schedules, REST-API-callable functions, email
notifications and templates, webhooks, field updates and tasks, blueprint transitions (actions +
during-inputs) and approval processes as declared field writers, fields metadata. Settings home
tile (Developer Hub, NEW badge), Workflow Rules toolbar button, dashboard "Show on map", hash
deep link.

Later: client scripts (JS analysis), validation-rule functions, related-list functions, Circuits,
webforms, macros, export of the map, saved views, theme following.

## Contracts

- Graph/UI contract: `src/content/automation-map/types.ts` (frozen; change only through the
  conductor). Pure builder `buildAutomationGraph(inputs: AutomationGraphInputs): AutomationGraph`
  and queries `fieldWriters`, `traceFrom`, `filterNodes`, `buildSearchIndex`/`searchMap`.
- Analyzer: `src/content/automation-map/analyzer` (`analyzeDelugeEffects`, integrated on the feature branch).
- Gate: `hasPlanFeature(entitlement, 'automationMap')` (ADR 0025, integrated on the feature branch).
- Observed endpoints and quirks: `docs/zoho-integration.md`.

## Stages

| Stage | Work | Status |
|---|---|---|
| 0 | Research, capability gate, analyzer, contract | Complete on `feat/automation-map` |
| 1a | Pure graph builder, queries, search and fixtures | Complete |
| 1b | Zoho adapters, progressive store, teaser and worker cache | Complete |
| 1c | UX spec and synthetic prototype | Complete; spec retained until release |
| 2a | Shell, rail, filters, inspector, Fields and List | Complete |
| 2b | Island board, trace and fog renderer | Complete |
| 2c | Settings/toolbar/dashboard entries, deep link and bootstrap | Complete |
| 3 | Lazy integration and packaged Chromium harness | Complete |
| 4 | Independent reviews and authenticated US-org passes | Review fixes integrated; live results and coverage gaps in STATE |
| 5 | Documentation consolidation | Complete; both plans retained until release |
| Owner | Land feature branch | Pending approval |
| Owner | Push/deploy cloud `feat/plan-features` (contract 0.2.0), approve Pro upgrade copy | Pending |
| Owner | Version bump, CHANGELOG, store release, then fold/delete both plans | Pending |

Current verification counts, live evidence and unverified environments live only in
[`../STATE.md`](../STATE.md). No push or landing is part of this documentation task.

## Acceptance

- `npm run verify` green; new unit + jsdom + Playwright harness coverage.
- Live, authenticated US org (read-only): cold load progressive and usable; warm reopen fast;
  field lens for a field with declared + inferred writers; trace; search incl. code; scope toggle;
  teaser for a non-Pro state; settings tile and toolbar entry; native handoffs.
- Coverage is honest: no "all writers" claims; gaps counted.
