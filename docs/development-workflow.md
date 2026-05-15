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

## Suggested Commit Loop

1. Make one coherent change.
2. Run `npm run verify`.
3. Review the diff.
4. Commit with a Conventional Commit message.
5. Update docs when the change adds durable project knowledge.
