# Decisions — ADR log

Durable decisions live here as append-only Architecture Decision Records. Transient status belongs
in [`../STATE.md`](../STATE.md); working rules belong in [`../conventions.md`](../conventions.md).

## How to write one

1. Copy [`TEMPLATE.md`](TEMPLATE.md) to the next `NNNN-short-title.md` number.
2. Fill in decision, rationale, and consequences; use `Proposed` only while discussion is open.
3. Add one line to the log below.

Accepted ADRs are immutable. Supersede a decision with a new ADR that references the old one and
mark the old entry `Superseded by NNNN`. If branches claim the same number, the later-merged ADR
renumbers.

## Log

- [`0032-automation-map-settled-freshness-and-counts.md`](0032-automation-map-settled-freshness-and-counts.md) — settled freshness despite dependency failures, selectable writer entities and honest inventory/gap counts.
- [`0033-automation-map-zoom-tiers-and-render-budget.md`](0033-automation-map-zoom-tiers-and-render-budget.md) — sparse zoom tier and tonal washes, fog size bounds, per-frame render budget, search and selection framing.

- [`0031-automation-map-history-and-deep-links.md`](0031-automation-map-history-and-deep-links.md) —
  one history entry per open map, bounded hash sync, Back closes in place, boundary-checked writes.

- [`0030-automation-map-design-review-conventions.md`](0030-automation-map-design-review-conventions.md) —
  selection/focus, safe framing, trace layers, fog, contrast and settled announcements.

- [`0029-automation-map-freshness-and-coverage.md`](0029-automation-map-freshness-and-coverage.md) —
  15-minute freshness, explicit refresh and shared coverage/writer identities; freshness refined by 0032.

- [`0028-automation-map-integration.md`](0028-automation-map-integration.md) — lazy packaged map
  integration, one-flow/four-detail teaser, consistent board/List filters and fixed NEW expiry.

- [`0027-automation-map-indexeddb-cache.md`](0027-automation-map-indexeddb-cache.md) — worker-only
  extension IndexedDB for the bounded Automation Map cache without competing for local-storage quota.

- [`0026-automation-map.md`](0026-automation-map.md) — Pro/Max Automation Map overlay, same-origin
  reads/local analysis, possible-writer evidence, bounded fog teaser and lanes/dagre layout.

- [`0025-plan-feature-capabilities.md`](0025-plan-feature-capabilities.md) — server capability
  lists, contract fallback and baseline-only unknown paid keys; refines 0023 for tiered features.

- [`0024-paid-workflow-search.md`](0024-paid-workflow-search.md) — additive paid workflow search,
  same-origin indexing, progressive coverage, compressed origin/org warm graph and revalidation,
  exact API-name joins, and new-tab editor handoff.

- [`0023-paid-entitlement-and-forward-compatible-plans.md`](0023-paid-entitlement-and-forward-compatible-plans.md) —
  paid entitlement gates, future plan keys, Plus trial and three-tier pricing; refines 0011/0016/0019.

- [`0022-resilient-partial-function-export.md`](0022-resilient-partial-function-export.md) —
  supersede 0019 partial-failure policy: retries, explicit skipped entries and anchored status UI.

- [`0021-normal-tab-sign-in-and-export-placement.md`](0021-normal-tab-sign-in-and-export-placement.md) —
  refine 0017/0007: normal-tab OAuth, storage-only permission and adjacent neutral Export.

- [`0020-billing-browser-and-transport-baseline.md`](0020-billing-browser-and-transport-baseline.md) —
  Chrome 116 minimum, redirect rejection, and demand-driven refresh without scheduler permissions.

- [`0019-local-function-export.md`](0019-local-function-export.md) — select local Export functions
  as premium, enforce its configurable gate immediately, retain every existing free capability;
  partial-failure policy superseded by 0022.

- [`0018-refresh-reuse-and-recovery.md`](0018-refresh-reuse-and-recovery.md) — cross-device
  revocation on refresh reuse; one stored-pair recovery check with no replay.

- [`0017-extension-oauth-pkce.md`](0017-extension-oauth-pkce.md) — OAuth code + S256 PKCE; opaque
  rotating tokens and a restart journal that never replays an uncertain refresh.

- [`0009-additive-paid-tier.md`](0009-additive-paid-tier.md) — supersede the billing non-goal;
  preserve ADR 0002 and every existing free feature.
- [`0010-private-billing-backend.md`](0010-private-billing-backend.md) — keep the backend and
  website private; this public repository builds only the entitlement client.
- [`0011-shared-plan-contract.md`](0011-shared-plan-contract.md) — two plans, a perpetual Free
  default without billing rows, and one immutable shared plan contract.
- [`0012-bearer-auth-without-required-hosts.md`](0012-bearer-auth-without-required-hosts.md) — bearer
  authentication over CORS without required API host permissions or install-base disruption.
- [`0013-entitlement-licence-check.md`](0013-entitlement-licence-check.md) — client entitlement is
  a licence check; only server work can enforce premium access.
- [`0014-production-service-worker.md`](0014-production-service-worker.md) — route content-script
  API access through a production worker; verify update-warning assumptions before submission.
- [`0015-two-stage-paid-release.md`](0015-two-stage-paid-release.md) — review plumbing first,
  then gate the new premium feature in a second store release.
- [`0016-no-card-pro-trial.md`](0016-no-card-pro-trial.md) — one product-local, 14-day Pro trial
  per new account, no card required; expiry falls back to perpetual Free.

- [`0008-ai-assistant-cross-promotion.md`](0008-ai-assistant-cross-promotion.md) — sibling products
  may be promoted in-extension only as a one-time, capped, attributed, non-blocking corner card.
- [`0007-functions-toolbar-versions.md`](0007-functions-toolbar-versions.md) — keep cross-function
  search beside native search in both Functions layouts, detected through DOM hooks.
- [`0001-tooling.md`](0001-tooling.md) — TypeScript/Vite/CRXJS build and Biome/Vitest/Playwright
  quality stack.
- [`0002-monetization.md`](0002-monetization.md) — free MVP and additive future premium features.
- [`0003-marketing-channels.md`](0003-marketing-channels.md) — Reddit for release updates; no new
  Zoho Forum topic per update.
- [`0004-docs-and-agent-workflow.md`](0004-docs-and-agent-workflow.md) — closed docs taxonomy and
  persistent agent-context pipeline.
- [`0005-dashboard-deluge-tokenizer.md`](0005-dashboard-deluge-tokenizer.md) — own hand-rolled
  Deluge tokenizer (not tree-sitter/CodeMirror) for the dashboard preview, sharing only the token
  colour vocabulary with the live editor.
- [`0006-zoho-community-distribution.md`](0006-zoho-community-distribution.md) — Zoho Community
  digests exclude third-party tools; use relevant disclosed participation and evaluate explicit
  speaker or sponsor programs separately.
