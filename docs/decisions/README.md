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
