# 0026 — Automation Map architecture

- **Status:** Accepted
- **Date:** 2026-10-24

## Decision

Ship Automation Map as an additive Pro/Max feature (ADR 0025 capability `automationMap`): a
full-viewport, extension-owned Shadow DOM overlay on the Zoho CRM origin, opened from a Settings
home tile (Developer Hub, NEW badge), the Workflow Rules toolbar, the workflow dashboard and a URL
hash deep link. It maps workflow rules, every catalogue function, custom buttons, schedules,
REST-API-callable functions, email notifications/templates, webhooks, field updates, tasks,
blueprint transitions and approvals, grouped by module.

Read configuration only through same-origin authenticated GET requests, composing the existing
workflow index and adding a context-safe all-function provider. Analyze Deluge locally with the
extension's own tokenizer-based effects analyzer; never execute code, contact configured
destinations, add permissions, or send CRM data to the billing backend.

Present inferred behavior as *possible*. Every inferred edge carries evidence (declared,
inferred, unresolved), analyzer confidence and source spans. The field lens separates exact
writers, possible writers (unknown field set) and unresolved writers (unknown module), states
analysis coverage gaps, and reminds users that manual edits, imports and integrations also
change fields.

Non-Pro users (signed-out, Free, Plus including trial) get a fog teaser. The teaser may read only
list metadata (function catalogue list, workflow rule list, modules) plus bounded details for one
revealed island. Fogged regions are rendered from a structure that carries counts and opaque slot
numbers only, so the DOM cannot leak names, criteria or code. This narrows ADR 0024's "gate before
CRM reads" for this teaser only; full detail/source reads and the map cache require the capability.

Lay out module islands deterministically in lanes (entry points → rules → actions → resources →
effects) with semantic zoom, collapsed hub functions and cross-module portal stubs. Use
`@dagrejs/dagre` (MIT), the extension's first runtime dependency, only for small trace and field
flows. Never render the whole-estate graph at once; a list view is the complete, accessible twin.

## Rationale

Admins debug "why did this field change?" across workflows, buttons, schedules, blueprints and
functions that Zoho shows on separate screens. Composing the existing index keeps one identity
and caching model (ADR 0024). The function catalogue's `associated_place` and `tasks` metadata
provide edges and write counts cheaply, which makes an honest teaser possible without reading
source. Silhouette-only fog protects the paid boundary better than CSS blur. Deterministic lanes
scale and stay stable between reloads; general graph layout is reserved for subgraphs where it
reads best. Research found hairball estate maps and silent false negatives to be the main
failure modes of comparable tools.

## Consequences

- The extension gains a runtime dependency; keep it scoped to the map bundle and justify any other.
- Map caches follow the workflow cache model: origin+org partitioned, compressed, bounded, advisory.
- New Zoho endpoints and their quirks (19-digit numeric ids, label-valued modules, post-paging
  filtering, 204 empty results) live in `zoho-integration.md` and need live regression checks.
- Client scripts, validation-rule functions and other surfaces remain out of scope until added
  with their own evidence.
