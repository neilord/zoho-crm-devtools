# 0029 — Automation Map freshness and coverage identity

- **Status:** Accepted
- **Date:** 2026-10-24

## Decision

Refine ADRs 0024 and 0027: fully revalidated Automation Map partitions have a 15-minute freshness
window. Reopening a fresh partition performs no CRM reads. Expose an explicit refresh, retain the
last successful dependency revalidation time, and persist validated outcome metadata alongside the
existing graph. Partitions with failed dependencies always revalidate; analysis limitations remain
honest gaps without forcing new configuration requests. Old caches remain readable but stale.

The store alone defines the gap total: unique failed dependencies plus functions whose analysis
is not analyzed, with pending counted once settled. Deduplicate dependencies shared by WorkflowIndex
and the map. Category coverage counts dependency outcomes consistently, including empty success and
unsupported, rather than mixing discovered configuration counts with failed reads.

Use a shared pure query for most-written fields and distinct field writer counts. Record-only
mutations belong in a separate lens bucket and never imply field values were written.

## Rationale

Live acceptance found repeated warm fan-out, inconsistent gap totals, and record-only functions
appearing as writers of unrelated fields. These rules give all map surfaces one honest definition
while keeping locally cached maps useful and refresh under the user's control.

## Consequences

The cache protocol accepts optional revalidation metadata; caches lacking it revalidate. UI must
consume the store's total, timestamp, refresh and query helpers. No permissions, CRM writes, remote
CRM data flow, or change to Search All Workflows' independent cache policy is introduced.
