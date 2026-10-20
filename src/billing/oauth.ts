function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function createPkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  return { verifier, challenge, state: base64url(crypto.getRandomValues(new Uint8Array(32))) };
}

export function authorizationCode(
  result: string,
  redirect: string,
  state: string,
  issuer: string,
): string {
  const url = new URL(result);
  const expected = new URL(redirect);
  const params = url.searchParams;
  if (
    url.protocol !== expected.protocol ||
    url.host !== expected.host ||
    url.pathname !== expected.pathname ||
    url.hash ||
    url.username ||
    url.password ||
    params.getAll('state').length !== 1 ||
    params.get('state') !== state ||
    params.getAll('iss').length !== 1 ||
    params.get('iss') !== issuer ||
    params.has('error') ||
    params.getAll('code').length !== 1 ||
    !params.get('code')
  ) {
    throw new Error('Invalid authorization response');
  }
  return params.get('code') as string;
}
