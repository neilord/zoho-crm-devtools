# Privacy And Permissions

This policy describes the 2.4.0 account and Export functions release of Zoho CRM DevTools.
Existing editor features remain free and work without an account.

## Local editor features

Themes, font controls, indent guides and syntax enhancements run locally on supported Zoho CRM
and Portal pages. Search All Functions reads function summaries and Deluge source from your
Zoho org through Zoho's same-origin endpoints, keeps a per-org warm cache in local extension storage, and
hands selected functions back to Zoho's native editor. CRM records, customer data, Deluge source,
Zoho credentials, cookies and Zoho request context are never sent to the DevTools account service.
The extension does not collect analytics, browsing history or advertising identifiers, or sell data.

## Optional account and payments

If you choose to sign in, Chrome opens our website's account flow. The account service processes
your email address and authentication information to create and manage your account, deliver
account/trial messages, and associate your plan. The extension uses OAuth authorization code with
PKCE and receives opaque access and refresh tokens; it does not receive your password or email.
Account and entitlement requests go from the extension's background worker to
`https://api.devtools.zsetup.com`, without cookies. The service receives the authentication
requests, tokens, licence checks and ordinary connection information such as your IP address.
It returns plan/entitlement status and relevant dates, not Zoho data. Disconnect clears local
tokens and cached entitlement and attempts to revoke the refresh token at the service.

Plan selection and account management open `https://devtools.zsetup.com`. Stripe handles payment
on the website; the extension never reads or stores card details. Account/billing data and your
account deletion controls are described in the [website privacy policy](https://devtools.zsetup.com/privacy).
A new account receives a 14-day free Plus trial, no card required. The new Export functions
capability requires any paid plan/current Plus trial entitlement; existing free features remain
free. Plus is $9 for the first paid month, then $23/month; Pro is $35 first month, then $57/month;
Max is $99 first month, then $143/month. The first-month price applies only to an account’s
first-ever paid subscription, never to plan changes or repeat subscriptions. Export reads
your Zoho function metadata/source through the same Zoho endpoints and creates a local JSON,
CSV or Markdown download on your device. Export files may contain sensitive function content;
the extension never uploads them to our account service or Stripe.

## Network request inventory

The production extension issues only these fetch requests:

| Destination | Requests | Data sent |
| --- | --- | --- |
| Your current Zoho CRM origin | `GET /crm/v2/settings/functions` and `GET /crm/v2/settings/functions/<id>` | Zoho session cookies, org and CSRF headers; list pagination and function language/source parameters. Used by search and export. |
| `https://api.devtools.zsetup.com` | `POST /v1/auth/oauth2/token` | Public client id, authorization code/PKCE verifier/Chrome redirect URI, or the rotating refresh token. Form encoded, no cookies. |
| `https://api.devtools.zsetup.com` | `GET /v1/entitlement` | Access token in the Authorization header, no cookies. |
| `https://api.devtools.zsetup.com` | `POST /v1/auth/oauth2/revoke` | Public client id and refresh token to revoke, no cookies. |

The browser may also send CORS preflights. Fetch requests reject redirects. Optional sign-in
opens a normal Chrome tab through `/v1/auth/oauth2/authorize` and our website;
plan/account/privacy links open our website. The AI Assistant promotion opens its Chrome Web
Store listing when selected. Those navigations are distinct from the fetch requests above.

## Storage on your device

- Editor settings use `chrome.storage.sync`; Chrome may sync them through your Google account.
- The separate AI Assistant promotion record also uses sync storage for dismissal/snooze state.
- Account tokens and expiry, the refresh journal, and a brief (five-minute) entitlement cache use
  `chrome.storage.local` only, restricted to trusted extension contexts. They are never synced or
  sent to content scripts or pages. Local storage is not encrypted; access tokens are short-lived.
- Search caches contain function metadata and source in local extension storage. A dedicated
  worker cache channel preserves content-script access without exposing credentials; this cache
  is never sent to the account service.
- A separate local record remembers dismissal of the account/privacy notice. It is not telemetry
  and is not sent to our service. Disconnect and settings resets do not reset this notice.

Uninstalling removes extension storage from the local profile. Disconnect does not delete your
website account or cancel a subscription; use the website's account/billing controls for those.

## Chrome permissions and page access

| Permission | Purpose |
| --- | --- |
| `storage` | Save preferences, promotion/notice state, and local account credentials/cache. |

There are no required or optional API host permissions. The worker uses server-approved CORS.
Content scripts still match these Zoho CRM/Portal hosts, with HTTPS and all paths:

- `crm.zoho.com`, `crm.zoho.au`, `crm.zoho.eu`, `crm.zoho.com.au`, `crm.zoho.com.cn`,
  `crm.zoho.jp`, `crm.zoho.in`
- `crm.zohoportal.com`, `crm.zohoportal.au`, `crm.zohoportal.eu`, `crm.zohoportal.com.au`,
  `crm.zohoportal.com.cn`, `crm.zohoportal.jp`, `crm.zohoportal.in`
- Subdomains of `zohoportal.com`, `zohoportal.au`, `zohoportal.eu`, `zohoportal.com.au`,
  `zohoportal.com.cn`, `zohoportal.jp`, `zohoportal.in`

Content scripts can read and modify matched pages to integrate with the editor. The account API
accepts only fixed account operations, never Zoho data or arbitrary request payloads. This public
MIT source and its build output can be inspected before installation. Development builds may
use local API/website endpoints explicitly configured at build time; they are not store packages.
