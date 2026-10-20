# 0024 — Paid Search All Workflows

- **Status:** Accepted
- **Date:** 2026-10-21

## Decision

Ship Search All Workflows as an additive paid feature, gated before cache or CRM reads. Any
entitled non-free plan qualifies under ADR 0023. This is a local licence check under ADRs 0013
and 0019. Development acceptance may use an unlock flag that production builds ignore.

Index locally through same-origin authenticated Zoho session GET requests, without new extension
permissions. Workflow definitions, function source, coverage and cache data never enter billing.

Publish metadata immediately and enrich progressively, with honest coverage and explicit dependency
gaps. Keep presence separate from freshness: the full cached graph is immediately searchable,
coverage reflects cached data while refreshing, and revalidation replaces dependencies in place.
Failed refreshes retain cached matches and expose retryable failures.

Persist a compressed wire dependency graph partitioned by CRM origin and organization. Store shared
rule details, action resources, templates, metadata, catalogue and function sources once per dependency,
then normalize on hydration. Revalidate in the background, using reliable change metadata to skip
unchanged reads and fetching changed or unknown dependencies. Keep cache validation and storage
bounded; cache failures are advisory and cannot block fresh indexing.

Join workflow function bindings to catalogue source by an exact, unambiguous `api_name`. Action,
CRM-function and Deluge-function IDs belong to separate namespaces. Name-only candidates remain
uncertain and do not unlock source indexing or editor handoff.

Open related functions in a fresh same-origin Functions tab. Pass only validated identity through
an expiring, single-use handoff; consume it before asynchronous work, re-resolve the catalogue
identity and fetch matching detail on the destination. Require native-editor acknowledgement and
show failures there. Keep the workflow dashboard open and preserve Search All Functions' handoff.

## Rationale

Workflow search adds paid value without changing free editor or function-search behavior. Same-origin
indexing reuses the user's CRM session and keeps configuration on the device. Progressive coverage
makes cold indexing useful early without claiming unavailable data is indexed. A compressed shared
graph fits substantially more source and template content into bounded local storage; origin/org
partitioning prevents reuse across CRM contexts. Warm presence must survive independent freshness
checks so reopening does not repeat a cold-search wait.

API-name joins respect Zoho's distinct identifier namespaces; display names alone cannot establish
identity. A fresh Functions document initializes Zoho's editor module and avoids stale globals or
broken intermediate states caused by navigating the Workflow Rules SPA into the editor.

## Consequences

- Free or unavailable entitlements use the upgrade experience before indexing or cache access.
- The feature adds no CRM writes, backend CRM-data flow or extension permissions.
- Large or invalid caches may be rejected; fresh indexing remains usable and failures observable.
- Integration and authenticated acceptance checks remain required, including warm search and native
  editor readiness. Implementation contracts and limits live in the reference docs.
