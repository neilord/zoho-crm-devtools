import { describe, expect, it } from 'vitest';
import { parseOrgId, readCookie, resolveCrmContext } from '../src/content/functions/crm-context';

describe('CRM context resolution', () => {
  it('extracts the org id from a CRM pathname', () => {
    expect(parseOrgId('/crm/org20115783408/settings/functions/myFunctions')).toBe('20115783408');
  });

  it('returns null when the pathname has no org segment', () => {
    expect(parseOrgId('/crm/settings/functions')).toBeNull();
  });

  it('reads a named cookie value', () => {
    expect(readCookie('CSRF_TOKEN', 'foo=1; CSRF_TOKEN=abc123; bar=2')).toBe('abc123');
  });

  it('returns null for a missing cookie', () => {
    expect(readCookie('CSRF_TOKEN', 'foo=1; bar=2')).toBeNull();
  });

  it('builds a full context with the CSRF header', () => {
    const context = resolveCrmContext(
      { origin: 'https://crm.zoho.eu', pathname: '/crm/org42/settings/functions/myFunctions' },
      'CSRF_TOKEN=tok',
    );

    expect(context).toEqual({
      origin: 'https://crm.zoho.eu',
      orgId: '42',
      csrfHeader: 'crmcsrfparam=tok',
    });
  });

  it('leaves the CSRF header empty when the cookie is absent', () => {
    const context = resolveCrmContext(
      { origin: 'https://crm.zoho.eu', pathname: '/crm/org42/leads' },
      '',
    );
    expect(context?.csrfHeader).toBe('');
  });

  it('returns null when the org id cannot be resolved', () => {
    expect(resolveCrmContext({ origin: 'https://crm.zoho.eu', pathname: '/crm/' }, '')).toBeNull();
  });
});
