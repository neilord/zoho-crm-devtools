# 0033 — Automation Map zoom tiers, fog bounds and per-frame render budget

- **Status:** Accepted
- **Date:** 2026-10-24

## Decision

Refines ADR 0030 after the polish and performance pass (measured on a synthetic 80-module org and a
330-rule / 500-function scaled fixture):

- **Zoom tiers.** Below 30% (`SPARSE_ZOOM`) an island shows its title and one short count, never a
  truncated summary; far titles drop the avatar. Island bodies are tonal washes baked once per island
  into the silhouette canvas (kind colour mixed toward slate, low alpha, opacity ramped by zoom). No
  CSS blur. Tiers crossfade by opacity and stay mounted until the fade ends. Summary text is one size
  on every island.
- **Fog bounds.** A fog island's height grows with the square root of its counts and caps at 16 rows;
  haze puffs cap at 1,700px; `fog.css` has no `will-change`, `filter` or `backdrop-filter` (tests
  enforce it). Hard rectangular fog slabs were Chrome dropping tiles from 4,000px animated layers, not
  a clip. Fix size, never add blur.
- **Per-frame budget.** A pan writes only the world transform. The dot grid is its own element.
  `--z` lives on `.amc-world`, moves in about 10% steps during a zoom, and lands exactly about 120ms
  after the zoom settles. ADR 0030 text floors apply once settled. Shadows sit on pseudo-elements that
  fade out while a zoom moves (`amc-zooming`) and fade back in. Canvas size comes from a
  ResizeObserver, never a per-frame layout read. Button and keyboard zoom glide over 200ms; wheel and
  pinch stay immediate.
- **Progressive rebuilds** back off to three times the last build time (500ms to 2s); the settling
  build keeps the 500ms floor.
- **Search** commits on the first keystroke after idle, then debounces at 160ms; Enter flushes.
- **Selection framing.** A jump to a node with the inspector open frames the whole island in the free
  area (zoom 45% to 70%). A click only slides the node clear.

## Rationale

Each rule came from a measured problem: per-frame custom-property writes cost 2 to 6ms of style
recalc per pan frame, zoom-scaled font sizes forced two layouts per zoom frame (115 of 120 frames
over 25ms at fit), every keystroke re-rendered, and oversized fog layers lost tiles. With these rules
the pan recalc is about 0.1ms, slow zoom frames at 32% fell from 62 to 1–3, and search work over 20
keys fell from 437ms to 119ms.

## Consequences

Canvas styling must not reintroduce per-frame writes on `.amc-canvas`, zoom-dependent layout during a
gesture, per-card `filter`/`backdrop-filter`, or animated blur. Re-measure with
`playwright.automation-map-perf.config.ts` (scaled fixture via `AM_PERF_*`). Visual states are captured
by the `automation map visual states` Playwright test into `AM_SHOTS`. Not done: running dagre in a
worker, detaching hidden views, batching minimap updates.
