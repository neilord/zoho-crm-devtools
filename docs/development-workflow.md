# Development Workflow

## Branches

- Use short-lived feature branches with the `codex/` prefix.
- Keep one concern per branch whenever practical.
- Do not publish exploratory branches until the approach is agreed and verified.

## Commits

- Use Conventional Commits.
- Prefer small logical commits over large mixed commits.
- Before every commit, run `npm run verify`.
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
