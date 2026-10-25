import { contract, WEBSITE_BASE } from '../../billing/config';
import { hasPlanFeature, resolvedPlan } from '../../billing/entitlement';
import { planName, trialPriceCopy } from '../../billing/plans';
import type { BillingAction, BillingPayloads, BillingResults } from '../../billing/protocol';
import { billingMessage } from '../../shared/browser';
import { checkIcon, closeIcon, downloadIcon, el, searchIcon, spinnerIcon } from '../functions/dom';
import {
  ACCOUNT_CHANGED_EVENT,
  EXPORT_REQUEST_EVENT,
  EXPORT_STATE_EVENT,
} from '../functions/export-events';
import modalCss from './upgrade-modal.css?inline';

export const UPGRADE_REQUIRED_EVENT = 'billing:upgradeRequired';
export interface UpgradeRequiredDetail {
  featureId: 'exportFunctions' | 'workflowSearch' | 'automationMap';
  reason: 'paid-required';
}

type AccountState = BillingResults['billing:getEntitlement'];

/** What the modal shows. `error` is an inline, non-alarming note layered on any view. */
export type UpgradeView =
  | 'closed'
  | 'checking'
  | 'signed-out'
  | 'signing-in'
  | 'unavailable'
  | 'free'
  | 'awaiting-checkout';
export interface UpgradeModalState {
  view: UpgradeView;
  error: string | null;
}

export interface UpgradeModalDependencies {
  send<A extends BillingAction>(
    type: A,
    payload?: BillingPayloads[keyof BillingPayloads],
  ): Promise<BillingResults[A]>;
}

export interface UpgradeFeatureConfig {
  featureId: UpgradeRequiredDetail['featureId'];
  title: string;
  body: string;
  freeBody: string;
  benefits: readonly string[];
  icon(): Node;
  onEntitled(): void;
  invoker?: HTMLElement;
  onClose?(): void;
}
export const workflowSearchUpgradeCopy = {
  featureId: 'workflowSearch' as const,
  title: 'Search All Workflows is a paid feature',
  body: 'Search All Workflows is a paid feature included in every paid plan. Search rule configuration and related Deluge source in your browser.',
  freeBody: 'Search All Workflows is a paid feature included in every paid plan.',
  benefits: [
    'Search workflow triggers, conditions and actions',
    'Find related function source with explicit coverage',
    'CRM configuration stays in your browser',
  ],
  icon: () => searchIcon(22),
};

/** Pro prices are projected from the synced contract, independently of the Plus trial. */
const proPlan = contract.plans.find((plan) => plan.key === 'pro');
if (!proPlan) throw new Error('Pro plan missing from product contract');
const proPriceCopy = `$${proPlan.introPriceUsdFirstMonth} for the first month, $${proPlan.priceUsdMonthly}/month after`;
export const automationMapUpgradeCopy = {
  featureId: 'automationMap' as const,
  title: 'Automation Map is a Pro feature',
  body: 'See everything that runs in your CRM and every way a field can change, mapped locally in your browser.',
  freeBody: `Automation Map is included in Pro: ${proPriceCopy} on your first subscription.`,
  benefits: [
    'Every rule, function, button, schedule and API entry point',
    'Field lens: all possible writers and reactors',
    'Trace any automation upstream and downstream',
  ],
  icon: () => searchIcon(22),
};

const STYLE_ID = 'zcdt-upgrade-modal-style';

/** Plan facts come from the shared contract; never restate them here. */
function planFacts() {
  return { trialName: planName(contract.trial.plan), trialDays: contract.trial.days };
}

function isPaid(account: AccountState): boolean {
  return account.signedIn && resolvedPlan(account.entitlement) !== 'free';
}

/** Cancelled windows are a normal outcome, not a failure. */
function signInErrorMessage(error: unknown): string {
  return error instanceof Error && /cancel/i.test(error.message)
    ? 'Sign-in was cancelled. You can try again whenever you are ready.'
    : 'We could not reach the account service. Check your connection and try again.';
}

const openModalClosers = new Set<() => void>();
/** Overlay handoff cancels pending account work through each modal's normal close path. */
export function closeUpgradeModals(): void {
  for (const close of [...openModalClosers]) close();
}

/** Sibling modals (the Automation Map waitlist) join the same handoff close. */
export function registerUpgradeModalCloser(close: () => void): () => void {
  openModalClosers.add(close);
  return () => openModalClosers.delete(close);
}

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Feature-configured upgrade dialog; the default adapter handles blocked Export attempts. The modal lives on `document.body` (not inside
 * the fixed export root) so its stacking context is not capped by the root. `host` is the
 * export root: it supplies the last requested format and receives the resumed request.
 */
export function mountUpgradeHook(
  host: HTMLElement,
  deps: UpgradeModalDependencies = { send: billingMessage },
  config?: UpgradeFeatureConfig,
): () => void {
  const doc = host.ownerDocument;
  const isMap = config?.featureId === 'automationMap';
  const eligible = (account: AccountState) =>
    isMap
      ? !account.failed && account.signedIn && hasPlanFeature(account.entitlement, 'automationMap')
      : isPaid(account);
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = modalCss;
    doc.head.append(style);
  }

  let state: UpgradeModalState = { view: 'closed', error: null };
  let requestedFormat: string | undefined;
  let returnFocus: HTMLElement | null = null;
  // Invalidates in-flight account work when the dialog closes or reopens.
  let generation = 0;
  let disposed = false;

  const titleId = `zcdt-upgrade-title-${Math.random().toString(36).slice(2, 8)}`;
  const descId = `${titleId}-desc`;
  const backdrop = el('div', { className: 'zx-backdrop' });
  backdrop.dataset.zcdtUpgradeModal = '';
  if (isMap) backdrop.dataset.feature = 'automationMap';
  backdrop.hidden = true;
  const dialog = el('div', {
    className: 'zx-dialog',
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'aria-describedby': descId,
      tabindex: '-1',
    },
  });
  backdrop.append(dialog);
  doc.body.append(backdrop);

  const closeButton = (): HTMLButtonElement => {
    const button = el(
      'button',
      {
        className: 'zx-close',
        type: 'button',
        attrs: { 'aria-label': 'Close' },
        dataset: { zcdtUpgradeAction: 'close' },
        onClick: () => close(),
      },
      [closeIcon(16)],
    );
    return button;
  };

  const action = (
    label: string,
    className: string,
    actionName: string,
    onClick: () => void,
    sub?: string,
  ) =>
    el(
      'button',
      {
        className,
        type: 'button',
        dataset: { zcdtUpgradeAction: actionName },
        onClick: (event) => {
          event.preventDefault();
          onClick();
        },
      },
      [
        el('span', { className: 'zx-btn-label', text: label }),
        sub ? el('span', { className: 'zx-btn-sub', text: sub }) : null,
      ],
    );

  const benefit = (text: string) =>
    el('li', {}, [el('span', { className: 'zx-tick' }, [checkIcon(14)]), el('span', { text })]);

  function render(): void {
    const { view, error } = state;
    const { trialName, trialDays } = planFacts();
    const children: Node[] = [closeButton()];
    const proPill = el('span', { className: 'zx-pro', text: isMap ? 'PRO' : 'PAID' });
    const mark = el('div', { className: 'zx-mark', attrs: { 'aria-hidden': 'true' } }, [
      config?.icon() ?? downloadIcon(22),
    ]);
    const heading = (title: string, body: string) => [
      el('div', { className: 'zx-head' }, [mark, proPill]),
      el('h2', { className: 'zx-title', text: title, attrs: { id: titleId } }),
      el('p', { className: 'zx-copy', text: body, attrs: { id: descId } }),
    ];
    const note = error
      ? el('p', { className: 'zx-note', text: error, attrs: { role: 'alert' } })
      : null;

    if (view === 'checking' || view === 'signing-in') {
      const busy = view === 'signing-in';
      children.push(
        ...heading(
          busy ? 'Finish signing in' : (config?.title ?? 'Export functions'),
          busy
            ? 'Complete sign-in in the tab that just opened. This page will continue automatically.'
            : 'Checking your account…',
        ),
        el('div', { className: 'zx-wait', attrs: { role: 'status' } }, [
          spinnerIcon(18),
          el('span', { text: busy ? 'Waiting for sign-in…' : 'One moment…' }),
        ]),
      );
    } else if (view === 'unavailable') {
      children.push(
        ...heading(
          'Account unavailable',
          'We could not verify your plan. Your free editor and search tools keep working.',
        ),
        action('Check again', 'zx-primary', 'check', () => void recheck()),
      );
    } else if (view === 'free' || view === 'awaiting-checkout') {
      const waiting = view === 'awaiting-checkout';
      children.push(
        ...heading(
          waiting ? 'Almost there' : (config?.title ?? 'Export is a paid feature'),
          waiting
            ? 'Finish upgrading in the tab that just opened, then check again here.'
            : (config?.freeBody ??
                `Your account is on the Free plan. Plus includes function export: ${trialPriceCopy} on your first subscription. The search and editor tools you use today stay free.`),
        ),
      );
      if (note) children.push(note);
      children.push(
        el('div', { className: 'zx-actions' }, [
          waiting
            ? action('I have upgraded, check again', 'zx-primary', 'check', () => void recheck())
            : action(
                isMap ? 'Upgrade to Pro' : `Upgrade to ${trialName}`,
                'zx-primary',
                'plans',
                () => void (isMap ? checkoutPro() : openExternal('billing:openUpgrade')),
              ),
          action(
            'Manage account',
            'zx-link',
            'account',
            () => void openExternal('billing:openAccount', false),
          ),
        ]),
      );
    } else {
      children.push(
        ...heading(
          config?.title ?? 'Export is a paid feature',
          config?.body ??
            'Download all your Zoho CRM functions in one step, including their Deluge code.',
        ),
        el(
          'ul',
          { className: 'zx-benefits' },
          config
            ? config.benefits.map(benefit)
            : [
                benefit('Export every function as JSON, CSV or Markdown'),
                benefit('Keep backups for audits, handovers and migrations'),
                benefit('Files are built in your browser and never sent to us'),
              ],
        ),
      );
      if (note) children.push(note);
      children.push(
        el('div', { className: 'zx-actions' }, [
          isMap
            ? action(
                'Log in',
                'zx-primary',
                'sign-in',
                () => void signIn(),
                `Pro · ${proPriceCopy}`,
              )
            : action(
                `Start free ${trialDays}-day ${trialName} trial`,
                'zx-primary',
                'sign-in',
                () => void signIn('billing:signUp'),
                `No card required · then ${trialPriceCopy}`,
              ),
          isMap
            ? null
            : el('p', { className: 'zx-alt' }, [
                document.createTextNode('Already have an account? '),
                el('button', {
                  className: 'zx-inline',
                  type: 'button',
                  text: 'Log in',
                  dataset: { zcdtUpgradeAction: 'sign-in-existing' },
                  onClick: (event) => {
                    event.preventDefault();
                    void signIn();
                  },
                }),
              ]),
        ]),
      );
    }
    if (view === 'signed-out' || view === 'free') {
      children.push(
        el('p', { className: 'zx-alt' }, [
          el('a', {
            className: 'zx-inline',
            text: 'See all plans · Plus, Pro and Max',
            attrs: {
              href: `${WEBSITE_BASE}/pricing`,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            dataset: { zcdtUpgradeAction: 'all-plans' },
            onClick: (event) => {
              event.preventDefault();
              void openExternal('billing:openUpgrade');
            },
          }),
        ]),
      );
    }
    dialog.replaceChildren(...children);
    dialog.dataset.view = view;
    dialog.dataset.hasError = error ? 'true' : 'false';
    if (!dialog.contains(doc.activeElement) || doc.activeElement === doc.body) {
      (dialog.querySelector<HTMLElement>('.zx-primary') ?? dialog).focus();
    }
  }

  function set(next: Partial<UpgradeModalState>): void {
    if (disposed) return;
    state = { ...state, ...next };
    backdrop.hidden = state.view === 'closed';
    backdrop.dataset.view = state.view;
    if (state.view !== 'closed') render();
  }

  async function readAccount(): Promise<AccountState> {
    let account = await deps.send('billing:getEntitlement');
    // A pending rotation needs one more read to finish stored-pair recovery.
    if (account.signedOutPending) account = await deps.send('billing:getEntitlement');
    return account;
  }

  function classify(account: AccountState): UpgradeView {
    if (account.signedIn && !account.entitlement.checkedAt) return 'unavailable';
    return account.signedIn ? 'free' : 'signed-out';
  }

  function resumeExport(): void {
    if (config) {
      config.onEntitled();
      return;
    }
    if (requestedFormat)
      host.dispatchEvent(
        new CustomEvent(EXPORT_REQUEST_EVENT, { detail: { format: requestedFormat } }),
      );
  }

  function close(): void {
    if (state.view === 'closed') return;
    generation++;
    set({ view: 'closed', error: null });
    const previous = config?.invoker ?? returnFocus;
    const target =
      previous?.isConnected && !(previous as HTMLButtonElement).disabled
        ? previous
        : (config?.invoker ?? host.querySelector<HTMLElement>('[data-zcdt-export-run]'));
    returnFocus = null;
    target?.focus();
    config?.onClose?.();
  }

  /** Entitled: dismiss, tell the export control, and run the export the user asked for. */
  function finishEntitled(): void {
    host.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT, { bubbles: true }));
    close();
    resumeExport();
  }

  async function open(): Promise<void> {
    if (state.view !== 'closed') return;
    const mine = ++generation;
    returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    set({ view: 'checking', error: null });
    let view: UpgradeView = 'signed-out';
    try {
      const account = await readAccount();
      if (mine !== generation) return;
      if (eligible(account)) {
        finishEntitled();
        return;
      }
      view = classify(account);
    } catch {
      if (mine !== generation) return;
    }
    set({ view, error: null });
  }

  /** The trial button opens sign-up (new accounts get the trial); "Log in" opens login. */
  async function signIn(
    type: 'billing:signIn' | 'billing:signUp' = 'billing:signIn',
  ): Promise<void> {
    if (state.view !== 'signed-out') return;
    const mine = generation;
    set({ view: 'signing-in', error: null });
    try {
      let account = await deps.send(type);
      if (account.signedOutPending) account = await deps.send('billing:getEntitlement');
      if (mine !== generation) {
        host.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT, { bubbles: true }));
        return;
      }
      if (eligible(account)) return finishEntitled();
      if (account.signedIn) {
        host.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT, { bubbles: true }));
        return set({ view: classify(account), error: null });
      }
      set({
        view: 'signed-out',
        error: account.cancelled
          ? 'Sign-in was cancelled. You can try again whenever you are ready.'
          : 'Sign-in failed. Please try again.',
      });
    } catch (error) {
      if (mine !== generation) return;
      set({ view: 'signed-out', error: signInErrorMessage(error) });
    }
  }

  async function openExternal(type: 'billing:openUpgrade' | 'billing:openAccount', await_ = true) {
    const mine = generation;
    try {
      await deps.send(type);
      if (mine === generation && await_) set({ view: 'awaiting-checkout', error: null });
    } catch {
      if (mine === generation)
        set({ error: 'The account page could not be opened. Please try again.' });
    }
  }

  async function checkoutPro(): Promise<void> {
    const mine = generation;
    try {
      await deps.send('billing:openCheckout', { plan: 'pro' });
      if (mine === generation) set({ view: 'awaiting-checkout', error: null });
    } catch {
      if (mine === generation)
        set({ error: 'The account page could not be opened. Please try again.' });
    }
  }

  async function recheck(): Promise<void> {
    const mine = generation;
    set({ view: 'checking', error: null });
    try {
      const account = await readAccount();
      if (mine !== generation) return;
      if (eligible(account)) return finishEntitled();
      if (classify(account) === 'unavailable') return set({ view: 'unavailable', error: null });
      set({
        view: 'awaiting-checkout',
        error: 'Your plan has not updated yet. It can take up to five minutes after checkout.',
      });
    } catch {
      if (mine === generation)
        set({
          view: 'awaiting-checkout',
          error: 'We could not check your plan right now. Please try again.',
        });
    }
  }

  const onRequired = (event: Event) => {
    const detail = (event as CustomEvent<UpgradeRequiredDetail>).detail;
    if (
      detail?.featureId === (config?.featureId ?? 'exportFunctions') &&
      detail.reason === 'paid-required'
    )
      void open();
  };
  const onExportState = (event: Event) => {
    const detail = (event as CustomEvent<{ format?: string }>).detail;
    if (detail?.format) requestedFormat = detail.format;
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (state.view === 'closed') return;
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
  };
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.addEventListener('keydown', onKeydown);
  doc.addEventListener(UPGRADE_REQUIRED_EVENT, onRequired);
  host.addEventListener(EXPORT_STATE_EVENT, onExportState);
  openModalClosers.add(close);

  return () => {
    openModalClosers.delete(close);
    close();
    disposed = true;
    generation++;
    doc.removeEventListener(UPGRADE_REQUIRED_EVENT, onRequired);
    host.removeEventListener(EXPORT_STATE_EVENT, onExportState);
    backdrop.remove();
  };
}
