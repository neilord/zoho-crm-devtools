# 0032 — Automation Map settled freshness and entity counts

- **Status:** Accepted
- **Date:** 2026-10-24

## Decision

Supersede ADR 0029's requirement that failed dependencies invalidate freshness. A complete
revalidation pass establishes freshness when it settles, even when some reads failed. Persist
those failures, show them as retryable, and make automatic opens within the existing window
read-free. Explicit Retry or Refresh bypasses the window. A targeted retry does not certify
unrelated dependencies or advance their freshness. Hydrated failures have identities rather
than executable jobs, so explicit Retry reconstructs only their concrete dependency jobs, using
persisted bounded parent metadata where a child read needs it. It never escalates to a full revalidation pass.

Count field writers as selectable entities: an action contributes its owning workflow rule,
transition or approval; a function contributes itself. Keep all effect evidence, but assign each
entity to only its strongest writer group so the groups reconcile with the total.

Distinguish the list-visible module inventory from graph islands derived only from source or
action targets. Full and teaser module totals use the inventory. Quiet inventory modules have
one aggregate count rather than a fog island. Until dependency discovery and analysis settle,
the store explicitly marks the gap count provisional; the UI must defer its ready announcement.
Concrete contract fields and ordering live in architecture §12.

## Rationale

The second live acceptance pass found persistent Zoho 503s causing repeated full fan-out, action
occurrences counted as writers, and an early ready announcement overtaken by later failures.
The preview cannot read source solely to discover additional module names. These distinctions
preserve honest coverage, privacy and bounded automatic I/O without discarding useful evidence.

## Consequences

Old caches lacking revalidation metadata still revalidate. Failure identities, bounded parent
metadata and per-dependency category outcomes are persisted in optional validated cache metadata;
no permission change is required.
The UI consumes shared entity counts, inventory totals, quiet-module count and provisional flag.
Authenticated native-marker rendering remains a separate live check from the packaged harness.
