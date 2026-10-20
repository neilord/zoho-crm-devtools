import contract from './product-contract.json';

// Public-safe generated artifact owned by the cloud repository; do not edit plan facts here.
export { contract };
export const API_BASE = import.meta.env.VITE_BILLING_API_BASE ?? 'https://api.devtools.zsetup.com';
export const WEBSITE_BASE =
  import.meta.env.VITE_BILLING_WEBSITE_BASE ?? 'https://devtools.zsetup.com';
export const OAUTH_ISSUER = `${API_BASE}/v1/auth`;
