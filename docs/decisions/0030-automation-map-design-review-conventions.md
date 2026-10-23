# 0030 — Automation Map board, trace and preview conventions after design review

- **Status:** Accepted
- **Date:** 2026-10-24

## Decision

Behaviour a future agent should keep, found by reviewing the integrated UI (shell plus the real
canvas) at 1440×900 and 1024×768, small and 330-rule orgs:

- **Selection and focus.** Click and Enter on a board or trace node open the inspector; arrow keys
  only move the selection (and follow an inspector that is already open). A node the inspector
  would cover is slid clear. After a structural change (view switch, canvas swap) the shell hands
  focus to the new view's `[data-focus-target]` unless a control, such as the search box, still
  holds it. Enter in the search box selects the next match in the current view; only a `field:`
  query, a rail result and the Fields view open the lens.
- **Chrome insets, no contract change.** The shell publishes `--am-insp-w` (the open inspector) and
  `--am-safe-top` (the gap banner) on `.am-main` and dispatches `am:insets` on the canvas hosts;
  `Viewport` frames around `safeRight`/`safeTop`, and every frame (fit, island fly-to, the compact
  top-of-island frame, a selection slide) keeps content out from under the bottom-left corner
  chrome. A frame centres what fits and starts an axis that cannot fit (the zoom floor stops a
  330-rule estate from shrinking) at its leading edge, below the banner; centring it put the first
  row of titles under the banner. Between the bottom and the left reserve a frame takes the one
  that actually clears the corner, not the larger zoom. The banner republishes its inset when it
  re-wraps. The minimap shows while zoomed out and steps aside from zoom 0.6, where it would only
  cover readable cards; the zoom bar's toggle overrides it, and the corner's size follows what is
  shown. The floating upgrade card starts as the pill at 1100px and narrower.
- **Live region.** It speaks only when a pass has settled (`complete`, not refreshing, gaps not
  provisional), with that snapshot's `coverage.gaps`; again only when a later settle changes the
  number. The cached count a reopen paints, and every progressive tick, are never read out.
- **Trace layers.** `TraceResult.depth` gives upstream precedence, so a node on a cycle always
  landed upstream. `buildTraceModel` recomputes layers from the traced edges: the nearer side wins,
  downstream wins a tie, cycle edges run under the chart in lanes with one label per lane, and a
  context node that would only be joined across the chart is left out. The data layer is unchanged.
- **Board edges.** A cascade ends at the rule's record event, not at every rule it starts. More than
  eight forward edges into one node draw as a trunk with a count (one path per evidence tier). An
  edge that would run behind a populated lane collapses like a hub link (port dot on the source,
  shown on hover or selection). The card cap follows a ~1,500 DOM-node budget, so compact zoom
  stays inside it in a large org.
- **Overview.** Flow curves carry no labels; hovering an island shows one card listing where it
  writes and where it is written from. Summary text keeps an 8.5px floor on screen.
- **Fog.** Cloud masses, never rows: at most eight per lane, three to five low-alpha radial puffs
  each, a different feathered outline per island, one continuous haze, no dot grid. It is built from
  counts only, animates transform and opacity only, and pauses for reduced motion and hidden tabs.
  Lock chips are not a grid of identical chips: their size and resting opacity follow the island's
  counts (`data-tier` xl to tiny), the one-rule tail carries none until hovered or focused, and
  modules without automation are one "N other modules without automation" note (`quietModules`;
  empty slots of an older snapshot count instead, never both) rather than empty islands. The
  teaser List shows what is locked as flat, static rows (lock, "In the fog", counts), never blank
  striped rows, and they stay outside the grid's row model.
- **Preview copy** quotes one number derived from the snapshot (`flowsShown`); synthetic teasers
  reveal exactly one rule, as the store does.
- **Text.** `--fs-muted` is `#5f687b` and `--am-lane-label` `#646d82`: 4.5:1 on white, grey surfaces
  and the canvas. Compact-tier text is counter-scaled by `--z` to about 10px on screen.

## Rationale

Each item came from a measured defect in the integrated UI, not from taste: dead shortcuts after a
view switch, an inspector that never opened, a downstream column that could not exist, chrome
covering content, and text under 8px. The fixes stay inside the UI layer so the frozen data and
port contracts are untouched, and they are cheap enough to keep the render budget.

## Consequences

Canvas code reads the published CSS variables instead of asking the shell; a new floating chrome
element must publish its size the same way. Tests mount the real overlay with the real canvas
(`tests/automation-map-ui-polish.test.ts`). CSS cannot be asserted in Vitest (stylesheets load
empty), so contrast is checked in the packaged e2e run and layout in screenshots.
