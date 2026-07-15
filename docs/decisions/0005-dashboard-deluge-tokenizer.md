# 0005 — Own Deluge tokenizer for the dashboard preview

- **Status:** Accepted
- **Date:** 2026-07-15

## Decision

Highlight Deluge in the function-search dashboard preview with a small, hand-rolled,
dependency-free tokenizer (`src/syntax/deluge-tokenizer.ts`), not tree-sitter, WASM, or a
CodeMirror instance. The tokenizer is a pure `tokenizeDeluge(source) → DelugeToken[]` function
(text in, tokens out, no DOM) whose tokens tile the source with no gaps. It emits the same
`data-zcdt-token` categories the live editor uses, classifying identifiers from a shared word
vocabulary (`src/syntax/deluge-vocabulary.ts`) imported by both the editor refinement layer and
the tokenizer. The preview renderer (`src/content/functions/highlight-source.ts`) wraps tokens in
`data-zcdt-token` spans and composites the search-term `<mark>` on top, within each token span.

The dashboard overlay lives in a shadow root, so the editor's `--zcdt-syntax-*` cascade (scoped to
the editor host) does not reach it. The preview resolves the palette itself in `overlay.css`,
scoped to `.fs-code[data-zcdt-syntax-enhancement="true"]`, with the token colours **hardcoded to
Zoho's native light Deluge palette** (mirroring themes.css' `:root[deluge-theme="light"]` mapping).
The preview surface is always light for this release.

Following the user's *active* editor theme was prototyped (pulling `--zcdt-theme-editor-*` through
the shadow boundary, which does inherit — `:host { all: initial }` does not reset custom
properties) but **deferred**: on the functions-list page those variables are not present (no custom
extension theme selected, and Zoho's `deluge-theme` is absent when no editor is mounted), so the
preview cannot see the active theme there without first persisting it. That persistence is a
separate, announced feature. Because the token → colour indirection (`data-zcdt-token` →
`--zcdt-syntax-*`) is unchanged, enabling theme-following later is a palette-source swap in
`overlay.css` (literals → `var(--zcdt-theme-editor-*, …)`), not a pipeline change.

The live editor's highlighting is untouched.

## Rationale

The extension has zero runtime dependencies and keeps them out. The live Deluge editor is
contractually forbidden from being re-tokenized (rewriting its spans breaks caret measurement — see
`zoho-integration.md`), so a shared tokenizing *engine* across the two surfaces is impossible
anyway. The durable shared thing is the colour vocabulary: the `data-zcdt-token` categories and the
`--zcdt-syntax-*` variables. Extracting the word/prefix sets into `deluge-vocabulary.ts` and
importing them on both sides means the two surfaces can never drift on what counts as a control
word, type, namespace, or HTTP method. A pure tokenizer with a real token stream is also cleaner
than the editor's neighbour-span peeking, so the preview can be *more* consistent than Zoho's own
tokenizer; minor edge-case differences from Zoho are acceptable.

The tokenizer's purity (no DOM) keeps a future CodeMirror-overlay reuse open without committing to
it now.

## Consequences

- Deluge word/prefix vocabulary has one home (`deluge-vocabulary.ts`); changing a keyword or type
  set updates both the editor and the preview at once.
- The category → colour mapping is intentionally restated in `overlay.css` because the editor
  cascade and the shadow-root preview are disjoint CSS scopes; the shared contract is the token
  vocabulary, not the rules. A new token category must be added in three places: the tokenizer's
  classifier, the editor CSS, and the preview CSS block.
- The preview always renders on a light surface with Zoho's native light palette; it does not yet
  follow the user's active editor theme. Making it follow is a future feature that must first
  persist the observed editor theme (Zoho's `deluge-theme` is not exposed on the functions-list
  page), then source `--zcdt-syntax-*` from `--zcdt-theme-editor-*`.
- Bracket-pair/rainbow colouring and other effects the live editor cannot match are out of scope;
  consistency with the editor comes first.
