import type { AccountState } from '../../billing/client';
import { WEBSITE_BASE } from '../../billing/config';
import { paidPlans, trialPriceCopy } from '../../billing/plans';
import { account } from './api';
import { type AccountView, deriveView, TRIAL_DAYS } from './model';

export { account } from './api';

export const PRIVACY_URL = `${WEBSITE_BASE}/privacy`;

type Tone = 'primary' | 'secondary' | 'link';
interface Action {
  label: string;
  run: () => Promise<unknown>;
  tone: Tone;
  /** `data-account-action` hook. */
  action: string;
  icon?: keyof typeof ICONS;
  plan?: string;
}

// Static, trusted markup only (never interpolated with data).
const ICONS = {
  ext: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>',
  check:
    '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.4l2.3 2.3 4.7-5"/></svg>',
  cal: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>',
  retry:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11A8 8 0 006 6.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0014 4.7l2-2.2M20 20v-4.5h-4.5"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/></svg>',
} as const;

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

function icon(name: keyof typeof ICONS): HTMLSpanElement {
  const node = el('span', 'ico');
  node.innerHTML = ICONS[name];
  return node;
}

const signIn = (label: string, tone: Tone): Action => ({
  label,
  run: account.signIn,
  tone,
  action: 'sign-in',
});
const manageBilling = (tone: Tone, label = 'Manage billing'): Action => ({
  label,
  run: account.openBilling,
  tone,
  action: 'manage',
  icon: 'ext',
});

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

type SettledView = Exclude<AccountView, { kind: 'loading' | 'error' }>;

/** Content of the hero plan tile for every settled state. */
interface Tile {
  badge?: { text: string; free?: boolean };
  /** Status chip on the right of the tile header. */
  chip?: { text: string; tone: 'ok' | 'warn' | 'err' | 'text' };
  title: string;
  meta?: string;
  metaIcon?: boolean;
  /** Trial progress, rendered as "Day X of N". */
  progress?: { day: number; of: number };
  chips?: boolean;
  note?: string;
  tint?: boolean;
  alert?: boolean;
  actions: Action[];
}

export function tileFor(view: SettledView): Tile {
  switch (view.kind) {
    case 'signed-out':
      return {
        badge: { text: 'Free', free: true },
        title: 'Try Plus free',
        meta: `${TRIAL_DAYS} days · no card required`,
        chips: true,
        tint: true,
        actions: [signIn('Start free trial', 'primary'), signIn('Log in', 'secondary')],
      };
    case 'free':
      return {
        badge: { text: 'Free', free: true },
        title: 'Free plan',
        meta: 'Signed in',
        actions: [],
      };
    case 'trial': {
      const left = view.daysLeft;
      return {
        badge: { text: view.planName },
        chip: {
          text: left === null ? '' : left === 0 ? 'Ends today' : `${plural(left, 'day')} left`,
          tone: 'text',
        },
        title: `${view.planName} trial`,
        progress:
          left === null
            ? undefined
            : { day: Math.min(TRIAL_DAYS, Math.max(1, TRIAL_DAYS - left)), of: TRIAL_DAYS },
        tint: true,
        actions: [manageBilling('secondary')],
      };
    }
    case 'paid':
      return {
        badge: { text: view.planName },
        chip: { text: 'Active', tone: 'ok' },
        title: view.planName,
        meta: view.renews ? `Renews ${view.renews}` : undefined,
        metaIcon: true,
        actions: [manageBilling('secondary')],
      };
    case 'paid-canceling':
      return {
        badge: { text: view.planName },
        chip: { text: 'Canceling', tone: 'warn' },
        title: view.planName,
        meta: `Ends ${view.until}`,
        metaIcon: true,
        note: "Won't renew. Resume anytime from Manage billing.",
        actions: [manageBilling('primary')],
      };
    case 'past-due':
      return {
        chip: { text: 'Past due', tone: 'err' },
        title: 'Payment needs attention',
        meta: 'Editor tools are unaffected.',
        alert: true,
        actions: [manageBilling('primary', 'Update payment')],
      };
  }
}

export interface MountOptions {
  version?: string;
}

export function mountAccount(root: HTMLElement, options: MountOptions = {}): void {
  let current: AccountView = { kind: 'loading' };
  let message = '';

  const render = (): void => {
    const card = el('div', 'acct');
    card.dataset.state = current.kind;
    card.dataset.accountState = current.kind;
    const body = el('div', 'acct-body');
    card.append(body);
    root.replaceChildren(card);

    if (current.kind === 'loading') {
      card.setAttribute('aria-busy', 'true');
      const tile = el('div', 'tile');
      tile.append(
        el('span', 'skeleton skeleton-badge'),
        el('span', 'skeleton skeleton-title'),
        el('span', 'skeleton skeleton-line'),
        el('span', 'skeleton skeleton-btn'),
      );
      body.append(tile);
      card.append(footer(false));
      return;
    }

    if (current.kind === 'error') {
      const tile = el('div', 'tile');
      const actions = el('div', 'tile-actions');
      actions.append(
        button({ label: 'Retry', run: refresh, tone: 'secondary', action: 'retry', icon: 'retry' }),
      );
      tile.append(
        el('div', 'pn pn-small', 'Account unavailable'),
        el('div', 'meta', 'Editor tools still work.'),
        actions,
      );
      body.append(tile);
      card.append(footer(false));
      return;
    }

    body.append(tileEl(current, tileFor(current)));
    if (current.kind !== 'past-due') body.append(plansEl(current));
    card.append(footer(current.kind !== 'signed-out'));
  };

  const tileEl = (view: SettledView, t: Tile): HTMLElement => {
    const tile = el('div', `tile${t.tint ? ' tint' : ''}${t.alert ? ' alert' : ''}`);
    const th = el('div', 'th');
    if (t.badge) th.append(el('span', `badge${t.badge.free ? ' free' : ''}`, t.badge.text));
    if (t.chip?.text) {
      const chip = el('span', `chip chip-${t.chip.tone}`);
      if (t.chip.tone !== 'text') chip.append(el('i'));
      chip.append(t.chip.text);
      th.append(chip);
    }
    tile.append(th, el('div', t.alert ? 'pn pn-small' : 'pn', t.title));
    if (t.meta) {
      const meta = el('div', 'meta');
      if (t.metaIcon) meta.append(icon('cal'));
      meta.append(t.meta);
      tile.append(meta);
    }
    if (t.progress) {
      const bar = el('div', 'bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(t.progress.of));
      bar.setAttribute('aria-valuenow', String(t.progress.day));
      bar.setAttribute('aria-label', 'Trial progress');
      const fill = el('i');
      fill.style.width = `${Math.round((t.progress.day / t.progress.of) * 100)}%`;
      bar.append(fill);
      tile.append(bar, el('div', 'barl', `Day ${t.progress.day} of ${t.progress.of}`));
    }
    if (t.chips) {
      const row = el('div', 'inc');
      for (const label of ['Export functions', 'Search All Workflows']) {
        const chip = el('span', 'inc-chip');
        chip.append(icon('check'), label);
        row.append(chip);
      }
      tile.append(row);
    }
    if (t.note) tile.append(el('div', 'note', t.note));
    if (t.actions.length) {
      const actions = el('div', t.actions.length > 1 ? 'tile-actions two' : 'tile-actions');
      for (const action of t.actions) actions.append(button(action));
      tile.append(actions);
    }
    if (view.kind === 'signed-out') tile.append(el('p', 'fine', `Then ${trialPriceCopy}.`));
    if (message) {
      const note = el('p', 'acct-note', message);
      note.setAttribute('role', 'status');
      tile.append(note);
    }
    return tile;
  };

  const plansEl = (view: Exclude<SettledView, { kind: 'past-due' }>): HTMLElement => {
    const section = el('section', 'plans');
    section.setAttribute('aria-label', 'Plans');
    section.append(el('p', 'plans-label', 'Plans'));
    const cols = el('div', 'plan-cols');
    const owned = view.kind === 'paid' || view.kind === 'paid-canceling';
    for (const plan of paidPlans) {
      const isCurrent = 'plan' in view && view.plan === plan.key;
      const col = button({
        label: '',
        tone: 'link',
        action: 'checkout',
        plan: plan.key,
        run: () => checkout(plan.key, view.kind === 'signed-out'),
      });
      col.className = `plan-col${isCurrent ? (owned ? ' current' : ' trial') : ''}`;
      col.replaceChildren(
        el('span', 'pc-name', plan.name),
        el('span', 'pc-price', `$${plan.priceUsdMonthly}/mo`),
        el('span', 'pc-tag', isCurrent ? (owned ? 'Current' : 'Trial') : ''),
      );
      if (isCurrent && owned) {
        col.disabled = true;
        col.setAttribute('aria-current', 'true');
      }
      cols.append(col);
    }
    section.append(
      cols,
      el('p', 'fine', 'Every paid plan includes Export functions and Search All Workflows.'),
    );
    return section;
  };

  /** Signed-out users sign in first; checkout only opens once that actually produced a session. */
  const checkout = async (plan: string, needsSignIn: boolean): Promise<unknown> => {
    if (!needsSignIn) return account.openCheckout(plan);
    const result = await account.signIn();
    if (isAccountState(result) && result.signedIn) await account.openCheckout(plan);
    return result;
  };

  const footer = (showSignOut: boolean): HTMLElement => {
    const foot = el('div', 'foot');
    if (showSignOut) {
      foot.append(
        button({ label: 'Sign out', run: account.signOut, tone: 'link', action: 'sign-out' }),
        el('span', 'd', '·'),
      );
    }
    const privacy = el('a', undefined, 'Privacy');
    privacy.href = PRIVACY_URL;
    privacy.target = '_blank';
    privacy.rel = 'noopener noreferrer';
    foot.append(privacy);
    if (options.version) foot.append(el('span', 'v', `v${options.version}`));
    return foot;
  };

  const button = (action: Action): HTMLButtonElement => {
    const node = el('button', `btn btn-${action.tone}`);
    node.append(action.label);
    if (action.icon) node.append(icon(action.icon));
    node.type = 'button';
    node.dataset.accountAction = action.action;
    if (action.plan) node.dataset.plan = action.plan;
    node.addEventListener('click', () => {
      for (const b of root.querySelectorAll('button')) b.disabled = true;
      message = '';
      // Both the sign-in buttons and the plan columns run sign-in while signed out.
      const signingIn = current.kind === 'signed-out';
      void action
        .run()
        .then((result) => {
          if (isAccountState(result)) {
            if (signingIn && !result.signedIn) {
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
          message = signingIn
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
      const body = el('div', 'notice-body');
      body.append(
        el('strong', 'notice-title', 'New: optional account & paid plans'),
        el(
          'p',
          'notice-text',
          'Everything you use today stays free. Signing in is optional. Plus, Pro and Max add function export and requires a current trial or paid plan.',
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
      const dismiss = el('button', 'btn btn-primary btn-small', 'Got it');
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
      body.append(row);
      notice.append(icon('info'), body);
      root.replaceChildren(notice);
    })
    .catch(() => {});
}
