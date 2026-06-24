# Privacy And Permissions

This document describes the current production behavior of Zoho CRM DevTools version 2.0.0.

## Summary

Zoho CRM DevTools improves the Zoho CRM Deluge editor locally in the browser. The current extension has no backend service, no analytics, and no network calls.

## Chrome Permissions

The production manifest requests:

| Permission | Why it is needed |
| --- | --- |
| `storage` | Saves editor preferences such as enabled state, selected theme, font settings, indent guides, and syntax enhancement settings. |

The production manifest also registers content scripts on Zoho CRM and Zoho Portal pages. This is required because the extension has to read and update editor DOM/CSS inside the Zoho page.

Current page matches:

- `https://crm.zoho.com/*`
- `https://crm.zoho.au/*`
- `https://crm.zoho.eu/*`
- `https://crm.zoho.com.au/*`
- `https://crm.zoho.com.cn/*`
- `https://crm.zoho.jp/*`
- `https://crm.zoho.in/*`
- `https://crm.zohoportal.com/*`
- `https://crm.zohoportal.au/*`
- `https://crm.zohoportal.eu/*`
- `https://crm.zohoportal.com.au/*`
- `https://crm.zohoportal.com.cn/*`
- `https://crm.zohoportal.jp/*`
- `https://crm.zohoportal.in/*`
- `https://*.zohoportal.com/*`
- `https://*.zohoportal.au/*`
- `https://*.zohoportal.eu/*`
- `https://*.zohoportal.com.au/*`
- `https://*.zohoportal.com.cn/*`
- `https://*.zohoportal.jp/*`
- `https://*.zohoportal.in/*`

## Data Stored

The extension stores only its own settings object:

- Settings schema version
- Extension enabled/disabled state
- Selected custom theme
- Font family, size, weight, line height, ligature, and italic preferences
- Indent guide preference
- Syntax enhancement preference

Settings are stored with `chrome.storage.sync`. If the user has Chrome sync enabled, Chrome may sync these settings through the user's Google account. Zoho CRM DevTools does not send these settings to a ZSetup server.

## Data Not Collected

The current extension does not intentionally collect, transmit, sell, or share:

- CRM records
- Customer data
- Deluge source code
- Zoho account details
- Cookies
- Authentication tokens
- Browsing history

The current source does not use `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `chrome.cookies`, `chrome.webRequest`, `chrome.scripting`, or `chrome.identity`.

## Important Limitation

Chrome extensions with content scripts can technically read and modify matched pages. Zoho CRM DevTools needs that page access to improve the Deluge editor. This is why the project is open source: administrators and developers can inspect the manifest, content scripts, and build output before installing it.

Any future feature that needs broader access, network calls, account login, billing, CRM metadata access, or external services should be documented here before release.
