import { sendOAuthCallback } from '../shared/browser';

const status = document.getElementById('status');
const url = location.href;
// Remove the single-use code from history immediately; only the worker receives it.
history.replaceState(null, '', location.pathname);
void sendOAuthCallback(url)
  .then((reply) => {
    if (!reply.ok) throw new Error('Sign-in failed');
    if (status) status.textContent = 'Signed in to Zoho CRM DevTools — you can close this tab';
    setTimeout(() => window.close(), 1200);
  })
  .catch(() => {
    if (status)
      status.textContent =
        'Sign-in could not finish. Close this tab and start sign-in again from Zoho CRM DevTools.';
  });
