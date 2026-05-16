# Development Workflow

## Branches

- Use short-lived feature branches with the `codex/` prefix.
- Keep one concern per branch whenever practical.
- Do not publish exploratory branches until the approach is agreed and verified.

## Commits

- Use Conventional Commits.
- Prefer small logical commits over large mixed commits.
- When a feature spans several concerns, commit at stable seams as soon as each slice is coherent and
  verifiable instead of waiting for one large end-of-branch commit.
- Favor commits that are easy to review independently, such as schema/registry groundwork, one
  integration slice, or focused tests/docs, rather than bundling all feature work together.
- Before every commit, run `npm run verify`.
- If a lint rule needs an intentional exception, suppress it at the narrowest useful scope with a
  reason comment so later verification output stays actionable for other contributors.
- If `npm run verify` is too slow later, revise the workflow explicitly rather than quietly skipping checks.

## Review

- GitHub CI runs `npm run verify` on every push and pull request.
- Run a code-review pass before publishing a branch or opening a pull request.
- Review for correctness first: runtime bugs, lifecycle gaps, risky assumptions, selector fragility, and missing tests.
- Keep provisional live-debug experiments off the shared branch until they survive real Zoho verification.

## Feature Session Expectations

- Read the project docs before changing code.
- For non-trivial work, state the success criteria before implementing so verification is concrete.
- Read the relevant existing modules, exports, callers, and helpers before adding new code.
- Inspect the live Zoho UI before implementing integration behavior.
- Ask for browser access or relevant Zoho source when required evidence is missing.
- Prefer the smallest change that solves the current task; avoid speculative abstractions and unrelated cleanup.
- Add only the test depth justified by the current feature slice; do not turn routine feature work into architecture redesign.
- Update docs when new durable Zoho knowledge, workflow facts, or selector risks are discovered.

## Suggested Commit Loop

1. Make one coherent change.
2. Run `npm run verify`.
3. Review the diff.
4. Commit with a Conventional Commit message.
5. Update docs when the change adds durable project knowledge.

## Verification Honesty

- Say explicitly when browser verification, live Zoho verification, or a planned test was not run.
- Do not describe work as complete if a meaningful verification step was skipped or still failing.

## Development-Only Extension Reload

Use the internal reload bridge when iterating on the unpacked extension locally and browser automation
cannot reach `chrome://extensions`.

1. Build the local development artifact with `npm run build:dev`.
2. Load `dist` as the unpacked extension if it is not already installed.
3. After rebuilding, trigger a self-reload from the Zoho tab console or browser automation:

   ```js
   window.dispatchEvent(new Event('zcdt:dev:reload-extension'));
   ```

4. Reload the Zoho tab before verifying the new behavior.

The bridge exists only in development builds. A normal `npm run build` output does not include the
reload content script or background worker, so this is not product UI and is not reachable in
production builds.

`chrome://extensions` may still need one manual reload when the extension has not been installed yet,
or when the currently loaded copy is broken enough that it cannot receive the event. After that,
prefer the self-reload bridge for routine local iteration.
