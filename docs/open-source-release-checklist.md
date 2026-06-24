# Open Source Release Checklist

Use this checklist before making the repository public or announcing it.

## 1. Confirm The License

This repository currently uses the MIT License.

MIT is a real open-source license and is easy for developers and admins to understand. It also allows commercial forks and redistribution. If that is not acceptable, use a source-available license instead, but do not call that open source.

Recommended model for future freemium work:

- Keep this free/base extension open source.
- Keep current free features free.
- Put future premium-only code in a separate private package, paid build, backend service, or private repository.
- Never rely on hidden client-side extension code for secrets or payment enforcement.

## 2. Run Local Checks

```sh
npm ci
npm run verify
npm audit
git status --short
```

Expected result:

- `npm run verify` passes.
- `npm audit` reports 0 vulnerabilities or every remaining item is understood and documented.
- `git status --short` contains only the intentional public-release changes.

## 3. Check For Private Data

Before pushing public docs or screenshots, verify:

- No credentials, tokens, API keys, or private keys.
- No CRM customer names, emails, phone numbers, records, or deal data.
- No private Deluge code from customers.
- No local build artifacts, zip files, reports, or `node_modules`.
- No screenshots that expose private browser tabs, accounts, or CRM data.

Useful commands:

```sh
git grep -n -I -E 'api[_-]?key|secret|password|private[_-]?key|client_secret|refresh_token|access_token|Bearer |ghp_|github_pat_' -- . ':!package-lock.json'
git ls-files -o --exclude-standard
```

## 4. Push The Public-Ready Commit

```sh
git status --short
git add README.md LICENSE PRIVACY.md CONTRIBUTING.md SECURITY.md CHANGELOG.md TRADEMARKS.md docs/open-source-release-checklist.md package.json package-lock.json biome.json .github/pull_request_template.md
git commit -m "docs: prepare repository for open source"
git push origin main
```

## 5. Make The GitHub Repository Public

The remote is currently configured as:

```sh
https://github.com/neilord/zoho-crm-devtools.git
```

If the repository is private, make it public in GitHub:

1. Open the repository on GitHub.
2. Go to Settings.
3. Go to General.
4. Scroll to Danger Zone.
5. Choose Change repository visibility.
6. Select Public and confirm.

## 6. Configure GitHub Repository Settings

Recommended settings:

- Description: `Chrome extension that improves the Zoho CRM Deluge editor.`
- Website: `https://chromewebstore.google.com/detail/zoho-crm-devtools/mjcppmfgjpllmmoneiaegecjlcpbfgmi`
- Topics: `zoho`, `zoho-crm`, `deluge`, `chrome-extension`, `developer-tools`, `codemirror`
- Enable Issues.
- Enable Discussions only if you want public support threads.
- Enable Dependabot alerts.
- Enable private vulnerability reporting.
- Add a branch protection rule for `main` requiring the CI workflow before merge.

## 7. Create A GitHub Release

After the public-ready commit is pushed, create a version tag if one does not already exist:

```sh
git tag v2.0.0
git push origin v2.0.0
```

Then create a GitHub release for `v2.0.0` and attach `zoho-crm-devtools.zip` if you want users to compare the published Web Store build with a local build.

## 8. Update Public Messaging

Update the Chrome Web Store description, Reddit comments, and any support pages with:

- Source code link.
- Permissions summary.
- Privacy statement.
- Clear note that the project is independent and not affiliated with Zoho.

Suggested short wording:

```text
The extension is now open source. Current permissions are Chrome storage for editor preferences plus content script access on Zoho CRM/Portal pages so it can style the Deluge editor. There is no backend, analytics, or network call in the current build.
```
