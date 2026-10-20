# 0022 — Resilient partial function export

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Supersede ADR 0019's refusal of partial downloads. Export fresh readable functions and explicitly
list every unreadable function in every format: JSON `skipped` entries with id/name/apiName/reason,
CSV identity/error rows, and Markdown's "Not exported" section. Report successful/total/skipped
counts in the UI. Failed/malformed lists, zero readable functions, cancellation and navigation
still prevent downloads. Keep four concurrent details and retry 429/5xx up to three times with
exponential backoff, jitter and Retry-After. Preserve the list item's source; no speculative fallback.

Keep Export visible at its original size. Render wrapped progress/results/errors in a fixed,
viewport-clamped popover below it, with actions on a separate row. Success dismisses after six
seconds; errors persist until dismissed or retried.

## Rationale

A few detail 503s in a large real org currently discard all successful reads. Search's cache and
failure tolerance can hide these failures despite sharing the exact request contract. Explicit
skipped accounting makes a useful partial export honest without claiming a complete backup.
Unverified alternate sources/endpoints could return the wrong data. A separate popover escapes
Zoho toolbar clipping and prevents long messages from squeezing the trigger or action controls.

## Consequences

Local-only data and existing entitlement/privacy boundaries remain unchanged. Consumers should
inspect skipped entries before treating exports as complete; JSON schema version 1 adds `skipped`
without changing successful function records. Real-org verification remains a release gate.
