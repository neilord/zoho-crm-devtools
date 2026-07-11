# Contributing

Thanks for considering a contribution to Zoho CRM DevTools.

The authoritative branch, commit, verification, debugging, and release rules live in
[`docs/conventions.md`](docs/conventions.md). Current project state is in
[`docs/STATE.md`](docs/STATE.md).

## Setup

```sh
npm ci
npm run verify
```

The command's contents and any additional live Zoho checks are defined in the conventions rather
than duplicated here.

## Privacy Rules

Do not add CRM customer data, private Deluge code, real credentials, cookies, tokens, or identifiable screenshots to issues, tests, fixtures, or pull requests.

When a fixture is needed, reduce it to the smallest relevant HTML fragment and remove private data before committing it.

## Pull Requests

Before opening a pull request:

- Explain the user-facing behavior change.
- Call out any permission, privacy, or data-flow changes.
- Complete the repository's pull-request checklist.

Permission changes should be treated as product changes, not incidental implementation details.
