/** Never log callback URLs, codes, PKCE, tokens or arbitrary server error bodies. */
export function reportBillingFailure(stage: string, error: unknown): void {
  if (import.meta.env.MODE !== 'development') return;
  const reason = error instanceof Error ? error.name : 'Unknown error';
  const known = [
    'Token exchange failed',
    'Invalid token response',
    'Invalid authorization response',
    'Stale sign-in',
    'Sign-in cancelled',
    'Sign-in failed',
  ];
  const detail =
    error instanceof Error && known.includes(error.message) ? `: ${error.message}` : '';
  console.warn(`[billing] ${stage}: ${reason}${detail}`);
}
