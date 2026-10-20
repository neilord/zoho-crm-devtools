import type { AccountState } from '../../billing/client';
import { WEBSITE_BASE } from '../../billing/config';
import { account } from './api';
import { type AccountView, deriveView, PRO_PRICE_USD, TRIAL_DAYS } from './model';

export { account } from './api';

export const PRIVACY_URL = `${WEBSITE_BASE}/privacy`;

type Tone = 'primary' | 'link';
interface Action {
  label: string;
  run: () => Promise<unknown>;
  tone: Tone;
  /** Re-read the entitlement afterwards (every action but sign-in, which returns it). */
  action: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const signIn = (label: string): Action => ({
  label,
  run: account.signIn,
  tone: 'primary',
  action: 'sign-in',
});
const upgrade = (label: string, tone: Tone = 'primary'): Action => ({
  label,
  run: account.openUpgrade,
  tone,
  action: 'upgrade',
});
const manage: Action = {
  label: 'Manage account',
  run: account.openAccount,
  tone: 'link',
  action: 'manage',
};
const signOut: Action = {
  label: 'Sign out',
  run: account.signOut,
  tone: 'link',
  action: 'sign-out',
};

interface Copy {
  title: string;
  badge?: string;
  text: string;
  actions: Action[];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function copyFor(view: Exclude<AccountView, { kind: 'loading' | 'error' }>): Copy {
  switch (view.kind) {
    case 'signed-out':
      return {
        title: 'Free plan',
        text: `Pro: export all functions · ${TRIAL_DAYS}-day free trial, no card`,
        actions: [signIn('Start free trial'), { ...signIn('Sign in'), tone: 'link' }],
      };
    case 'free':
      return {
        title: 'Free plan',
        text: `Pro adds export of all functions${PRO_PRICE_USD ? ` · $${PRO_PRICE_USD}/month` : ''}. Everything else stays free.`,
        actions: [upgrade('Upgrade'), manage, signOut],
      };
    case 'trial':
      return {
        title: 'Pro trial',
        text:
          view.daysLeft === null
            ? 'Your free Pro trial is active.'
            : view.daysLeft === 0
              ? 'Your free trial ends today.'
              : `${plural(view.daysLeft, 'day')} left · no card needed until you upgrade.`,
        actions: [upgrade('Upgrade'), manage, signOut],
      };
    case 'pro':
      return {
        title: 'Pro',
        badge: 'Pro',
        text: view.renews ? `Renews ${view.renews}.` : 'Thanks for supporting DevTools.',
        actions: [manage, signOut],
      };
    case 'pro-canceling':
      return {
        title: `Pro until ${view.until}`,
        text: 'Your plan will not renew. Resume any time from Manage account.',
        actions: [{ ...manage, tone: 'primary' }, signOut],
      };
    case 'past-due':
      return {
        title: 'Payment needs attention',
        text: 'We could not renew Pro. Your editor tools are unaffected.',
        actions: [{ ...manage, label: 'Update payment', tone: 'primary' }, signOut],
      };
  }
}

export function mountAccount(root: HTMLElement): void {
  let current: AccountView = { kind: 'loading' };
  let message = '';

  const render = (): void => {
    const card = el('div', 'acct');
    card.dataset.state = current.kind;
    card.dataset.accountState = current.kind;
    root.replaceChildren(card);

    if (current.kind === 'loading') {
      card.setAttribute('aria-busy', 'true');
      card.append(el('span', 'skeleton skeleton-title'), el('span', 'skeleton skeleton-line'));
      return;
    }

    if (current.kind === 'error') {
      card.append(
        el('div', 'acct-title', 'Account unavailable'),
        el(
          'p',
          'acct-text',
          "Couldn't reach your account. Your free editor and search tools keep working.",
        ),
      );
      const actions = el('div', 'acct-actions');
      actions.append(button({ label: 'Retry', run: refresh, tone: 'link', action: 'retry' }));
      card.append(actions);
      return;
    }

    const copy = copyFor(current);
    const head = el('div', 'acct-head');
    head.append(el('span', 'acct-title', copy.title));
    if (copy.badge) head.append(el('span', 'badge', copy.badge));
    card.append(head, el('p', 'acct-text', copy.text));

    const actions = el('div', 'acct-actions');
    for (const action of copy.actions) actions.append(button(action));
    card.append(actions);
    if (message) {
      const note = el('p', 'acct-note', message);
      note.setAttribute('role', 'status');
      card.append(note);
    }
  };

  const button = (action: Action): HTMLButtonElement => {
    const node = el('button', `btn btn-${action.tone}`, action.label);
    node.type = 'button';
    node.dataset.accountAction = action.action;
    node.addEventListener('click', () => {
      for (const b of root.querySelectorAll('button')) b.disabled = true;
      message = '';
      void action
        .run()
        .then((result) => {
          if (isAccountState(result)) {
            if (action.action === 'sign-in' && !result.signedIn) {
              message = result.cancelled
                ? 'Sign-in was cancelled. You can try again any time.'
                : 'Sign-in failed. Please try again.';
            }
            current = deriveView(result);
            render();
          } else {
            return refresh();
          }
        })
        .catch((error) => {
          message =
            action.action === 'sign-in'
              ? error instanceof Error && /cancel/i.test(error.message)
                ? 'Sign-in was cancelled. You can try again any time.'
                : 'Sign-in failed. Please try again.'
              : 'Something went wrong. Please try again.';
          render();
        });
    });
    return node;
  };

  const refresh = async (): Promise<void> => {
    try {
      current = deriveView(await account.getEntitlement());
    } catch {
      current = { kind: 'error' };
    }
    render();
  };

  render();
  void refresh();
}

function isAccountState(value: unknown): value is AccountState {
  return !!value && typeof value === 'object' && 'signedIn' in value && 'entitlement' in value;
}

/** Store policy: a prominent, once-only disclosure of the optional account and changed data practices. */
export function mountNotice(root: HTMLElement): void {
  void account
    .getNotice()
    .then(({ pending }) => {
      if (!pending) return;
      const notice = el('aside', 'notice');
      notice.dataset.billingNotice = '';
      notice.setAttribute('aria-label', 'What is new');
      notice.append(
        el('strong', 'notice-title', 'New: optional account & Pro plan'),
        el(
          'p',
          'notice-text',
          'Everything you use today stays free. Signing in is optional. Pro adds function export and requires a current trial or paid plan.',
        ),
        el(
          'p',
          'notice-text',
          'An account involves your email and sign-in tokens, handled by our account service. Your Zoho data is never sent to it.',
        ),
      );
      const row = el('div', 'notice-actions');
      const policy = el('a', 'notice-link', 'Privacy policy');
      policy.href = PRIVACY_URL;
      policy.target = '_blank';
      policy.rel = 'noopener noreferrer';
      const dismiss = el('button', 'btn btn-primary', 'Got it');
      dismiss.type = 'button';
      dismiss.dataset.noticeDismiss = '';
      dismiss.addEventListener('click', () => {
        dismiss.disabled = true;
        // Only hide after the dismissal persisted, so the disclosure cannot silently vanish.
        void account
          .dismissNotice()
          .then(() => notice.remove())
          .catch(() => {
            dismiss.disabled = false;
          });
      });
      row.append(policy, dismiss);
      notice.append(row);
      root.replaceChildren(notice);
    })
    .catch(() => {});
}
