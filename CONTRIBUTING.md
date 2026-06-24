# Contributing

Thanks for considering a contribution to Zoho CRM DevTools.

## Setup

```sh
npm ci
npm run verify
```

`npm run verify` runs formatting/lint checks, TypeScript, unit tests, and a production build.

## Development Notes

- Keep Zoho-specific selectors inside `src/content/zoho`.
- Keep browser APIs behind `src/shared/browser.ts`.
- Keep feature behavior covered by focused unit or DOM fixture tests when possible.
- Run real Zoho verification for UI behavior that depends on live Zoho pages.
- Do not commit generated build output, `node_modules`, packaged zip files, or local test artifacts.

## Privacy Rules

Do not add CRM customer data, private Deluge code, real credentials, cookies, tokens, or identifiable screenshots to issues, tests, fixtures, or pull requests.

When a fixture is needed, reduce it to the smallest relevant HTML fragment and remove private data before committing it.

## Pull Requests

Before opening a pull request:

- Run `npm run verify`.
- Explain the user-facing behavior change.
- Mention whether real Zoho verification was completed.
- Call out any permission, privacy, or data-flow changes.

Permission changes should be treated as product changes, not incidental implementation details.
