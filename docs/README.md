# `docs/` — index & governance

This is the governance surface for the repository's documentation. Every allowed document family
is listed below with its purpose. **If a doc is not in this index, it should not exist.** Start from
[`../AGENTS.md`](../AGENTS.md).

## Read order

1. [`conventions.md`](conventions.md) — how the project works.
2. [`STATE.md`](STATE.md) — what is happening now.
3. [`decisions/`](decisions/) — ADRs relevant to the task.
4. The reference docs relevant to the change.

## The four buckets

| Bucket | Home | Nature |
|---|---|---|
| **Conventions** — how we work | [`conventions.md`](conventions.md) | Stable; rarely changes. |
| **Decisions** — why | [`decisions/NNNN-*.md`](decisions/) | Append-only ADRs. |
| **State** — what is happening now | [`STATE.md`](STATE.md) | Living snapshot; updated every session. |
| **Reference** — how the product and system are shaped | Curated reference docs below | Evolves with the code/product. |

## The closed list of allowed docs

| Doc or family | Bucket | Purpose |
|---|---|---|
| [`conventions.md`](conventions.md) | Conventions | Branching, commits, landing, verification, release, debugging, code style, and docs rules. |
| [`STATE.md`](STATE.md) | State | Current status, in-flight work, blockers, and next work. |
| [`architecture.md`](architecture.md) | Reference | Components, data flow, build shape, and external boundaries. |
| [`testing.md`](testing.md) | Reference | Test layers, real-site verification, and fixture discipline. |
| [`product.md`](product.md) | Reference | Product scope, shipped capabilities, non-goals, and direction. |
| [`zoho-integration.md`](zoho-integration.md) | Reference | Durable findings about Zoho's undocumented DOM and API contracts. |
| [`decisions/NNNN-*.md`](decisions/) | Decisions | Durable choices and their rationale. |
| [`plans/*.md`](plans/) | State (ephemeral) | Temporary multi-step plans, deleted when complete. |
| [`posts/*.md`](posts/) | Reference artifact | Published marketing copy retained for reuse and channel history. |
| [`store-listing/`](store-listing/) | Reference artifact | Chrome Web Store copy and promotional assets. |

Repository-root public documents such as `README.md`, `CONTRIBUTING.md`, `SECURITY.md`,
`PRIVACY.md`, `CHANGELOG.md`, and legal files serve external readers and are outside this internal
`docs/` taxonomy.

## Rules

- **One home per fact.** Convention → `conventions.md`; decision → ADR; current status →
  `STATE.md`; system/product shape → the relevant reference doc.
- **New-doc gate.** Do not create a new top-level `docs/*.md` without an ADR and an entry in this
  index. New files inside an already sanctioned artifact family follow that family's purpose.
- **Plan lifecycle.** Multi-step working plans live under [`plans/`](plans/) and are folded into
  `STATE.md` or an ADR, then deleted, when complete.
- **No overlap.** Git, verification, release, debugging, and coding rules live only in
  `conventions.md`.

## ADR gate

Write an ADR when a decision is durable and a future agent should not reopen it: a convention
change, tooling choice, product boundary, integration strategy, or new top-level doc. Use the next
free number and [`decisions/TEMPLATE.md`](decisions/TEMPLATE.md). Accepted ADRs are append-only;
supersede one with a new ADR instead of rewriting it. Add every ADR to the log in
[`decisions/README.md`](decisions/README.md).
