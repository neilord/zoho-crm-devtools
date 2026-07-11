# AGENTS.md — start here

You are working in **Zoho CRM DevTools** — a Chrome extension that improves the Zoho CRM
Deluge editor while staying close to Zoho's native UI.

This repo runs on a small, **closed** set of docs, and every agent follows the same pipeline. The
docs **are** the project's long-term memory: they carry conventions, current state, system shape,
and durable decisions between agents. The rule is *one home per fact* and *no new top-level docs
without a decision record*.

## The pipeline in one sentence

> Read `docs/README.md` → `docs/conventions.md` → `docs/STATE.md` → the ADRs relevant to your task
> **before** touching anything; at the end, update `docs/STATE.md` and record any durable decision
> as a new ADR — and **never create a new top-level doc without an ADR.**

## Before you touch anything

1. Read [`docs/README.md`](docs/README.md) — the index and closed list of allowed docs.
2. Read [`docs/conventions.md`](docs/conventions.md) — how to branch, commit, land, verify, release,
   debug, and write code.
3. Read [`docs/STATE.md`](docs/STATE.md) — what is happening now and what is in flight.
4. Read the relevant ADRs under [`docs/decisions/`](docs/decisions/), plus
   [`docs/architecture.md`](docs/architecture.md), [`docs/testing.md`](docs/testing.md), or
   [`docs/zoho-integration.md`](docs/zoho-integration.md) when changing those boundaries.

## When you finish

1. **Update [`docs/STATE.md`](docs/STATE.md)** — move completed work out of "In flight" and leave
   an honest snapshot for the next session.
2. **Record durable decisions as an ADR** — add `docs/decisions/NNNN-*.md` when a future agent
   should not relitigate the choice.
3. **Run the verification command** in [`docs/conventions.md`](docs/conventions.md) §5 before every
   commit, including any required live Zoho check.

## The one rule that keeps this from rotting

**One home per fact.** A convention lives in `conventions.md` only. A decision is an ADR only.
Current status lives in `STATE.md` only. System shape lives in a reference doc only. A new
top-level `docs/*.md` requires an ADR justifying it and an entry in `docs/README.md`.
