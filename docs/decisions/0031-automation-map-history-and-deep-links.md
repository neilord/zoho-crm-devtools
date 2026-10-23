# 0031 — Automation Map browser history and deep-link sync

- **Status:** Accepted
- **Date:** 2026-10-24

## Decision

Refine the UX spec's "Written with `history.replaceState`, removed on close" (§11) and ADR 0028's
hash restore. While the map is open it owns exactly one history entry:

- Opening pushes one entry that carries the `#zcdt-map=` hash (the page's own `history.state` is
  kept, plus a marker). A link already in the URL gets the plain page replaced underneath it first,
  so Back lands on the page; where the Navigation API shows the entry below is this same page, that
  entry is claimed instead of adding another. Until the plan is known only `view` is written.
- The hash follows view, selection, field, trace and focus with `replaceState` only, debounced
  300 ms with a 1 s bound (a trailing debounce starved while snapshots streamed in, which is why
  Copy link and the address bar went stale in a large org), flushed immediately for Copy link, and
  never written onto a route the page has since left. Every write passes the preview's boundary.
- Back (popstate or hashchange to a URL without a map hash) closes the map without touching history;
  a map hash arriving while open (hand edit, Back/Forward between map entries) applies the decoded
  state, with what it omits reset to defaults and the preview taking only view and revealed node.
- Closing from the UI pops the entry with `history.back()` only when the marker shows it is still on
  top; otherwise it removes the hash with `replaceState`. The map never assigns `location`, changes
  the route or reloads. The entry controller remembers the hash a closing map leaves behind so the
  pop is not taken for a new link.

The inspector follows the selection and closes with it (UX spec §10), and "Show on map" keeps its
landing (selected node, module) until the graph has it, then frames it (§15.3), widening the scope
once when the node is an inactive rule the default scope would never show.

## Rationale

Live acceptance found the hash stale for minutes, hash edits and Back ignored, and Back leaving the
page because history never grew. One entry that Back, Forward and the close button all treat the
same way keeps the browser's own controls honest without touching Zoho's router; markers and the
route guard keep the map from ever popping or rewriting an entry it does not own.

## Consequences

Tests and harnesses that close the map must let `history.back()` land (jsdom performs it a task
later; `tests/setup-history.ts` drains it between tests). Whether Zoho's router reacts to the
`popstate` of our own pop is a live check (same path, hash only). New write paths go through
`ui/history.ts` and the overlay's `hashNow()`, never straight to `history`.
