/**
 * Resolves the request context needed to call Zoho's internal CRM API from the
 * content script: the org id (from the URL) and the CSRF token (from a cookie).
 *
 * The content script shares the page origin, so same-origin `fetch` carries the
 * session cookies automatically; we only need to supply the org and CSRF headers
 * that Zoho's own UI sends.
 */

export interface CrmContext {
  /** Page origin, e.g. `https://crm.zoho.eu`. */
  origin: string;
  /** Numeric org id (zgid), used for the `X-Crm-Org` header. */
  orgId: string;
  /** Value for the `X-Zcsrf-Token` header, or `''` when the cookie is missing. */
  csrfHeader: string;
}

const ORG_ID_PATTERN = /\/org(\d+)\b/;
const CSRF_COOKIE_NAME = 'CSRF_TOKEN';

/** Extracts the org id from a CRM pathname such as `/crm/org12345/...`. */
export function parseOrgId(pathname: string): string | null {
  const match = ORG_ID_PATTERN.exec(pathname);
  return match ? match[1] : null;
}

/** Reads a single cookie value from a `document.cookie` string. */
export function readCookie(name: string, cookieString: string): string | null {
  const target = `${name}=`;
  for (const part of decodeURIComponent(cookieString).split(';')) {
    const trimmed = part.trimStart();
    if (trimmed.startsWith(target)) {
      return trimmed.slice(target.length);
    }
  }
  return null;
}

/**
 * Builds the CRM context from the live location and cookies. Returns `null` when
 * the org id cannot be determined (e.g. the page is not a CRM org page yet).
 */
export function resolveCrmContext(
  location: Pick<Location, 'origin' | 'pathname'> = window.location,
  cookieString: string = document.cookie,
): CrmContext | null {
  const orgId = parseOrgId(location.pathname);
  if (!orgId) {
    return null;
  }

  const token = readCookie(CSRF_COOKIE_NAME, cookieString);
  return {
    origin: location.origin,
    orgId,
    csrfHeader: token ? `crmcsrfparam=${token}` : '',
  };
}
