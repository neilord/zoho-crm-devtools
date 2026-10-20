# Zoho Integration

## Scope

The extension targets Zoho CRM only.

## Discovery Notes

This document records observed external contracts: Zoho's DOM, selectors, variables, endpoints, and
page globals. The rules for investigating those contracts and where integration code belongs live
in [`conventions.md`](conventions.md) §7.

## Live Findings

- The functions list is available at `/settings/functions/myFunctions`.
- The September 2026 Functions UI also serves the list directly at `/settings/functions`.
- Editable rows can expose a `Function Details` dialog with an `Edit Function` action.
- The current editor opens in-place with a left rail, editor canvas, and right metadata panel.
- The bottom-left gear opens a native `Settings` dialog.
- The current settings dialog has `General` and `Editor` groups with visible items:
  - `Theme`
  - `Syntax Assist`
  - `Font`
  - `Word Spacing`
- The theme page renders a native Lyte dropdown at `lyte-dropdown[data-zcqa="dxDroptheme"]`.
- The live native theme options currently observed are:
  - `vs-dark` → `Dark`
  - `vs-darkplus` → `Midnight Blue`
  - `vs-light` → `Light`
- Native theme selection updates the dropdown's `lt-prop-selected`, visible label text, and selected
  state on `lyte-drop-item` nodes while Zoho flips the page-level `deluge-theme`.
- A custom theme can preserve native behavior by acting as a managed alias of either `vs-dark` or
  `vs-light`: the extension presents the custom option, then delegates the real mode switch back to
  the matching native option.
- Because Zoho mutates dropdown DOM and selected-state attributes after interaction, custom options
  need lightweight reconciliation for injected nodes, visible labels, and checkmarks.
- Reconciliation must mutate only when the selected state is actually wrong. Unconditional class
  or attribute rewrites feed the observer's own mutation loop and can crash the tab; preserve the
  hover guard before moving `lyteDropdownSelection` away from the native alias.
- When more than one custom theme exists, reconciliation must clear selected-state attributes from
  the inactive custom options; otherwise previously chosen custom entries can remain selected beside
  the current one in Zoho's cloned dropdown body.
- Restoring a persisted custom theme after reload must also reapply the matching native `vs-dark` or
  `vs-light` alias. Zoho can reopen with a different native mode even while the extension restores the
  custom label and palette class correctly.
- The current visible Deluge editor is CodeMirror 5. Its live host carries
  `.CodeMirror-deluge-edit-task`; visible code lines render as `.CodeMirror-line` nodes and Zoho
  materializes editor-managed indentation as `.cm-tab` spans with `cm-text="\t"`.
- Zoho's `cm-syntax` bucket is used for callable / built-in-looking Deluge tokens such as `info`,
  `zoho`, `.get`, and `Map`; map it independently from string literals so richer themes preserve
  useful semantic separation.
- Advanced syntax highlighting is extension-owned and toggled by marking live editor hosts with
  `data-zcdt-syntax-enhancement="true"`. Keep syntax color rules scoped to
  `.CodeMirror-deluge-edit-task` and refine the existing CodeMirror spans instead of rewriting tokens.
- Live browser debugging showed the CodeMirror instance is page-owned and not directly reachable from
  the extension content-script world. Do not split rendered CodeMirror token spans or replace their
  text nodes from the content script: CodeMirror caches a render-time line map for cursor and click
  measurement, and post-render token rewrites can move or hide the caret. Grouped member access such
  as `pLeadDetailFields.add` should be annotated on the original token unless a page-owned CodeMirror
  integration can update the editor's own measurement state. Paint-only split coloring is acceptable
  when it leaves the original element and text node in place.
- CSS-only adjacency is not enough for every Deluge token because CodeMirror emits both callable
  tokens like `ifnull(` and plain arguments like `recId_)` as `.cm-variable + .cm-brackets`. The MVP
  syntax layer therefore annotates existing spans with `data-zcdt-token` from token text and immediate
  neighbors, without parsing or rewriting editor content.
- Live inspection also showed several Deluge-specific token roles that should not fall into the generic
  callable bucket: `standalone` / `automation` service namespaces, their dotted callable suffixes,
  `invokeurl`, invoke block keys such as `url` and `type`, HTTP method words such as `GET`, and the
  `index` modifier in `for each index i`.
- Live syntax inspection confirmed Zoho's `.cm-syntax` is mixed: control words such as `if` and
  `else`, type/constructor-looking tokens such as `string`, `String`, and `Map`, and member calls
  such as `.put` can all use that class. Prefer scoped adjacent-token selectors over treating
  `.cm-syntax` as one semantic color.
- Deluge member calls are emitted two ways: some methods are separate `.cm-syntax` spans after a
  `.cm-variable`, while chained methods such as `phoneNumber.trim` can remain a single
  `.cm-variable` span before `.cm-brackets`.
- Useful observed Deluge token classes include `.cm-comment`, `.cm-syntax`, `.cm-variable`,
  `.cm-string`, `.cm-constant`, `.cm-operator`, `.cm-relop`, `.cm-logicalOpr`, `.cm-tag`,
  `.cm-separator`, `.cm-semicolon`, and `.cm-brackets`. Zoho reports comparison glyphs such as
  `>` as `.cm-tag`, so the enhancement maps `.cm-tag` and `.cm-relop` to
  `comparison-operator` while keeping boolean operators such as `&&` / `!` as
  `logical-operator`.
- Indent-guide styling can stay native and width-safe by decorating those existing `.cm-tab` spans
  instead of estimating grid columns across the whole editor surface. The older public extension used
  the same `.cm-tab` idea globally; this codebase scopes it to the live Deluge CodeMirror host.
- A plain background on `.cm-tab` paints only the tab span's box, while Zoho's line rows include
  extra vertical padding; use a guide pseudo-element that bridges that padding when the rail must read
  as continuous instead of dashed.
- `#createfunctionpopdiv` still exists during live editing, but the visible CodeMirror host is not a
  descendant of it; keep using live inspection before scoping visual editor features to legacy mounts.
- Zoho can rewrite page-level state during setup, so one-time global flags are brittle for editor
  visuals. Reapply feature state when the live editor surface mounts instead.
- Live theme auditing shows two styling paths inside the editor:
  - many editor surfaces and syntax colors respond to `--dre-*` / `--delg-*` variables
  - some surfaces, such as parts of the revision-history UI, are painted by compiled selector rules
    instead of a reusable variable layer
- The theme-polish work therefore needs both a low-level variable inventory and a small shared
  selector-override compatibility layer for surfaces Zoho does not expose through variables.

### Confirmed theme-surface inventory

The current custom-theme implementation keeps the palette in `src/themes/themes.css`, maps supported
Zoho variables in `src/themes/zoho-theme-mapping.css`, and keeps selector-only compatibility rules in
`src/themes/zoho-theme-overrides.css`.

| Surface family | Confirmed path | Notes |
| --- | --- | --- |
| editor canvas, gutters, syntax, active line, selection | `--dre-editor-*` | Native variable layer is reliable. |
| inline editor search matches | shared selector override | Search matches are `.cm-overlay.cm-searching` spans painted by CodeMirror plus a later hardcoded Zoho rule; override that span directly for the normal match background and border. The current match is CodeMirror's `CodeMirror-selected` rectangle while `.CodeMirror-search-field` is open; keep this as a simple palette-backed background plus inset ring even though Zoho's rectangle can be slightly wider than the inline match span. |
| top bar, side rail, right rail, details pane, generic shell colors | `--delg-*` | Includes `--delg-topbar*`, `--delg-sidebar*`, `--delg-rightbar*`, `--delg-info*`, and `--delg-active*`. |
| left task pane, bottom bar, show/hide tooltip | `--dre-leftpane-*`, `--dre-bottombar-*` | The selected rail state is variable-driven through `--delg-activebg` / `--delg-activeborder`, not selector-only. |
| hints/autocomplete list, diff/merge surfaces, expression builder | `--dre-editor-hint-*`, `--dre-codemirror-merge-*`, `--dre-expr-builder-*` | Native variables cover the main surfaces well. |
| autocomplete documentation tooltip text | shared selector override | Zoho first uses the hint variables, then a later compiled rule hardcodes `.CodeMirror-Tern-hint-doc { color: #444; }`. |
| autocomplete divider, inline gutter edit button, inner editor status bar | shared selector override | `.hint-divider`, `.deluge-gutter-edit-btn`, and `.clientscript_status_bar` are small interaction surfaces that bypass the useful variable layer. |
| revision/history shell | shared selector override | `.csRH*`, `.dxe_widget_sidebar`, and `.dxe_version_history_container*` are compiled with hardcoded colors. |
| settings modal, editor toolbar selected state, some editor dropdown/input shells, console fragments | shared selector override | These use compiled rules such as `.ceEditorSettingModal*`, `.ceToolbar*`, `.ceInfoZDK*`, and `.csconsole*`. |

When a new untouched island appears, first inspect whether it already resolves through a low-level
Zoho variable. Only add a selector fallback after confirming that the compiled rule bypasses the
usable variable layer.

## Cross-function search

The cross-function search feature (`src/content/functions`) reads Zoho's own internal CRM REST API
from the isolated content script. It is a clean reimplementation of a third-party tool; the durable
Zoho knowledge it depends on is recorded here because those endpoints are undocumented and the page
anchor is selector-fragile.

### Request context

- The content script shares the page origin, so same-origin `fetch` with `credentials: 'include'`
  carries the session cookies automatically. We only add the headers Zoho's own UI sends.
- Org id (`X-Crm-Org`): parsed from the URL path segment `/org<digits>/` rather than a page global,
  so the data path needs no main-world access. This equals `Crm.currentZgid`.
- CSRF (`X-Zcsrf-Token`): the `CSRF_TOKEN` cookie, sent as `crmcsrfparam=<token>`. The cookie is not
  HttpOnly, so the content script can read it via `document.cookie`.

### Endpoints (internal, `v2`, undocumented — read defensively)

- List: `GET /crm/v2/settings/functions?type=org&start=<n>&limit=200`. Paginated; page forward by 200
  until a short page or HTTP 204. Each item ("summary") carries `id`, `display_name`, `api_name`,
  `category` (e.g. `Standalone`, `Automation`, `Dynamic`, `ExtensionAction`), `language`, `source`,
  `description`, `createdTime`, `updatedTime`, optional `workflow.namespace` (used as the finer
  category for extension functions), `associated_place[]`, `rest_api[]`, and `tasks`.
- Detail: `GET /crm/v2/settings/functions/<id>?language=<language>&source=<source>`. Returns
  `{ functions: [ { id, script | workflow, name, modified_by, params, associated_place, ... } ] }`.
  `script` holds the Deluge source for standalone functions; `workflow` holds it for automation
  functions. Details are fetched lazily in the background to make full-text (source) search progressive.

### "Search All Functions" anchor (fragile)

- The September 2026 UI exposes `[data-zcqa="fxn_lv_search"]` inside
  `[data-zcqa="fxn_lv_search_parent"]` in the flex toolbar beside Sort and Filter. Insert after
  that wrapper to keep Search All Functions immediately to the right of native Search, outside
  the Lyte input. These hooks take precedence over legacy search hooks. Observed in an
  authenticated EU org; `tests/functions-page.test.ts` contains a sanitized minimal fragment.
- The functions list lives under `/settings/functions`. The preferred anchor is Zoho's native function
  search control (`#functionSearch` / `data-zcqa="cfSearchFunctions"`), so "Search All Functions" sits
  beside the built-in search box. Zoho wraps that Lyte input in `.search-function`; insert after the
  wrapper rather than after the input itself, because the input is full-width inside the wrapper and
  will push sibling content to the next line. If that control is missing, Zoho's "Create Function"
  control is used as a fallback; it has no stable hook, so it is matched by visible text
  (`/create function/i`) over `button, a, lyte-button, lyte-yield, [role="button"]`, choosing the
  smallest matching element. The button is re-checked on DOM mutation because the page is a single-page
  app.

### "Edit in CRM" (requires page globals)

- Opening Zoho's native editor needs page globals the isolated world cannot reach. The bridge lives in
  `public/zcdt-function-edit-bridge.js` (plain JS) and is listed in the manifest
  `web_accessible_resources`. The content script injects it on demand as a page `<script>` element
  (`src/content/functions/edit-in-crm.ts`); a web-accessible script bypasses the page CSP, while an
  inline script would not. The overlay hands off via `window.postMessage` (namespaced
  `zcdt-function-search`); the bridge never touches `chrome.*`.
- Note: the bundler's `world: "MAIN"` content-script loader is **not** usable here — it emits a
  relative `import()` that resolves against the page origin (a 404) instead of the extension, so the
  bridge never runs. Self-injecting a stable-named web-accessible script avoids that.
- The bridge calls `Lyte.Router.transitionTo('crm.settings.section.functions.myFunctions')`, then
  `customFunctionsObj.renderEditorView(JSON.stringify(detail), '', '', 'edit')`, retrying until
  `customFunctionsObj` exists. If an editor wrapper (`crm-deluge-editor-wrapper`) is already open it
  first calls `customFunctionsObj.leavePage('close')`.
- Confirmed live: `renderEditorView` runs `JSON.parse` on its first argument internally, so it expects
  a JSON **string**, not the already-parsed detail object our fetch layer produces
  (`response.json()` in `src/content/functions/api.ts`). Passing the object directly makes
  `JSON.parse` coerce it to the string `"[object Object]"` and throw
  `SyntaxError: "[object Object]" is not valid JSON`, which silently aborted the editor open (the
  overlay had already closed by then, making it look like the button did nothing).

## Known fragile boundaries

- Durable selectors for the current editor mount and settings trigger
- Which less common editor-owned overlays outside the current audit states still bypass variables,
  especially rare error and helper popovers
- The cross-function search fallback anchor, endpoint shapes, and editor globals are undocumented;
  they require a live regression check whenever that integration changes.

## Function export integration

Export reuses the observed list/detail endpoints and their request-context adapter. Both export and
search pass `summary.source` verbatim (default `crm` only when nullish), and use the same language,
cookie credentials, org and CSRF headers. No category-specific alternate endpoint is verified.
Export always reads fresh details, while search reuses its cache and tolerates unreadable details.

Owner-supplied October 2026 evidence from a large `.com` org: paginated lists return 200, several
`source=crm` detail requests return 503, and a different function with `source=extension` returns
200. These are different IDs, so this does not demonstrate that changing source fixes a function.
History of `api.ts` shows this source contract since search's introduction; later changes handled
204, redirect rejection and strict export identity validation, not a source remapping. A server-side
function-specific failure or transient overload is plausible, but the cause of 503 is unconfirmed.
Search working does not prove every fresh detail succeeds: its cache and failure tolerance differ.
Do not guess source values or endpoints from category. Export retries 429/5xx, bounds concurrency,
and accounts for persistent failures in the local file; see `architecture.md` §10 and ADR 0022.
No Zoho write, alternate endpoint or new selector was introduced. Real-org acceptance remains
required; the automated toolbar harness uses sanitized existing new-layout hooks only.

## Workflow Rules indexing (observed 2026-10-20)

These contracts come from authenticated, read-only native UI/network research in a US CRM org.
Fixtures in the repository are independently invented; raw research and customer configuration
stay outside git. Other DCs and legacy Workflow UIs still require acceptance checks.

### Routes and toolbar

The list route is `/crm/org<digits>/settings/workflow-rules`; the native rule view appends
`/<ruleId>`. Use the complete path (the bare settings route was not valid). The native anchor is
`list-workflows #wfSearchWithName1`, also observed as
`list-workflows lyte-input[data-zcqa="wfSearchWithName1"]`. Insert after this outer Lyte input,
not its inner input or a global Search placeholder. Its flex parent already contains an `mlAuto`
right action cluster. Native rule navigation detaches the anchor; Back creates a new node in the
same document. `zoho/workflows-page.ts` reports delayed mounts, replacements and route departures;
it does not render controls. Only this toolbar variant was observed.

### Read-only requests

All requests use the page origin, `credentials: include`, `redirect: error`, `X-Crm-Org` from the
numeric URL org and `X-Zcsrf-Token: crmcsrfparam=<CSRF_TOKEN cookie>`. Both explicit headers were
necessary in independent probes. JSON Content-Type is compatible with the existing Functions
adapter. Native tracing/version/X-Requested-With headers were unnecessary. No OAuth token,
page-world read bridge, host permission, webhook invocation or CRM write is required.

| GET path | Envelope / contract |
| --- | --- |
| `/crm/v8/settings/automation/workflow_rules?page=1&per_page=200` | `workflow_rules[]`, `info.more_records`; one-based pages, deduplicate IDs, reject repeated pages |
| `/crm/v8/settings/automation/workflow_rules/<id>` | Exactly one matching `workflow_rules[]` item; list summaries omit conditions/actions |
| `/crm/v8/settings/automation/<resource>/<id>` | Matching plural array; resource is `functions`, `email_notifications`, `tasks`, `field_updates` or `webhooks` |
| `/crm/v8/settings/email_templates/<id>` | `email_templates[]`: name, subject, content/mail_content |
| `/crm/v8/settings/fields?module=<api_name>` | `fields[]`: id, api_name, field_label/display_label; exact joins, no guessed labels |
| `/crm/v2.2/settings/modules?feature_name=workflow` | Observed native module-label metadata; not needed by the current loader, which retains API names when labels are absent |

Resource URLs do **not** contain an extra `/actions/` segment. Action library lists also exist,
but can differ in projections/counts from detail; the index reads only referenced details.
Visible table rows and `info.count` are not completeness evidence. Null conditions/actions/schedules
are valid. The shared transport uses a 15-second request timeout, up to three retries for 429/5xx,
500ms exponential backoff plus up to 250ms jitter, with Retry-After seconds/date as a minimum.
Retries retain their slot. Workflow rules/resources/templates/metadata/catalogue/sources and Export
share one tab request budget of four. Existing free Functions search keeps its legacy loader.

### Shapes and namespaces

Rules carry `status.active` independently of `category` (an active draft was observed), plus
`deprecated`, `modified_time`, module, description and `execute_when:{type,details}`. Detail adds
ordered `conditions[]` with `sequence_number`, `criteria_details.criteria`,
`criteria_details.relational_criteria`, `instant_actions.actions[]` and
`scheduled_actions[]:{id,execute_after,actions}`. Criteria are recursive `group_operator/group`
or `field/comparator/type/value` predicates. Keep expressions and non-scalar values verbatim;
never evaluate merge expressions. Preserve schedule objects, including field-relative offsets.

Observed trigger types: field_update, create, create_or_edit, edit, date_or_datetime, mail_sent,
mail_sent_opened, mail_sent_bounced, email_received, section_update, incoming_call_createedit,
outgoing_call_createedit. Field updates carry criteria/repeat/match_all; date triggers carry
field/unit/period/recur_cycle/execute_at. Preserve `b_days` without inferring its semantics.
`details.trigger_module` can differ from the rule module (related Notes creation).
Section IDs are searchable; section/layout labels have not been established.

Resource shapes: field updates expose field/type/value/related_module; tasks expose field_mappings
with field/type/value/display_value; email notifications reference template IDs and recipient
configuration; webhooks expose URL/http_method/headers/parameters/body/authentication. Index
configuration as data, never contact configured destinations. Slack (`slack_notifications`),
assign_owner, add_tags and convert are inline `details`; preserve message/notify_to, assign_to,
tags/over_write, and conversion field_mappings/configuration respectively. Unknown trigger/action
wire types remain visible searchable JSON. Delete/score/Cliq-specific schemas are unverified.
Template markup is parsed through DOMParser inside an inert template wrapper with closing-template
tags escaped, then reduced to text; it never reaches an HTML injection sink or the live DOM.

A workflow **action ID**, nested automation `function.id` (**CRM ID**), and Functions catalogue
`id` (**Deluge ID**) are different namespaces. Resolve automation `function.api_name` to one exact
catalogue `summary.api_name` from the existing `/crm/v2/settings/functions?type=org&start=1&limit=200`
pagination. Then use that summary's own id/language/source with the existing detail endpoint.
Never infer the source enum from an automation binding (`platform_plugin` can join to `extension`).
A unique display_name/workflow.name-only candidate is **uncertain** and is not source-indexed;
ambiguous/missing candidates are **none**. Catalogue `api_name` can be JSON null even
for unrelated functions. Cache projection converts non-string names to absent values and retains
`workflow.name` and the source enum, so a nullable unrelated entry cannot reject the graph or alter
name-only joins on hydration. Name-only joins require a non-empty binding name. Identical
catalogue IDs count once; conflicting identity metadata (API/display/workflow name, language or source)
remains unresolved regardless of order. The workflow reader rejects conflicting duplicate catalogue
identities before the shared pagination helper discards duplicates; this is a retryable catalogue
failure rather than a first-page-wins join. See ADR 0024. HTTP 200 without nonempty script/workflow is explicitly
unavailable. Related editor handoff opens a fresh same-origin Functions tab using a short-lived, single-use
hash marker containing org, Deluge ID and API name (no code). The Functions bootstrap consumes
it before awaiting readiness, then re-resolves catalogue ID/API name and its own language/source
and refetches a strictly matching detail. A separate acknowledged workflow bridge contract renders
only on the Functions route; it never transitions the Workflow Rules SPA or closes a stale hidden
editor wrapper. Failures remain visible on the destination page. Search All Functions keeps its
legacy handoff. See ADR 0024. Zoho may redirect `/settings/functions/myFunctions` to
`/settings/functions`; workflow handoffs accept both and wait at most ten seconds for the native
list search control and `customFunctionsObj.renderEditorView` together.

### Progressive coverage and local cache

The index emits list metadata before enrichment, deduplicates shared resources/templates/sources,
and retains each condition/instant/scheduled occurrence. Failure handles retry just their dependency
and discover downstream dependencies. Complete coverage excludes failures and missing/uncertain
source. Gap counts are unique failed dependencies plus missing/unmatched sources and uncertain
bindings, not the number of affected rules (one source may affect several rules). The Source
unavailable filter also includes pending sources. Retryable source failures have their own note;
a failed re-read of a cached missing source counts once. Development completion diagnostics report
available/missing/unmatched/uncertain counts and failure categories without CRM identities or text.
Aborted, disposed or changed-origin/org instances cannot publish stale responses.

The worker accepts only exact `workflows:readCache` / `workflows:writeCache` messages with a
supported HTTPS CRM/Portal origin and numeric org. The derived namespace includes **origin+org**;
no arbitrary storage keys/URLs/headers are accepted. Schema version 2 wire graphs (with version 1 read compatibility) live in the
`zcdt-workflow-caches-v1` bucket: maximum three partitions, 3MB each, 6MB total with oldest eviction.
Oversized/invalid writes fail harmlessly; hydration re-normalizes wire nodes. Validation checks
the envelope and graph structure without closing raw action/trigger unions or requiring numeric
cache identifiers. Legacy normalized nodes can have numeric, absent or null raw IDs. Nullable API
names, empty strings and unfamiliar identifiers remain advisory data; API reads and handoffs retain
their independent identity checks. Development failures report an indexed structural path and static
reason (including decoded/encoded size limits), without CRM values or map keys. Shared action
resources, templates, catalogue, metadata and sources are stored once per dependency, avoiding
normalized per-occurrence duplication. Cached data stays visible through list pagination and
background enrichment. Freshness is tracked separately from presence; matching non-null
modified_time allows reuse of rule detail, and unchanged function catalogue identity plus non-null `updatedTime` allows reuse of source.
The catalogue list is re-read each load; changed/unknown source timestamps require a detail read.
Source-refresh failures retain cached text but do not persist the new timestamp as freshness proof.
Actions/templates/metadata are re-read because no reliable independent change signal is known.
Settled cached coverage shows its complete/gap state plus “refreshing…” until revalidation settles;
refresh failures retain cached search data and expose retryable failures. Cache I/O and workflow API I/O both require current paid access first.
