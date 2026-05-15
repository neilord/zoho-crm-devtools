# Fixtures

Store small captured Zoho DOM fragments here when they make a feature easier to test repeatedly.

## Rules

- Capture the smallest useful snippet, not a full page dump.
- Name fixtures after the real UI state they represent.
- Record the fixture's origin and any known selector fragility in `docs/zoho-integration.md`.
- Keep live Zoho verification as the final source of truth for browser behavior and visuals.
- If the assistant cannot inspect the needed DOM directly, request the smallest relevant Zoho source fragment from the user before creating the fixture.
- Keep fixtures tied to the current feature. For a theme-picklist change, capture the picklist and its relevant states, not unrelated page structure.
