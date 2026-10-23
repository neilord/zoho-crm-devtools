# Automation Map — UX spec (engineering hand-off)

Status: design proposal, 2026-10-24. Companion prototype (synthetic data, not shipped):
`/private/tmp/claude-501/-Users-admin-Developer-zoho-crm-devtools/6343591f-b07c-4a8b-81de-7a58a586da91/scratchpad/automation-map-prototype.html`.
When the prototype and this document disagree, this document wins. Items marked **[verify live]** are
assumptions about Zoho's DOM or styling that must be checked on a real org before release.

Entitlement: the map, the store and the upgrade modal's success path all use the same check,
`hasPlanFeature(entitlement, 'automationMap')` (ADR 0025 capability; Pro/Max). Everyone else
gets the fog teaser (§14). Plus and Plus trial are never told that their plan unlocks the map.

Prototype controls (top strip, prototype only):
- **Pro / Plus teaser / Loading:** switch the mode.
- **Plan:** sets the copy for Plus, Plus trial or Free.
- **Open from:** enters through the Settings tile, the Workflow toolbar or "Show on map".
- **Zoho page:** closes the overlay to show the mocked Zoho page.

The prototype leaves a 44 px top inset for that strip. The product uses 10 px.

### Decisions and refinements of the brief (read first)

| Brief said | Decision | Why |
|---|---|---|
| Field lens is the headline | Kept. **Landing depends on the entry point** (§2): the Settings tile opens the Fields start state; the toolbar and "Show on map" open the Board in context. | A cold open needs a question, not a canvas. In-context opens need the map at that module or rule. |
| Entry points lane | **Record-event triggers are aggregated nodes** ("Field changed: Stage · 4 rules"). Schedules and REST API functions live in an **Org-wide island**. | Cuts edges about 4× and gives module-less entry points a home. |
| Hairball avoidance | Overview tier shows **aggregated module→module flows** (one curve per pair, width ~ log count, amber when both directions). | Answers "what talks to what" at a glance without node edges. |
| Trace "dim, don't remove" plus a dagre flowchart | Trace is its **own flowchart canvas**, with a dimmed **context ring** one level beyond the depth. Hover, selection and search dim **in place** on the board. | Cross-island paths are unreadable in place. The context ring keeps "dim, don't remove". |
| Filters | **Filters remove; search dims.** Island anchors never move under filters. | Stable mental map; data funnel. |
| Scope toggle in the header | Moved to the **top of the rail**. | The 1280 px header needs the room for search. |
| Fog: no real names | Stricter reading: fogged islands do **not show module names either**, only counts. The revealed area is **one flow**, chosen deterministically, with no re-pick. | Module names are labels. Re-picking would let users walk the estate. |
| Workflow field update → cascade | Rendered as **"cascade unknown"** (dotted amber) until Zoho's re-trigger behaviour is verified live. Function writes follow the analyzer's trigger policy. | Never claim a cascade we have not verified. |
| Settings "tile" | One **item in the Developer Hub section** of Setup home, matching the native items, with a NEW badge. **[verify live]** | A foreign card would break Zoho's grid. |

---

## 1. Product frame

Automation Map answers two questions about one Zoho CRM org:

1. **"What runs in this CRM?"** answered by the **Board** and the **List**.
2. **"What are all the possible ways field X can be updated?"** answered by the **Field lens** (the headline).

Everything inferred is labelled **possible**, never complete. Every negative or partial answer carries
a visible coverage statement. All data stays in the browser. Nothing in this feature sends CRM data
off the device, and no screen has a share/export-to-server affordance. "Copy link" copies a local
deep link only.

### Design principles (apply to every screen)

- **Start from the job, not a hairball.** Never render the whole estate as one graph. Islands,
  aggregation, hub collapse and portals keep every screen bounded.
- **Stable mental map.** Island positions are deterministic and do not move when filtering,
  searching or selecting. Only a scope change (Active ↔ Everything) re-packs them, with a 240 ms tween.
- **Filter removes, search dims.** Filters are a data funnel. Search and selection keep context visible
  but dimmed.
- **Never colour alone.** Each node kind has its own shape, icon and colour, and its kind is named
  in the inspector and in ARIA.
- **Honesty is visible, not tooltip-only.** Coverage gaps, unresolved writers and unindexed change
  sources appear in the main layout.
- **Zoho-native feel.** Reuse the dashboard's `--fs-*` tokens, its 20×20 stroke icons, Segoe/system
  type, light theme and density. The map is an extension overlay, not a new app skin.

---

## 2. Information architecture

```
Automation Map (full-viewport overlay, Shadow DOM)
├─ Header: brand · view switcher [Fields | Board | List] · global search · coverage pill · ? · ×
├─ Left rail (264): Scope · Modules · Show (legend = kind filter) · Triggers · Only   ⟷ Search results
├─ Main
│   ├─ Fields  → start state (field picker + questions)  →  Field lens (writers · field · reactors)
│   ├─ Board   → pan/zoom canvas of module islands (semantic zoom) → Trace mode (flowchart)
│   └─ List    → treegrid twin of the same filtered graph
├─ Inspector (400, right): details of the selected node, plus actions
└─ Footer (32): keyboard hints · totals · cache age
```

Views share one state: scope, filters, query, selection, and focused field. Switching views keeps the
selection. "Show on board" and "Show in list" keep it too.

### Landing (how the map opens)

| Opened from | Lands on |
|---|---|
| Settings tile (no context), or first open ever | **Fields start state** (headline question first) |
| Workflow Rules toolbar button | **Board**, flown to the module selected in Zoho's module filter (overview if "All modules") |
| "Show on map" in the workflow dashboard detail | **Board**, detail zoom on that rule, rule selected, inspector open |
| URL hash `#zcdt-map=…` (reload, copied link) | Exactly the encoded view (§11) |
| Re-open in the same tab session | Last view, restored from `sessionStorage` |

---

## 3. Shell and layout

| Region | Size | Notes |
|---|---|---|
| Overlay | `position:fixed; inset:0`. Scrim `rgba(20,26,40,.45)`. Panel inset 10 px, radius `--fs-radius` (10). | ≤1100 px wide: inset 0, radius 0. No 1280 cap (the dashboard's cap does not apply). |
| Header | 52 px, `--fs-surface`, bottom border `--fs-border` | Brand 14/700. View switcher: segmented, 30 px tall. Search: flex 1, max 560, 36 px tall (dashboard `.wf-search` styling at 36 px). |
| Rail | 264 px, left border none, right border `--fs-border` | ≤1100: becomes a drawer (dashboard pattern, `wf-filterbtn` "Filters" in header). |
| Canvas | Remaining space, min 480 | Background `--am-canvas` with 1 px dots `--am-grid-dot` every 24 world-px (scaled with zoom; hidden below 0.3). |
| Inspector | 400 px (372 at ≤1180) | Overlays the canvas from the right (it does not reflow the canvas). Fly-to targets are centred in the uncovered area. Closable (×, Esc). |
| Footer | 32 px, `--fs-surface`, 12 px muted | Left: hints. Right: `48 rules · 60 functions · 8 modules · Cached 3 min ago`. |
| Canvas chrome | Zoom cluster bottom-left (12 px inset). Minimap above it (184×124). Legend button bottom-right. | 32 px buttons reuse `.fs-icon-button`. |

Minimum: 1280×800 is the design target. At 1024×768 the rail is a drawer, the inspector is 360 px,
the view switcher shows icons only (with labels in tooltips), and the search placeholder shortens to
"Search…".

---

## 4. Tokens (`--am-*`, defined on the overlay root next to `--fs-*`)

```css
/* surfaces */
--am-canvas:#f3f5f9; --am-grid-dot:#d9dfea;
--am-island:#ffffff; --am-island-border:#e2e6ee; --am-island-radius:16px;
--am-island-shadow:0 1px 2px rgba(15,23,42,.05),0 10px 30px rgba(15,23,42,.06);
--am-lane-sep:#eef1f6; --am-lane-label:#646d82;
--am-node:#ffffff; --am-node-border:#dfe4ee; --am-node-radius:8px;
--am-node-hover-shadow:0 4px 14px rgba(15,23,42,.10);
/* kinds (icon tile = kind at 12% on white; border on hover = kind) */
--am-k-event:#b7791f;   /* record-event trigger */
--am-k-button:#2b8a3e;  --am-k-schedule:#ae3ec9; --am-k-api:#e8590c;
--am-k-rule:#2f6df0;    --am-k-action:#5c677d;   --am-k-function:#6741d9;
--am-k-template:#d6336c;--am-k-external:#8a6d3b; --am-k-field:#0c8599;
--am-k-transition:#0b7285; --am-k-approval:#5c940d;
--am-k-module:#3d4657;
/* edges */
--am-edge:#b3bccb; --am-edge-hl:var(--fs-accent); --am-edge-unresolved:#a9b2c3;
--am-cascade:#d97706; --am-edge-w:1.5px; --am-edge-w-hl:2.25px;
/* states */
--am-match:#f2c94c; --am-match-glow:rgba(253,230,138,.65);
--am-select-ring:0 0 0 2px var(--fs-accent),0 0 0 5px rgba(47,109,240,.16);
--am-dim:.2;
/* evidence */
--am-ev-line:#efeafd; --am-ev-bar:#6741d9;  /* code evidence line (violet = inferred write) */
/* fog */
--am-fog:#f4f6fb; --am-silhouette:#dde3ee; --am-silhouette-2:#e8ecf3;
--am-pro:#6741d9; --am-pro-soft:#efeafd;
```

Soft fills use `color-mix(in srgb, var(--k) 12%, #fff)` (Chrome ≥111, so fine for the extension).
Status colours, highlights, code palette and warning boxes reuse `--fs-ok/off/warn/bad`,
`--fs-highlight` and `--zcdt-syntax-*` unchanged.

---

## 5. Node taxonomy (legend = kind filter)

**Mapping to the frozen contract (`src/content/automation-map/types.ts`):**
- **Graph kinds** map one-to-one: module, field, rule, action, template, function, button, schedule,
  transition, approval, external.
- Two kinds are **view-model nodes** derived in the UI:
  - **Record event:** rules grouped by trigger signature. Its edges are the rule's `starts`.
  - **REST API entry:** a stub for a `FunctionNode` whose entry kinds include `restApi`.
- **Unresolved-write buckets** ("Deals · fields unknown", "Unresolved module") render the targets of
  `possibleWriters` and `unresolvedWriters` edges.
- **Edge style** follows `EdgeEvidence`: declared = solid, inferred = dashed, unresolved = hollow.
  Analyzer confidence `partial` adds the "+?" badge.
- **`MapEdgeKind` maps to:**
  - `starts`: entry→rule/function
  - `invokes`: rule→action
  - `uses`: action→template/function/external
  - `writes`
  - `calls`: function→function
  - `reacts`: field→rule
  - `cascades`

**Field lens groups map to `FieldLens`:**
- `writers` → "Declared in configuration" and "Functions · exact"
- `possibleWriters` → "Functions · partial" and "May write {Module} · fields unknown"
- `unresolvedWriters` → "Unresolved module"
- `coverageGaps` → the coverage footer

All sizes are world px at zoom 1. Icons: 20×20 viewBox, 1.4 stroke, `currentColor`. Add new shapes
to `view-icons.ts`; reuse existing ones where named.

| Kind | Shape (CSS) | Icon | Size (detail) | Content |
|---|---|---|---|---|
| Module | Island container, radius 16 | 2×2 grid `module` | lanes | Header: avatar tile (2 letters), name 15/700, counts |
| Record event (trigger) | Rect radius 8, **left notch** (clip-path arrow-in) | `trigger` (bolt) | 184×44 | "Field changed: Stage" + "3 rules" |
| Button | Rect radius 6, **2 px bottom border** (key-cap) | `cursor` (new) | 184×44 | Button name + placement ("Deals · Detail page") |
| Schedule | Rect radius 22 (**pill**) | `clock` | 184×44 | Name + cadence ("Daily 02:00") |
| REST API function | Rect radius 8, **left notch + right port dot** | `plug` (new) | 184×44 | api_name + "OAuth / API key" |
| Blueprint transition | Rect with a **right arrow point** (clip-path) | `transition` (new: double chevron and bar) | 184×44 | Transition name + "Blueprint · {name}". Declared writer of the state field and its during-input fields |
| Approval process | Rect radius 8 with a **double inner border** (inset ring) | `approval` (new: stamp) | 184×44 | Name + "Approval process · on approve". Declared writer through its approve/reject field updates |
| Workflow rule | Rect radius 8, **3 px left status stripe** (`--fs-ok` active / `--fs-off` inactive) | `workflow` (new: branch) | 248×58 | Name 13/600; line 2: trigger summary · conditions; right: action-kind mini icons |
| Action | Rect radius 5, compact | existing `kindIcon` | 196×30 | Kind label + target ("Stage = Closed Won"); scheduled actions add a `clock` chip "+3d" |
| Function | **Hexagon-ended** rect (clip-path, 10 px points) | `function` | 216×44 | display/api name; line 2 "Deluge · 42 lines"; hub badge |
| Email template | Rect radius 6, **folded top-right corner** | `emailNotification` | 216×44 | Template name + subject |
| External system | **Parallelogram** (skew −10°, content counter-skewed) | `globe` (new) | 216×44 | Host + method/connection |
| Field | **Capsule** (radius 999) | `field` (new: tag/i-beam) | 188×30 | `Stage` + type glyph; cross-module fields show module prefix |
| Portal stub | Capsule with **dashed** border + arrow | `external` arrow | 188×28 | "→ Accounts · ARR" / "← from Deals (2)" |

Compact tier (§6.3) keeps the shape and icon tile, hides line 2 and truncates the name at 22 chars.

**Status modifiers:**
- Inactive: name in `--fs-muted` and an "Inactive" tag. Hidden in Active scope.
- Failed or unavailable detail: dashed node border and a `warn` icon tile.
- Pending (loading): shimmer `.skel` for line 2.

---

## 6. Board

### 6.1 Islands

- **One island per module**, plus an **Org-wide** island holding module-less entry points (schedules,
  REST API functions) and, in Everything scope, unassociated functions and unused templates.
- **Packing:** three shortest-column-first columns, column width 1300 + gap, gap 170 (room for the
  overview titles). Order: Org-wide, then modules by rule count (descending, ties broken by id).
  Deterministic for a given scope.
- **Positions come from the unfiltered scope**, so filters shrink islands in place.
- **While loading, reserve geometry:** lanes present in the final layout stay present, and pending
  nodes render as skeletons. Production estimates heights from rule counts and settles with a 240 ms
  tween.
- **Island header** (60 px):
  - avatar 28 px
  - name and the counts line, e.g. `11 rules · 9 active · 14 functions · writes 12 fields`
  - right side: up to 2 hub chips and the search-match badge
- **Body:** lanes left to right. A lane is omitted when it is empty in that island.

| Lane | x (relative) | Width | Contents (top→bottom order) |
|---|---|---|---|
| Entry | 20 | 184 | record events (grouped per trigger signature), buttons, incoming portals (`← from X`), schedules/API (Org-wide only) |
| Rules | +56 gap | 248 | rules ordered by their entry node, then name |
| Actions | +56 | 196 | each rule's actions in condition order (instant first, then scheduled) |
| Resources | +56 | 216 | functions, templates, externals, by barycenter of their callers |
| Effects | +56 | 188 | own-module fields, "fields unknown" bucket, outgoing portals |

- Lane labels: 10.5/700 uppercase, `--am-lane-label`, at the top of each lane, with a 1 px dashed
  `--am-lane-sep` separator.
- Vertical gap: 10 (actions 6).
- Ordering inside lanes: two barycenter sweeps, left→right then right→left. Lane layout is
  deterministic and hand-written. **Dagre is only used for Trace and Field lens.**

### 6.2 Edges (one SVG layer, under nodes)

- Cubic Bézier from the source's right-centre to the target's left-centre, with control points at
  ±40% of dx. `vector-effect: non-scaling-stroke`. The arrowhead appears only at the detail tier.
- Edges are re-rendered on data, filter or scope changes only. Hover and selection toggle classes,
  so pan and zoom never touch the SVG.

| Edge | Style |
|---|---|
| Declared (entry→rule, rule→action, action→resource, field-update→field) | solid `--am-edge` 1.5 |
| Inferred write, exact (function→field) | dashed `6 4` |
| Inferred write, partial | dashed `6 4` + "+?" badge at the target end ("may also write fields it could not name") |
| Unresolved (fields unknown / module unknown) | **hollow tube**: 4.5 px `--am-edge-unresolved` under 2.5 px white, ending in a hollow circle |
| Function→function call | solid, arcs out to the right of the Resources lane |
| Possible cascade (field→reactor trigger, same island) | `--am-cascade` dashed `6 4`, routed under the island bottom; `↻` label when it closes a cycle |
| Cross-module | never drawn as a long line. Uses portal stubs (§6.5) |

### 6.3 Semantic zoom

| Tier | Zoom | Island renders | Nodes |
|---|---|---|---|
| Overview | < 0.42 | **Frame title above the island** (`min(15px / z, 120 world px)`, Miro-style). Inside, a summary card with counts at `min(11.5px / z, 0.075 × island height)`, an active/inactive bar, hub chips (hidden on islands < 640 tall), and **silhouettes of the real node rects** (kind colour at 16%) so the shape carries into the next tier. Plus the module→module flow curves (below). | Lanes and node DOM hidden (`display:none`) |
| Compact | 0.42–0.80 | Lanes, nodes, edges | Shape + icon + truncated name. Line 2 and action labels hidden. Actions render as 30×30 icon chips. |
| Detail | ≥ 0.80 | Full | Everything, arrowheads, cascade labels |

- Hysteresis is ±0.03 at each threshold. Tier changes crossfade (opacity 140 ms) and never move geometry.
- Zoom range: 0.06–2.0. Fit-all on first Board open (padding 48).
- **Framing keeps cards out from under the bottom-left chrome** (zoom bar, and the minimap while
  it shows). The reserve picks the zoom; the placement is centred in the whole free area (below the
  banner, beside the inspector) and moved right or up only by the least that clears the chrome. A
  tall island framed at compact zoom from its top chooses its left edge by the card area left under
  the bar or minimap (weighted four times a card cut by the right edge or inspector), so the bar's
  column wins even when it pushes the last lane past the edge. The bar's width is measured, with
  the constant as a floor.
- **Module→module flows (overview only):** drawn in their own SVG layer *under* the island panels.
  - One quadratic curve per ordered pair, anchored on the island borders, bowed 14% so A→B and
    B→A separate.
  - Stroke `1.5 + 1.6·log2(n+1)` px, `#c4ccd9` at 0.6. A pair that exists in both directions is amber.
  - Arrowhead at t = 0.94, sized 5.5/z.
  - Hovering an island highlights its curves in accent and shows labels such as
    `Deals → Accounts · 2 writes`. There are no permanent labels, which cuts clutter.

### 6.4 Hubs

- A function is a **hub** when its caller count is ≥ max(8, 98th percentile of caller counts).
  The prototype uses 5 at its small scale.
- In each island that uses it, the hub renders once with a violet count badge: `Called by 41`, plus
  `· 6 here` in the detail tier.
- Edges into a hub are **not drawn**. Each calling action shows an 8 px violet port dot instead.
- Hovering or selecting the hub draws its in-island edges and highlights the port dots.
- The inspector lists all callers grouped by module, each a fly-to link.

### 6.5 Portal stubs (cross-module)

- **Outgoing:** in the Effects lane, `→ Accounts · ARR`. Several fields to the same module collapse
  to `→ Accounts · 3 fields`, which expands on click.
- **Incoming:** in the target's Entry lane, `← from Deals (2)`.
- Hovering a portal temporarily draws the real long edge (accent, 1.5, 60% opacity) across islands
  and pulses its partner. Portals alone make tracing cryptic.
- Click flies to the partner (§6.7), selects it and flashes it (2 pulses, 300 ms each).

### 6.6 Hover, selection, search dimming

- **Hover:** the node and its 1-hop neighbours keep full opacity; everything else in that island goes
  to 0.55. There is no global dim on hover, so it stays calm.
- **Select** (click / Enter):
  - the inspector opens
  - the node's upstream and downstream chain inside the island highlights in accent
  - non-chain nodes and edges across the board go to `--am-dim`
  - the selection ring is `--am-select-ring`
- **Search:** matches get a yellow ring and glow. Non-matches go to `--am-dim`. Islands without matches
  dim their header too and show `0`. The island header badge shows the match count.

### 6.7 Navigation

- Drag empty canvas or Space+drag: pan.
- Wheel or trackpad: pan. Ctrl/⌘+wheel or pinch: zoom about the cursor (`exp(-dy*0.0015)`).
- Double-click empty canvas: zoom ×2 at the cursor. Double-click a node: fly to and select it.
- **Fly-to:** 420 ms ease-in-out-cubic on centre and log-zoom. If the distance is more than 1.5
  viewports, zoom out to fit both ends, then in ("arc", 620 ms total). Reduced motion: jump.
- **Culling:** islands outside the viewport + 200 px margin get `content-visibility:hidden`.
  Edges of culled islands are not in the SVG.
- **Minimap:** 184×124 canvas. Islands are drawn as rounded rects with kind-neutral fills, the
  viewport as an accent rectangle, and search matches as yellow dots. Click or drag to pan.

### 6.8 Trace mode (from any node)

- **Entry:** "Trace from here" (inspector), `T`, or the context menu.
- The canvas swaps to a **trace flowchart**: dagre, rankdir LR, ranksep 72, nodesep 14, detail-tier
  node sizes. The board state is kept and restored on exit.
- **Trace bar** (44 px, top of canvas, `--fs-surface`):
  ```
  ⌂ Tracing from [ƒ enforceQuoteGate]   Upstream [−] 2 [+]   Downstream [−] 3 [+]   [✓] Show context   Exit trace (Esc)
  ```
- Depth: 0–6 each. Defaults: up 2, down 3. For a field: up 3, down 2.
- Fan-out cap: more than 6 neighbours of one node in one direction shows 5 plus a `+N more` pill.
  Clicking the pill expands that group in place.
- Context ring ("dim, don't remove"): nodes one hop beyond the depth limit render at 0.35 opacity
  with a `+` at their outer edge, which raises that depth by 1.
- Base node: accent ring and a home glyph. The `⌂` button re-centres on it.
- Cycles: the back-edge is drawn as a cascade edge with `↻`. Cycles are never unrolled.
- Cross-module hops are real edges here: the subgraph is small.
- Downstream through a field follows a cascade edge only if the writer that reached the field is
  cascade-eligible.
- **Fit:** fit all if the fit zoom is ≥ 0.62. Otherwise centre the base at 30% from the left at
  zoom 0.72 and let the user pan.
- Level labels above columns: `2 up · Start · 1 down`.
- Double-click a node to re-base the trace.

---

## 7. Field lens (headline)

### 7.1 Start state (Fields view, no field chosen)

Centred column, max-width 720, top padding 10vh:

- H1 22/700: **What can change a field?**
- Sub 14 muted: *Pick a field to see every rule, function, button, schedule and API entry point that
  can write it, and what reacts when it changes.*
- **Field picker:** 48 px combobox, the dashboard search style at 48 px.
  - Placeholder: *Search fields, e.g. Deals Stage*.
  - Dropdown is grouped by module. Each option: `Stage  Deals · Picklist  ·  8 writers`.
  - Type-ahead matches label or API name.
- **Most-written fields:** 6 chips, ordered by writer count, `Deals · Stage  8`. The ranking comes
  from the port (`mostWrittenFields(filters)`), so a chip's number is the lens's own distinct
  writer count in the same scope (declared, partial, "fields unknown" and unresolved-module sources
  each count once; record-only changes never count). The picker's per-field counts use the same
  ranking, and the lens is asked for with the current filters.
- **Or start from a question** (4 cards, 2×2, 64 px tall):
  - *What runs when a Deal is edited?* → Board, Deals, trigger filter "Edit".
  - *Which automations call external systems?* → List, filter "Calls external".
  - *Where could automation loop?* → List, filter "Cascades", sorted by cycle.
  - *Show me the whole map* → Board overview.
- **Estate strip:** one muted line, `48 rules (41 active) · 60 functions · 6 buttons · 4 schedules · 3 API functions · 8 modules`.

### 7.2 Lens layout (field chosen)

```
┌ Lens bar: ‹ back  Deals › Stage (breadcrumb)   Picklist · Stage   [Show on board] [Trace] [Copy link] ┐
│ Summary: 8 possible writers · 6 reactors · 2 possible cascades        Evidence: ━ declared ┅ inferred ═ unresolved │
├──────────────── WRITERS (1fr, 340–460) ──────┬─ FIELD (240) ─┬──── REACTORS (1fr, 320–440) ───────┤
│ group header + count                          │               │ Run when Stage changes (4)          │
│ writer cards …                       ──edge──▶│  [ Stage ]    │──edge──▶ reactor cards …            │
│                                               │   Deals       │ Check Stage in criteria (2)         │
│                                               │               │   → effects / cascade chips         │
├───────────────────────────────────────────────┴───────────────┴─────────────────────────────────────┤
│ Coverage footer (always visible)                                                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Columns: `minmax(270,460) minmax(196,240) minmax(250,440)`. The gap is `clamp(44px, 5vw, 80px)`
  and holds the edges. This fits 1024–1920.
- The lens scrolls vertically. The field card is sticky at top 74, below the lens bar.
- Edges: one SVG over the grid, recomputed on layout, resize (ResizeObserver) and scroll. They use the
  same styles as the board (§6.2).
- **Anchors spread** evenly down the field card's edge (top+36 → bottom−36), one per card, so the
  tiers stay distinguishable instead of bundling into one point.
- Criteria reactors use a dotted thin edge.
- Cards are `div role="button" tabindex=0`, not `<button>`, because they contain effect-chip buttons.

### 7.3 Writer groups (fixed order; empty groups hidden except where noted)

| Group | Source | Edge |
|---|---|---|
| **Declared in configuration** | workflow field-update actions, blueprint transition state and during-input fields, approval field updates | solid |
| **Functions · exact** | function writes, extraction `exact` | dashed |
| **Functions · partial** | `partial` (known key + possible unknown keys) | dashed + "+?" |
| **May write Deals · fields unknown** | known module, unknown field set | hollow |
| **Unresolved module** | unknown module | One summary line, collapsed by default: *7 functions write records in a module we couldn't resolve. They may affect this field.* with a "Show 7 functions" toggle that lists the cards. The number counts distinct functions, and they still count as possible writers. |
| **Other record changes** | delete, relate, attach and tag effects on this module's records (`otherRecordChanges`) | After the writers, collapsed by default, one summary line (*3 functions delete, relate, attach or tag Deals records. They do not set Stage, so they are not counted as writers.*). Cards have no connector and no re-trigger note, and never count as writers. |

**Writer card** (min 64 px, padding 10/12, radius 8):

- **Line 1:**
  - kind icon tile
  - writer name (13/600)
  - op badge: `Update`, `Create · sets initial value`, `Upsert`, `Convert mapping`, `Delete record`
  - confidence chip for inferred writes only: `exact` / `partial`
- **Line 2:** the path that reaches it, as compact chips:
  `⚡ Field changed: Stage › Stage gate: proposal… › ƒ enforceQuoteGate`.
  - More than one entry: `3 entry points ▾`, which expands.
  - Unreachable in Active scope: `Not reached by active automation` (Everything scope only).
- **Line 3:**
  - value: `= "Proposal"` (mono) or `expression`, or `value from code · line 18`
  - cascade annotation (one of):
    - `↻ May re-trigger workflow rules (trigger: workflow)` (amber)
    - `Workflow not requested (Deluge default)` (muted)
    - `Workflow trigger unknown` (muted)
    - `Possibly suppressed · same-record update from a workflow` (muted)
    - for declared field updates, `Workflow field update · re-trigger behaviour unverified`
      **[verify live]**
  - `not-requested` and `suppressed` draw no cascade edge. They stay as text, so their absence is
    explained rather than silent.
- Declared writes are labelled by the edge's own note: a workflow field update reads *Workflow field
  update · re-trigger behaviour unverified*, a Task's field mapping *Task created (field mapping) ·
  re-trigger behaviour unverified*, a conversion *Record converted (field mapping)*. Nothing but a
  real field-update action is called a field update (the inspector's "via …" rows follow the same
  rule).
- Click selects it, and the inspector opens on the function with the evidence line scrolled into view.

### 7.4 Field card (centre)

Field card, 240×auto, radius 14, 2 px `--am-k-field` border, tinted header:

- module chip, `Stage` 20/700, api name mono, type
- counts: `8 writers · 6 reactors`
- `Show on board` and `Trace` buttons
- **Breadcrumb trail:** pivoting to another field (via a reactor's effect chip) pushes onto the lens
  bar breadcrumb, `Deals › Stage  ›  Accounts › ARR`.

### 7.5 Reactors

- **Run when Stage changes:** rules whose trigger is a field update on this field, or edit rules whose
  repeat-on-field list includes it. Solid edge.
- **Check Stage in their criteria:** rules on other triggers whose criteria reference the field.
  Thin solid edge with a `criteria` label.
  - Sub-copy: *These run on their own trigger. Stage decides whether their actions fire.*
- **Reactor card:** rule name, trigger chip, criteria snippet (`Stage is Closed Won`) and effects as
  chips:
  - `→ Probability`
  - `→ Accounts · ARR ↗` (cross-module, amber when a cascade is possible)
  - `↻ Stage (loop)` (amber, bold) when the reactor can write this field back.
  - Clicking an effect chip pivots the lens to that field.

### 7.6 Coverage footer (always rendered; never collapsible)

> **Coverage:** 48 of 48 rules and 57 of 60 functions analysed. **3 gaps in the map** (functions not
> fully analysed or configuration Zoho did not return) could also write Stage. [View gaps]
> People, imports, integrations, blueprints, approvals and other automation this map does not index
> can also change Stage. This is a list of *possible* writers, not a guarantee that each one runs.

- The gap number is the store's single total (`coverage.gaps`): the pill, the banner, the live region,
  the coverage popover, this footer and the summary-row chip all show that one value.
- **No writers:** the group area shows *No known writers in analysed automation.* followed by
  *That is not proof that nothing writes Stage.* and the same coverage sentence.
- **Still loading:** a warn box above the columns: *Still analysing 31 of 60 functions. More writers
  may appear.* It uses the dashboard's `.wf-partial` box.
- **Empty while loading:** *No writers found yet.* followed by *31 functions are still being analysed.
  Workflow field updates and function writes appear here as they load.*

---

## 8. List twin

- **ARIA:** `role="treegrid"`, `aria-label="Automation map as a list"`.
- **Content:** the same nodes as the current filters (scope, modules, kinds, triggers, flags) and the
  same search.
- **Row:** 40 px; alternating `--fs-row-alt`; hover `--fs-row-hover`; selected uses the dashboard
  `.fs-row[aria-selected]` look.
- **Virtualised** above 200 rows (windowed, 12-row overscan).

| Column | Width | Content |
|---|---|---|
| ▸ | 28 | expand (outgoing + incoming edges as indented rows, grouped "Reaches" / "Reached by") |
| Kind | 132 | shape icon + kind label |
| Name | flex, min 240 | name + api name mono muted; match marks |
| Module | 120 | badge |
| Entry / trigger | 180 | trigger summary or "Button · Detail page", "Daily 02:00", "REST API" |
| Reaches | 110 | `4 actions · 2 fns` |
| Writes | 200 | field chips (max 3 + "+2") with evidence styling (solid/dashed/hollow outline) |
| Status | 88 | dot + Active/Inactive; `warn` icon for gaps |

- Header cells sort (asc/desc/none) via `aria-sort`. Default sort: Module, then kind order, then name.
- **Keyboard:**
  - ↑/↓ moves through rows.
  - → expands, ← collapses or moves to the parent.
  - Enter opens the inspector.
  - `B` shows it on the board.

---

## 9. Search and filters

### 9.1 Global search

- **Indexed text:** names, API names, criteria text, field-update values, template subject/body,
  webhook URLs, external hosts and Deluge source. This reuses the workflow search document and
  provenance model, extended to functions, buttons, schedules and API functions.
- Literal, case-insensitive, 150 ms debounce. Prefixes (v1): `module:`, `kind:`, `field:Deals.Stage`,
  which opens the lens directly.
- **Rail switches to Results mode** (header `Results for "Stage"` and `← Filters`), grouped by kind in
  legend order with counts.
  - Each result: icon, name, module badge, and a provenance line in the dashboard `.prov` style,
    e.g. `in code · line 14`, `in criteria`, `in field update value`, `in template body`.
  - **Field results come first.** Enter on a field opens the Field lens.
- **Search box counter:** `3 / 17`. Enter flies to the next match, Shift+Enter to the previous.
  Esc clears.
- **Board:** dimming as in §6.6. **List:** filters to matches. **Lens:** writer and reactor cards
  that match get the yellow ring.
- **No results:** *No matches for "xyz" in the mapped automation.* plus the coverage sentence if
  coverage is incomplete. Same style as the dashboard `fs-empty`.

### 9.2 Filters (rail)

- **Scope** (segmented, top of rail):
  - `Active automation` (default): *Active rules, buttons, schedules, API functions and everything they reach.*
  - `Everything`: *Adds inactive rules, unassociated functions and unused templates.*
- **Modules:**
  - Checkbox list in the dashboard `.opt` style, with counts.
  - Clicking the row text flies to the island. Clicking the box filters.
  - `Only` appears on hover.
- **Show** (legend = kind filter):
  - One row per kind: shape icon, label, count. Toggling hides that kind.
  - Hiding Actions reconnects rule→resource edges directly (they stay declared).
  - Hiding Fields hides Effects.
- **Triggers:** Create · Edit · Field change · Date/time · Email event · Button · Schedule · REST API · Blueprint · Approval.
- **Only:** `Writes fields` · `Calls external` · `Cascades` · `Has gaps`.
- **Active filter chips** (dashboard `.fs-chip`) appear in a 36 px state bar above the canvas when
  any filter is set, with `Clear all`.

---

## 10. Inspector (400 px)

**Head** (dashboard `.fs-info-head`):
- kind chip (shape icon + kind label, kind colour)
- name 16/700
- status (`.st.on/.off`)
- meta: module badge · api name (mono) · modified date

**Action row** (32 px buttons, wraps):
- `Trace from here` (primary outline)
- `Show writers` (fields only)
- `Open in Zoho ↗`
- `Copy link`
- `Show in list`

**Body sections** (`.fs-info-label` headings):

| Kind | Sections |
|---|---|
| Rule | Runs when (dashboard `.trg`) · Conditions & actions (dashboard `.cond`/`.act`, reused) · Writes · Possible cascades |
| Function | Called by (grouped by kind/module; hub shows all) · Writes (field, op, confidence, evidence line links) · Calls · External · **Source** · Analysis |
| Field | Writers summary (counts per group) + `Open field lens` · Reactors |
| Template | Subject · body preview (first 280 chars) · Used by |
| External | Host, method, connection · Called by · *Configuration only. Nothing is called from here.* |
| Button / Schedule / API | Placement / cadence / auth types · Runs (function) · Writes (via function) |
| Trigger node | Rules (list) |

**Source block:** reuses `view-code.ts`.
- **Evidence lines:** `--am-ev-line` background, a 3 px `--am-ev-bar` inset bar, and a right-aligned
  chip `writes Stage`. Multiple evidence lines get ‹ › stepping in the code bar
  (`Evidence 1 of 3`).
- Search hits keep the dashboard's yellow `.cl.hit`. When both apply, the evidence bar wins and the
  yellow appears as the background.

**Analysis box:** `Analysed · exact` (ok), `Partially analysed: 2 writes could not name every field`
(warn), `Not analysed: source unavailable` (bad), each with a reason.

**Footer:** `Open in Zoho` (primary, dashboard `.fs-edit-button`) + `Trace from here` (secondary).

**Handoffs:**
- Rules: workflow edit route.
- Functions: the existing function handoff.
- Fields: module field layout.
- Templates: template page.
- Buttons, schedules: their settings pages.

All handoffs open in a new tab.

**Lifetime.** The inspector follows the selection and closes with it: a search or rail result that
selects another node replaces its content; a filter, scope or list search that leaves the selected
node off the map closes it (the board only dims search misses, so it stays); a refresh that removes
the node closes it once loading has settled (never while the graph is still loading, and a link to
a node that never existed says "Not in the map"); opening another field's lens drops the previous
selection's details.

---

## 11. Deep links and state

- Hash: `#zcdt-map=v1;view=board;sel=rule:4823;z=0.92;c=1180,640;scope=active;q=Stage;mods=Deals,Accounts;field=Deals.Stage;trace=fn:991,2,3`.
- IDs in the hash are Zoho IDs that already exist in the page URL space. No names, except `q` (which
  the user typed) and the field API name.
- In the fog teaser the hash carries only `view` and the revealed node.

**History (`ui/history.ts`).** The map owns exactly one history entry while it is open:

- **Open** pushes one entry that carries the hash (`history.pushState`, with the page's own
  `history.state` kept and a marker added). Until the plan is known the hash is `view` only, so a
  link never names state the preview would have to withhold. A map opened from a link that is
  already in the URL first replaces that entry with the plain page, then pushes, so Back lands on
  the page; where the Navigation API shows the entry below is this same page (a link pasted into
  this tab), that entry is claimed instead and nothing is added. Forward onto an entry this document
  created is adopted as it is.
- **While open** the hash follows view, selection, field, trace and focus changes with
  `history.replaceState` (never a new entry): debounced 300 ms, bounded to 1 s so a steady stream of
  snapshots or camera moves cannot starve it, and written immediately for Copy link. Nothing is
  written once the page has moved to another route. Every write passes the same teaser boundary as
  reading a link.
- **Back** (a `popstate` or `hashchange` to a URL without a map hash) closes the map where the Zoho
  page stood, without touching history. Forward comes back through the entry's hash.
- **A hash that arrives while open** (hand edit, Back or Forward between map entries) applies the
  decoded state; what the hash leaves out resets to its default. A malformed hash changes nothing and
  is overwritten by the next write; in the preview only the view and a revealed node are taken.
- **Close** from the UI (×, Esc, backdrop) pops the entry with `history.back()` when it is still on
  top (the marker is intact and the path unchanged). Otherwise (the router replaced the state, a hand
  edit sits above it) it only removes the hash with `replaceState`. A replacing mount hands the entry
  to its successor. The map never assigns `location`, changes the route or reloads.
- The entry controller remembers the hash a closing map leaves behind, so the pop that follows is not
  taken for a new link.
- **[verify live]** that Zoho's router ignores the `popstate` of our own pop (same path, only the hash
  differs); nothing else on those routes uses the hash.

---

## 12. Keyboard map

| Key | Action |
|---|---|
| `/` | Focus search |
| `Esc` | Closes the first open item in this order: popover/menu → search text → trace → selection/inspector → map (restores focus to the invoker) |
| `F` / `B` / `L` | Fields / Board / List |
| `T` | Trace from selection |
| `W` | Field lens for the selected field (Show writers) |
| `+` `=` / `-` / `0` / `1` | Zoom in / out / fit all / zoom to selection |
| Arrows (node focused) | → first downstream neighbour · ← first upstream · ↑/↓ previous/next in lane |
| `Enter` / `Shift+Enter` | Open node, or next/previous search match |
| `[` `]` / `{` `}` | Trace downstream depth −/+ · upstream depth −/+ |
| `?` | Shortcut sheet |

- The canvas is one Tab stop (`role="group"`, `aria-roledescription="automation map"`) with a roving
  tabindex over nodes.
- On focus, a polite live region says
  `Workflow rule, Deal won – onboarding kickoff, Deals, active. 4 actions downstream, 1 trigger upstream.`
- The first focusable element in the canvas is a "Skip to list view" link.

---

## 13. States

| State | Treatment |
|---|---|
| **Loading** (cold, ~1–2 min) | Rule list arrives in seconds: islands render with rule cards, and lanes not yet loaded show skeleton nodes (`.skel`). Coverage pill `Mapping 38%` with mini bar. The Field lens shows the loading warn box. Inferred edges fade in (180 ms) as analysis lands. |
| **Cached** | Instant render. Pill `Mapped` or `Mapped · 3 gaps`. Footer `Cached 3 min ago`. Background refresh shows `· refreshing…` (dashboard behaviour). |
| **Partial coverage** | Pill warn. A `.wf-partial` box above the canvas: **3 gaps in the map.** *Some functions could not be analysed. Their nodes show a warning; inferred writes may be missing.* [View gaps]. Gap nodes show a dashed border and `warn` tile. |
| **Error (rule list failed)** | Canvas empty state: icon, **Couldn't load your automation**, *Zoho didn't return the workflow rule list. Nothing was sent anywhere; try again.* [Retry]. Pill `Map failed`. |
| **Empty org** | **No automation yet** · *This org has no workflow rules, buttons, schedules or API functions to map.* |
| **Filters hide everything** | **Nothing matches these filters** · [Clear filters] |
| **Left the route / signed out mid-session** | Same as the dashboard: abort, close, restore focus. |

**Coverage popover** (dashboard `.wf-pop`, 380 wide), titled `Map coverage`:
- Rows: Workflow rules · Rule details · Functions · Code analysed · Email templates · Buttons & schedules.
- Gap notes: `4 functions only partly analysed` · `1 source unavailable · 1 could not be parsed` ·
  `3 writes to a module chosen at run time`.
- Entry-point rows (buttons and schedules, blueprints and approvals) show loaded, failed and
  unsupported reads separately: `65 loaded`, `4 could not be loaded`, `12 not supported by Zoho`. An
  unsupported read is a fact about the module, not a fault.
- At most three failed dependencies are listed (`+N more`); the footer is always visible: the gap
  total, `Retry failed`, `Updated 4 min ago` (last successful revalidation) and `Refresh now`
  (revalidates every dependency, ignoring the 15-minute freshness window, ADR 0029).

---

## 14. Fog teaser (Free, signed-out, Plus and Plus trial)

**Concept:** the user sees the real *shape* of their estate, with real island geometry from cheap
list metadata, but only one real flow is drawn. Everything else is soft, drifting fog over
text-free silhouettes.

### 14.1 Hard constraint: no leak by construction

- Fogged regions are rendered from the contract's **`FoggedIsland`**:
  `{ slot, counts: { rules, functions, buttons, schedules }, recordWrites }`. It has no string fields
  at all.
  - The UI derives geometry and silhouettes from the counts (§14.3).
  - The lock chip shows `rules · functions · buttons`, or `schedules · API functions` for Org-wide.
- **`revealedModuleApiName: null`:** the whole board is fogged and nothing is revealed. The fog card
  says *Upgrade to Pro to map your org.*
- **`TeaserReason: 'unavailable'`** (the plan check failed): a warn line above the fog card,
  *We couldn't check your plan. Showing a preview.* with [Retry].
  - Module labels, rule names, function names, field names, hosts and template names are never passed
    to fog renderers.
  - This is enforced by type (no `string` fields) and by a unit test that serialises the fog DOM.
- This applies to every surface:
  - `title`, `aria-label`, SVG `<title>`
  - minimap
  - rail (module list shows `Module 1…n`, locked, no names)
  - hot fields
  - search results and datalists, plus their counts (§14.4)
  - list twin
  - inspector
  - trace
  - URL hash
  - DOM ids (opaque `fog-3`)
- Fogged islands **do not show module names.**
- **Allowed data:**
  - rule list
  - function catalogue: `associated_place` gives function→rule/button/schedule counts per module;
    `rest_api.active` gives API entry points; `tasks.integrations` gives the count of
    record-writing functions
  - **≤ 4 detail requests** for the revealed flow: 1 rule detail, ≤ 1 function source,
    ≤ 2 templates/action resources
- **Test:** collect every name in the fogged set and scan the overlay root's `innerText` and all
  attribute values. Expect 0 hits.
  - The prototype exposes this as `window.__amLeakCheck()`.
  - A headless run found 0 hits across 20 teaser states: board, overview, every inspector kind,
    search, fields, both lenses, list, trace, legend, coverage and upgrade. It ran both on a fresh
    load and after switching from Pro.
  - Port it as a unit test over the fog renderers.

### 14.2 What is revealed

> **Open point for the conductor:** ADR 0026 and `MapAccess.teaser.revealedModuleApiName` describe
> "one revealed island". This spec recommends revealing **one flow inside that island**: the
> island's real header and counts, with the rest of its rules as silhouettes. That keeps the
> detail budget at ≤ 4 reads.
>
> The UI renders whatever revealed subgraph the snapshot carries, so revealing the whole island is
> a data-layer choice with no UI change. The cost is about one rule detail per rule in that module,
> plus function sources.

- **One representative flow**, chosen deterministically, with no re-pick (re-picking would let users
  walk the whole estate):
  1. The module the user launched from: the Zoho workflow module filter, or the module of the rule
     behind "Show on map". Otherwise the module with the most active rules.
  2. Within it, the active rule with the richest chain that fits the request budget (≥ 2 action
     kinds, ≤ 1 function).
- Revealed nodes render normally and are fully interactive: inspector, code, trace up to the fog
  edge.
- The rest of that island: header with real name and counts (`Deals · 11 rules · 1 shown`), and
  silhouettes below the flow under a gradient veil.
- Hubs reached by the flow show the name and `Called by 14` (from the catalogue). Their effects
  render as `in the fog`.

### 14.3 Fog visuals (performance-safe)

- **Geometry:** fog islands use the same packing as Pro, from counts.
  - Width 1296 (Org-wide 960).
  - Height `92 + max(rules, functions/1.4, 4) × 64 + 22`.
  - The user sees the real *shape* of their estate.
- **Island base:** the island's own outline, drawn as the element's background: a chain of round
  lobes along the long axis plus one broad joining lobe (`fogLobes`), each a radial gradient
  (`#b0bcde`, about 0.6 alpha) that fades to nothing before the box edge.
  - **No mask and no clip.** The earlier design filled to the box edge and let a `mask-image`
    shape it; where the mask was not applied (a GPU declining a large masked surface) the boxes
    showed as straight-edged panels. Every layer now reaches alpha 0 inside its own element, so
    a layer that has not painted can never leave an edge. Keep this when adding a layer.
  - Round lobes, not one stretched ellipse: a wide, flat island read as a lens.
- **Silhouettes:** text-free **soft masses**, not crisp bars:
  - three to five overlapping puffs per mass, pale slate (`~#96a4d0`) at 0.07-0.15 alpha, every
    fourth mass lavender, on a bell-shaped five-stop falloff
  - wide masses that wander across neighbouring lanes (confined to a lane they stacked into
    vertical streaks), and round rather than flat puffs (flat ones read as eyes)
  - each puff is shrunk to fit inside the canvas and weighted by the island outline
  - painted once, so they read as blurred with no filter
  - rules lane: N blobs (N = real rule count); resources lane: from catalogue function counts;
    other lanes: decorative
- **Fog cover:** in world space (moves with pan/zoom for free).
  - Base `linear-gradient(160deg, rgba(246,247,252,.62), rgba(238,235,250,.5))`.
  - 3 drifting blobs (`radial-gradient(closest-side, …)`, 85% of the island).
  - Animated with `transform: translate3d()` only, 38–58 s alternate, staggered.
  - Ambient blobs between islands drift at 70 s.
- No `filter`, `backdrop-filter` or SVG filters anywhere. Fog is paused when culled, when the tab
  is hidden, and under `prefers-reduced-motion` (static fog).
- **Raster budget at the zoom floor:** the world layer keeps `will-change: transform`, whose raster
  scale does not follow the zoom. Below 0.2 (`FAR_ZOOM`, class `amc-far`) the hint is dropped so
  the compositor rasters at the current scale. Without that, the whole estate was held at 1:1,
  tile memory ran out and rectangles of the backdrop stayed unpainted: the "hard seams" of the
  third live pass (headless repro: a fifth of the canvas unpainted on about half the loads at 6%).
- **Revealed island:** a soft blue "clearing" halo behind it. Below the flow, a veil
  (`linear-gradient(transparent → rgba(244,246,251,.92) 90px)`) with two drifting blobs, over
  silhouettes of the remaining rules.
- **Arrival choreography:** the board opens at fit-all, showing the foggy estate. After 900 ms it
  flies (680 ms arc) to the revealed flow at zoom 0.86 (detail tier).
- **Overview tier:**
  - Fog islands show only their lock chip, scaled `clamp(0.9/z, 1, 6)` so it stays readable.
  - The revealed island shows a frame title `Deals [Preview]` and a summary card.
  - Module→module flows are not drawn in the teaser.
- **On any entitlement change, clear every view's DOM** (fields, list, trace, inspector, rail, both
  SVG layers). Hidden views otherwise keep names in attributes. The prototype's leak scan caught
  exactly this.

### 14.4 Lock affordances and copy

- **Lock chip** (centre of each fog island; `--am-pro-soft` background, 1 px `--am-pro` border at 30%):
  `🔒 11 rules · 9 functions · 2 buttons` plus a `Pro` badge.
- **Hover:** the fog thins (cover opacity .78→.62 over 300 ms) and the chip text becomes
  `Upgrade to Pro to see this module`.
- **Click:** opens the existing upgrade modal, configured for Pro (`featureId:'automationMap'`,
  Pro eligibility).
- **Header:**
  - a `Preview` chip next to the brand
  - an `Upgrade to Pro` primary button (violet `--am-pro`) left of the coverage pill
  - the coverage pill reads `Preview`
- **Legend button:** hidden in the teaser.
- **Floating card** (bottom-right, 16 px inset, 420 wide; it leaves the revealed flow visible;
  dismissible, collapsing to a pill `1 flow shown · the rest is in the fog [Upgrade to Pro]`):
  - Title: **You're seeing 1 flow. The rest of your org is in the fog.**
  - Body: *Automation Map shows every rule, function, button, schedule and API entry point, and every
    way each field can change. It's included in Pro.*
  - Plan line (by state):
    - Plus: *Your Plus plan includes Search All Workflows. Automation Map needs Pro.*
    - Plus trial: *Your Plus trial includes Search All Workflows. Automation Map needs Pro.*
    - Free or signed out: *Sign in and upgrade to Pro to map your whole org.*
  - Buttons: `Upgrade to Pro` · `Not now`
- **Fields view (teaser):**
  - The picker lists only fields touched by the revealed flow.
  - The writers column shows the revealed ones, then 4 silhouette cards and:
    *More writers are in the fog. 123 functions in this org write CRM records; Pro shows which ones
    can write Stage.* (The count comes from catalogue `tasks.integrations`.)
- **Search (teaser):** searches only the revealed preview.
  - Results header: `1 match in your preview`.
  - Then a constant lock row: *Pro searches all 49 rules and 56 functions: names, criteria,
    templates, webhooks and every line of code.*
  - **Never show a fogged-match count.** A count that changes per keystroke would let a user
    rebuild fogged names one character at a time.
- **List (teaser):**
  - revealed rows
  - up to 8 locked rows (lock, `In the fog`, counts only), largest first, then one line for the
    rest and one for modules without automation; flat and static, never blank striped rows
  - sticky lock row: `309 more items in the fog · Upgrade to Pro`
- **Inspector on fog:** lock panel with counts and CTA. No names.

**Upgrade modal copy** (Pro configuration of `upgrade-hook.ts`):
- Title: *Automation Map is a Pro feature*
- Body: *See everything that runs in your CRM and every way a field can change, mapped locally in
  your browser.*
- Benefits:
  - *Every rule, function, button, schedule and API entry point*
  - *Field lens: all possible writers and reactors*
  - *Trace any automation upstream and downstream*
- Plus users: the trial and upgrade labels must not imply Plus unlocks it.

---

## 15. Entry points

### 15.1 Workflow Rules toolbar button

- Placed directly after our `Search All Workflows` button, with identical CSS: 34 px, 4 px radius,
  `#b9c0cf` border, 14/500, same hover and focus. Gap 8.
- Icon: `map` (folded map, 17 px). Label: **Automation Map**.
- `title="See what runs in this CRM and what can change each field"`.
- No plan badge. Entitlement is checked on click (dashboard behaviour). Non-Pro users get the fog
  teaser, not a modal first.
- Below 1100 px toolbar width: icon-only, 34×34, with `aria-label`.

### 15.2 Settings home entry ("tile") **[verify live]**

- The settings route is still TBD: the bare `/settings` errored cold in research.
- **Placement:** inject one item into the **Developer Hub** section of the Setup home, directly after
  `Functions`.
- **Match the native item:**
  - clone the class names and structure of the sibling item at runtime
  - text `Automation Map`, plus a **NEW** badge
- **Badge:** copy the computed style of a native "New" badge on the page if one exists. Otherwise use
  this fallback:
  - 10/14 px, 700, uppercase, letter-spacing .04em
  - padding 0 6px, radius 3px, margin-left 6px, vertical-align 1px
  - fallback colours `#ffffff` on `#e8505b` (**placeholder; not a Zoho fact**)
- No "not by Zoho" disclaimer.
- Hide the NEW badge after first open or after 30 days (`chrome.storage.local`).
- Click opens the map on the Fields start state.

### 15.3 "Show on map" (workflow dashboard)

- Secondary button in the rule detail footer, between `Open in Zoho` and the function button:
  `Show on map` with the `map` icon.
- Lands as in §2. The graph usually has not loaded when the map opens: the board keeps the landing
  (selected node, module island) and, the moment the node exists, flies to it at a readable zoom
  (at least 90%) with a highlight and the inspector open. It does not move a camera that came from
  the link, and it gives up once the user has moved the camera, selected something else or loading
  ended without the node. An inactive rule is not on the active-scope board at all, so when the
  graph has the node and it is outside the active scope the scope widens to Everything once (the live
  region says so) before framing.
- Non-Pro users: the teaser, flown to the revealed flow, with that rule's island header highlighted.

### 15.4 Hash deep link

See §11.

---

## 16. Copy (all user-facing strings)

| Key | String |
|---|---|
| brand | Automation Map |
| views | Fields · Board · List (tooltips: "Field lens (F)", "Board (B)", "List (L)") |
| search.placeholder | Search rules, functions, fields, templates, webhooks and code… |
| scope.active / help | Active automation · Active rules, buttons, schedules, API functions and everything they reach. |
| scope.all / help | Everything · Adds inactive rules, unassociated functions and unused templates. |
| lanes | Entry · Rules · Actions · Resources · Effects |
| island.counts | {n} rules · {a} active · {f} functions · writes {w} fields |
| hub | Called by {n} · {m} here (tooltip: Hub function. Links are hidden to keep the map readable. Hover to show them.) |
| portal.out / in | → {Module} · {Field} / ← from {Module} ({n}) (tooltip: Writes {Module}.{Field}. Click to fly there.) |
| trace | Tracing from · Upstream · Downstream · Show context · Exit trace · +{n} more |
| lens.summary | {w} possible writers · {r} reactors · {c} possible cascades |
| lens.groups | Declared in configuration · Functions · exact · Functions · partial · May write {Module} · fields unknown · Unresolved module |
| lens.reactors | Run when {Field} changes · Check {Field} in their criteria |
| ops | Update · Create · sets initial value · Upsert · Convert mapping · Delete record |
| action kinds | Field update · Email notification · Task · Webhook · Function call · Cliq message · Assign owner · Add tags · Convert |
| cascade | May re-trigger workflow rules (trigger: workflow) · Workflow not requested (Deluge default) · Workflow trigger unknown · Suppressed · same-record update from a workflow |
| evidence legend | Declared in configuration · Inferred from Deluge code · Unresolved |
| coverage.pill | Mapping {p}% · Mapped · Mapped · {n} gaps · Mapping stopped · Map failed · Preview |
| coverage.footer | Coverage: {r} of {R} rules and {f} of {F} functions analysed. {g} functions could not be fully analysed and could also write {Field}. |
| unindexed note | People, imports, integrations, blueprints, approvals and other automation this map does not index can also change {Field}. This is a list of possible writers, not a guarantee that each one runs. |
| inspector.buttons | Trace from here · Show writers · Open in Zoho · Copy link · Show in list |
| toast.copied | Link copied |
| external.note | Configuration only. Nothing is called from here. |
| fog strings | §14.4 |
| states | §13 |

---

## 17. Accessibility

- **The List twin is the full equivalent of the Board.** Every board fact (kind, name, module,
  trigger, reaches, writes, evidence tier) is in the treegrid. Evidence tiers appear in text
  (`Inferred · exact`), not only as dash patterns.
- Focus ring: the dashboard's `2px solid var(--fs-accent)`, offset 1. On nodes it combines with the
  selection ring.
- **Contrast:** text ≥ 4.5:1; kind colours only for icons and borders (never text below 3:1); the
  0.2 dim applies to context only, never to the focused node.
- **Live regions:** search counts, progress milestones (25/50/75/100%), "Link copied".
- **Reduced motion:** no fly animation, no fog drift, no shimmer.
- **Semantics:** the overlay is `role="dialog"` with `aria-modal="true"` and
  `aria-labelledby` = brand. Focus trap and focus restore follow the dashboard.

---

## 18. Engineering notes (UI only)

- **Render budget:** ≤ 1,500 board DOM nodes at any zoom (culling + LOD); ≤ 1 SVG path per edge;
  hover and selection are class toggles; pan/zoom writes only one `transform` and CSS vars.
- **Layout:** islands are hand-laid (§6.1). Dagre is lazy-loaded for Trace and Field lens only
  (graphs < 200 nodes).
- **Reuse:** `view-dom.ts`, `view-icons.ts` (+ `cursor`, `plug`, `globe`, `field`, `workflow`, `map`,
  `module`, `lock`, `home`), `view-code.ts`, the coverage pill/popover pattern, `.fs-*`/`.wf-*` classes
  for the rail, chips, rows, inspector and empty states.
- **Fog** is its own renderer with its own view-model type (§14.1). Do not branch inside the board
  renderer on `isTeaser` with real data in hand.
