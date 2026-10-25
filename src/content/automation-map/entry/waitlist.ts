import { contract } from '../../../billing/config';
import { hasPlanFeature } from '../../../billing/entitlement';
import type { BillingAction, BillingPayloads, BillingResults } from '../../../billing/protocol';
import { billingMessage } from '../../../shared/browser';
import { registerUpgradeModalCloser } from '../../billing/upgrade-hook';
import { checkIcon, closeIcon, el, spinnerIcon } from '../../functions/dom';
import waitlistCss from './waitlist.css?inline';
import { createWaitlistPreview } from './waitlist-preview';

/**
 * "Coming soon" popup for the Automation Map (ADR 0035). While the map is gated every entry point
 * shows this instead: a static preview, and an account-aware call to action. It never opens the
 * map and never reads Zoho. Light DOM on `document.body` like the upgrade modal, with every rule
 * scoped under `[data-zcdt-waitlist]`.
 */
type AccountState = BillingResults['billing:getEntitlement'];

export type WaitlistView =
  | 'checking'
  | 'signed-out'
  | 'signing-in'
  | 'free'
  | 'awaiting-checkout'
  | 'on-list';

export interface WaitlistDependencies {
  send<A extends BillingAction>(
    type: A,
    payload?: BillingPayloads[keyof BillingPayloads],
  ): Promise<BillingResults[A]>;
}
export interface WaitlistHandle {
  close(): void;
}
export interface WaitlistOptions {
  deps?: WaitlistDependencies;
  invoker?: HTMLElement | null;
  /** Fires once, after the dialog is gone. */
  onClose?(): void;
}

export const WAITLIST_STYLE_ID = 'zcdt-waitlist-style';
const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Pro prices are projected from the synced contract; never restate them here. */
const proPlan = contract.plans.find((plan) => plan.key === 'pro');
if (!proPlan) throw new Error('Pro plan missing from product contract');
const monthlyCopy = `$${proPlan.priceUsdMonthly}/month`;
const introCopy = `$${proPlan.introPriceUsdFirstMonth} first month, then ${monthlyCopy}`;

const COPY = {
  title: 'Automation Map is coming to Pro',
  body: "One map of everything that runs in your CRM, and every way a field can change. We're polishing it before release. Pro members get it first, at no extra cost.",
  entitledTitle: "You're on the list",
  entitledBody:
    "Automation Map is included in your plan. It turns on here automatically when it's ready. Nothing else to do.",
  benefits: [
    'Rules, functions, buttons and schedules on one board',
    'Field lens: every writer and reactor of a field',
    'Trace any automation upstream and downstream',
  ],
  cta: 'Get Pro and join the waitlist',
} as const;

let current: WaitlistHandle | undefined;
export function closeAutomationMapWaitlist(): void {
  current?.close();
}

function signInErrorMessage(error: unknown): string {
  return error instanceof Error && /cancel/i.test(error.message)
    ? 'Sign-in was cancelled. You can try again whenever you are ready.'
    : 'We could not reach the account service. Check your connection and try again.';
}

/** A failed or missing read falls back to the signed-out call to action, without alarming copy. */
function classify(account: AccountState | null): WaitlistView {
  if (!account || account.failed || !account.signedIn) return 'signed-out';
  return hasPlanFeature(account.entitlement, 'automationMap') ? 'on-list' : 'free';
}

export function showAutomationMapWaitlist(options: WaitlistOptions = {}): WaitlistHandle {
  current?.close();
  const deps = options.deps ?? { send: billingMessage };
  const doc = document;
  if (!doc.getElementById(WAITLIST_STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = WAITLIST_STYLE_ID;
    style.textContent = waitlistCss;
    doc.head.append(style);
  }

  let view: WaitlistView = 'checking';
  let error: string | null = null;
  let closed = false;
  let generation = 0;
  const returnFocus =
    options.invoker ?? (doc.activeElement instanceof HTMLElement ? doc.activeElement : null);

  const titleId = `zcdt-waitlist-title-${Math.random().toString(36).slice(2, 8)}`;
  const descId = `${titleId}-desc`;
  const backdrop = el('div', { className: 'zw-backdrop' });
  backdrop.dataset.zcdtWaitlist = '';
  const dialog = el('div', {
    className: 'zw-dialog',
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'aria-describedby': descId,
      tabindex: '-1',
    },
  });
  const closeButton = el(
    'button',
    {
      className: 'zw-close',
      type: 'button',
      attrs: { 'aria-label': 'Close' },
      dataset: { zcdtWaitlistAction: 'close' },
      onClick: () => close(),
    },
    [closeIcon(14)],
  );
  const body = el('div', { className: 'zw-body' });
  dialog.append(createWaitlistPreview(), closeButton, body);
  backdrop.append(dialog);
  doc.body.append(backdrop);

  const pill = (className: string, label: string, withCheck = false) =>
    el('span', { className: `zw-pill ${className}` }, [
      withCheck ? checkIcon(12) : null,
      doc.createTextNode(label),
    ]);
  const button = (label: string, className: string, name: string, onClick: () => void) =>
    el('button', {
      className,
      type: 'button',
      text: label,
      dataset: { zcdtWaitlistAction: name },
      onClick: (event) => {
        event.preventDefault();
        onClick();
      },
    });

  function render(): void {
    const onList = view === 'on-list';
    const title = onList ? COPY.entitledTitle : COPY.title;
    const copy = onList ? COPY.entitledBody : COPY.body;
    const children: Node[] = [
      el('div', { className: 'zw-pills' }, [
        onList ? pill('zw-pill-ok', 'ON THE WAITLIST', true) : pill('zw-pill-soon', 'COMING SOON'),
        onList ? null : pill('zw-pill-pro', 'PRO'),
      ]),
      el('div', { className: 'zw-text' }, [
        el('h2', { className: 'zw-title', text: title, attrs: { id: titleId } }),
        el('p', { className: 'zw-copy', text: copy, attrs: { id: descId } }),
      ]),
    ];
    if (!onList)
      children.push(
        el(
          'ul',
          { className: 'zw-benefits' },
          COPY.benefits.map((text) =>
            el('li', {}, [
              el('span', { className: 'zw-tick', attrs: { 'aria-hidden': 'true' } }, [
                checkIcon(10),
              ]),
              el('span', { text }),
            ]),
          ),
        ),
      );
    if (error)
      children.push(el('p', { className: 'zw-note', text: error, attrs: { role: 'alert' } }));

    const row = el('div', { className: 'zw-cta' });
    if (view === 'checking' || view === 'signing-in') {
      row.append(
        el('div', { className: 'zw-wait', attrs: { role: 'status' } }, [
          spinnerIcon(16),
          el('span', {
            text:
              view === 'signing-in'
                ? 'Waiting for sign-in in the new tab…'
                : 'Checking your account…',
          }),
        ]),
      );
    } else if (onList) {
      row.append(button('Got it', 'zw-neutral', 'dismiss', () => close()));
    } else if (view === 'awaiting-checkout') {
      row.append(
        button('Check again', 'zw-primary', 'check', () => void recheck()),
        el('span', {
          className: 'zw-fine',
          text: 'Finish checkout in the tab that just opened. This updates here when your plan changes.',
        }),
      );
    } else {
      const signedOut = view === 'signed-out';
      row.append(
        button(
          COPY.cta,
          'zw-primary',
          'join',
          () => void (signedOut ? joinFromSignedOut() : checkout()),
        ),
      );
      if (signedOut) row.append(button('Log in', 'zw-ghost', 'sign-in', () => void logIn()));
      row.append(el('span', { className: 'zw-fine', text: signedOut ? introCopy : monthlyCopy }));
    }
    children.push(row);

    body.replaceChildren(...children);
    dialog.dataset.view = view;
    const active = doc.activeElement;
    if (!active || active === doc.body || active === dialog || !dialog.contains(active))
      (body.querySelector<HTMLElement>('.zw-primary, .zw-neutral') ?? dialog).focus();
  }

  function set(next: WaitlistView, nextError: string | null = null): void {
    if (closed) return;
    view = next;
    error = nextError;
    render();
  }

  async function readAccount(): Promise<AccountState> {
    let account = await deps.send('billing:getEntitlement');
    // A pending rotation needs one more read to finish stored-pair recovery.
    if (account.signedOutPending) account = await deps.send('billing:getEntitlement');
    return account;
  }

  async function init(): Promise<void> {
    const mine = generation;
    let account: AccountState | null = null;
    try {
      account = await readAccount();
    } catch {
      // Falls through to the signed-out call to action.
    }
    if (mine === generation) set(classify(account));
  }

  /** Sign up, then straight into Pro checkout. Never opens the map. */
  async function joinFromSignedOut(): Promise<void> {
    if (view !== 'signed-out') return;
    const mine = generation;
    set('signing-in');
    try {
      let account = await deps.send('billing:signUp');
      if (account.signedOutPending) account = await readAccount();
      if (mine !== generation) return;
      const next = classify(account);
      if (next === 'free') return await checkout();
      if (next === 'on-list') return set('on-list');
      set(
        'signed-out',
        account.cancelled
          ? 'Sign-in was cancelled. You can try again whenever you are ready.'
          : 'Sign-in failed. Please try again.',
      );
    } catch (failure) {
      if (mine === generation) set('signed-out', signInErrorMessage(failure));
    }
  }

  /** Existing accounts: sign in and show where that account stands; do not jump into checkout. */
  async function logIn(): Promise<void> {
    if (view !== 'signed-out') return;
    const mine = generation;
    set('signing-in');
    try {
      let account = await deps.send('billing:signIn');
      if (account.signedOutPending) account = await readAccount();
      if (mine !== generation) return;
      const next = classify(account);
      set(
        next,
        next === 'signed-out'
          ? account.cancelled
            ? 'Sign-in was cancelled. You can try again whenever you are ready.'
            : 'Sign-in failed. Please try again.'
          : null,
      );
    } catch (failure) {
      if (mine === generation) set('signed-out', signInErrorMessage(failure));
    }
  }

  async function checkout(): Promise<void> {
    const mine = generation;
    try {
      await deps.send('billing:openCheckout', { plan: 'pro' });
      if (mine === generation) set('awaiting-checkout');
    } catch {
      if (mine === generation)
        set(
          view === 'signing-in' ? 'free' : view,
          'The checkout page could not be opened. Please try again.',
        );
    }
  }

  async function recheck(quiet = false): Promise<void> {
    const mine = generation;
    if (!quiet) set('checking');
    try {
      const account = await readAccount();
      if (mine !== generation) return;
      if (classify(account) === 'on-list') return set('on-list');
      if (!quiet)
        set(
          'awaiting-checkout',
          'Your plan has not updated yet. It can take up to five minutes after checkout.',
        );
    } catch {
      if (mine === generation && !quiet)
        set('awaiting-checkout', 'We could not check your plan right now. Please try again.');
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    generation++;
    unregister();
    doc.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('focus', onWindowFocus);
    backdrop.remove();
    if (current === handle) current = undefined;
    if (returnFocus?.isConnected && !(returnFocus as HTMLButtonElement).disabled)
      returnFocus.focus();
    options.onClose?.();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = doc.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (!dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }
  // After checkout the user comes back to this tab: look again once, quietly.
  function onWindowFocus(): void {
    if (view === 'awaiting-checkout') void recheck(true);
  }

  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  // Capture on the document so Esc and Tab are handled even if focus has drifted outside.
  doc.addEventListener('keydown', onKeydown, true);
  window.addEventListener('focus', onWindowFocus);
  const unregister = registerUpgradeModalCloser(close);
  const handle: WaitlistHandle = { close };
  current = handle;

  render();
  void init();
  return handle;
}
