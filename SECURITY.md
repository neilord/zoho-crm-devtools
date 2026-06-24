# Security Policy

## Supported Versions

The latest Chrome Web Store release and the current `main` branch are the supported versions.

## Reporting A Vulnerability

Please do not post exploit details, customer data, credentials, private Deluge code, or screenshots with CRM records in public issues.

Preferred reporting path:

1. Use GitHub private vulnerability reporting if it is enabled for this repository.
2. If private reporting is not available, open a minimal public issue asking for a secure contact path. Do not include exploit details in that issue.

Useful reports include:

- Extension version
- Browser and operating system
- A clear description of the behavior
- Steps to reproduce using sanitized test data
- Whether the issue affects permissions, data access, or page injection behavior

## Scope

Security-sensitive areas include:

- Chrome extension permissions
- Content script behavior on Zoho CRM pages
- Settings storage
- Build and release artifacts
- Any future network, authentication, billing, or CRM metadata features
