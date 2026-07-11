# Conventions — how we work

This is the single operating manual for the repository. Git, landing, verification, release,
debugging, and code-style rules live here and nowhere else.

## 1. Branches

- Every change lands through a short-lived branch; do not commit directly to `main`.
- Name branches `<type>/<area>-<thing>` where practical: `feat/search-filter`,
  `fix/editor-cursor`, `docs/agent-context`, or `chore/release-2-2`.
- Keep one concern per branch. Do not publish exploratory branches until the approach is agreed.
- Never force-push a branch another contributor may have used.

## 2. Commits

Use Conventional Commits with an area scope:

```text
feat(search): add category filtering
fix(editor): preserve cursor measurement
docs(conventions): document the release flow
chore(release): prepare version 2.2.0
```

- Prefer small logical commits and commit at stable seams.
- Keep docs current when code changes make `STATE.md`, an ADR, or a reference doc stale.
- Agent attribution belongs in a commit trailer or PR, not a branch name.

## 3. Landing

Squash-merge each branch to one clean Conventional Commit on `main`. Preserve separate commits with
`--no-ff` only when they are genuinely independently revertible steps; squash is the default. Never
fast-forward a feature branch onto `main`.

Every task finishes in one of two states:

1. If the full verification gate is green, commit the branch, squash it to `main`, push, and delete
   the branch.
2. If a required live/visual/product check cannot be completed, leave the work verified as far as
   possible and committed on the branch. Report the single remaining check and wait for it before
   landing.

Do not leave an implementation as unexplained, uncommitted work.

## 4. Release

Merging to `main` does not automatically publish the extension. Chrome Web Store releases are
manual:

1. Update the version in both `package.json` and `manifest.config.ts` and add user-facing notes to
   `CHANGELOG.md`.
2. Run the full verification gate and any required live Zoho regression checks.
3. Run `npm run zip`; this rebuilds production output and creates `zoho-crm-devtools.zip`.
4. Upload the zip through the Chrome Web Store release process when explicitly authorized.

Keep package and manifest versions identical. Never publish a development build from `dist-dev`.

## 5. Verification

Run before every commit:

```sh
npm run verify
```

This runs Biome checks, TypeScript, Vitest, and a production Vite build. GitHub Actions runs the
same command for pushes and pull requests.

Changes to Zoho UI integration, selector-dependent behavior, or visuals also require a real check
in an authenticated Zoho CRM session. Use the development build and self-reload flow described in
[`architecture.md`](architecture.md). If that check cannot be run, say so explicitly and do not
land the branch as fully verified.

The optional non-blocking reminder hook is installed per clone with:

```sh
git config core.hooksPath .githooks
```

## 6. Verification honesty

- State which meaningful checks ran and which did not.
- Do not call work complete while a required build, test, or live Zoho check is skipped or failing.
- Treat permission, privacy, data-flow, and undocumented Zoho API changes as high-risk boundaries;
  explain exactly what was verified.

## 7. Engineering and debugging defaults

- Read relevant modules, callers, schemas, tests, references, and ADRs before writing code.
- Prefer native Zoho behavior and the smallest durable integration surface.
- Keep Zoho selectors inside `src/content/zoho`; keep browser APIs behind `src/shared/browser.ts`.
- For non-trivial live issues, inspect the DOM, attributes, and computed styles before and after the
  interaction. Verify reload/reopen behavior, not just the immediate happy path.
- When evidence is unavailable, request the smallest relevant DOM fragment or screenshot rather
  than inventing selectors.
- If approaches conflict, choose the newer or better-verified native pattern and record durable
  reasoning in the correct reference doc or ADR.
- Do not generalize from one case or mix unrelated cleanup into a feature.
- Never commit customer data, private Deluge code, credentials, tokens, or identifiable CRM
  screenshots. Reduce fixtures to the smallest sanitized fragment.

## 8. Code style

Match the file first; Biome owns formatting and import order.

- Comment intent, invariants, security boundaries, non-obvious trade-offs, and hard-won fixes.
  Delete comments that merely restate the code. Every lint suppression explains why.
- Name for intent. Preserve wire fields and Zoho contract names exactly even when they differ from
  local TypeScript style.
- Keep imports grouped and use type-only imports unless runtime metadata requires a value import.
- Use explicit, validated types at public and external boundaries. Fail fast with actionable
  messages and do not expose internal exceptions to users.
- Keep theme palettes separate from Zoho's shared variable/selector compatibility layers; do not
  duplicate Zoho-specific fallback rules in every theme.
- A hard-won bug fix keeps both a focused regression test and a concise why-comment when the risk
  is not obvious from the code.

## 9. Docs pipeline

- Follow the one-home rule and new-doc gate in [`README.md`](README.md).
- Temporary multi-step plans live only in `docs/plans/` and are deleted when complete.
- At the end of every session, update `STATE.md` and add an ADR for any durable new decision.
