import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FREE } from '../src/billing/entitlement';
import { mountUpgradeHook, UPGRADE_REQUIRED_EVENT } from '../src/content/billing/upgrade-hook';
import {
  ACCOUNT_CHANGED_EVENT,
  EXPORT_REQUEST_EVENT,
  EXPORT_STATE_EVENT,
} from '../src/content/functions/export-events';
import { mountFunctionExport } from '../src/content/functions/export-ui';

vi.mock('../src/settings/storage', () => ({
  loadSettings: vi.fn(async () => ({ enabled: true })),
}));

const pro = {
  ...FREE,
  plan: 'pro' as const,
  entitled: true,
  status: 'trialing',
  checkedAt: '2026-10-20T12:00:00.000Z',
};
const signedOut = { signedIn: false, entitlement: FREE };
const freeAccount = { signedIn: true, entitlement: { ...FREE, checkedAt: pro.checkedAt } };
const proAccount = { signedIn: true, entitlement: pro };

const modal = () => document.querySelector<HTMLElement>('[data-zcdt-upgrade-modal]') as HTMLElement;
const dialog = () => modal().querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;
const act = (name: string) =>
  modal().querySelector<HTMLButtonElement>(`[data-zcdt-upgrade-action="${name}"]`) as HTMLElement;
const raise = () =>
  document.dispatchEvent(
    new CustomEvent(UPGRADE_REQUIRED_EVENT, {
      detail: { featureId: 'exportFunctions', reason: 'pro-required' },
    }),
  );
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type Send = (type: string) => Promise<unknown>;
function setup(send: Send) {
  const host = document.createElement('section');
  const trigger = document.createElement('button');
  trigger.dataset.zcdtExportRun = '';
  host.append(trigger);
  document.body.append(host);
  const resumed = vi.fn();
  host.addEventListener(EXPORT_REQUEST_EVENT, (event) => resumed((event as CustomEvent).detail));
  const dispose = mountUpgradeHook(host, { send: send as never });
  host.dispatchEvent(
    new CustomEvent(EXPORT_STATE_EVENT, { detail: { status: 'upgrade-required', format: 'csv' } }),
  );
  trigger.focus();
  disposers.push(dispose);
  return { host, trigger, resumed, dispose };
}

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('upgrade modal state machine', () => {
  it('shows unavailable rather than a Free-plan upsell on a failed entitlement read', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ signedIn: true, entitlement: FREE })
      .mockResolvedValue(proAccount);
    const { resumed } = setup(send);
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('unavailable'));
    expect(dialog().textContent).toContain('could not verify your plan');
    expect(dialog().textContent).not.toContain('Your account is on the Free plan');
    act('check').click();
    await vi.waitFor(() => expect(resumed).toHaveBeenCalledOnce());
  });
  it('shows the signed-out trial offer with contract-derived copy and dialog semantics', async () => {
    const { dispose } = setup(async () => signedOut);
    expect(modal().hidden).toBe(true);
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('signed-out'));
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog().textContent).toContain('Export is a Pro feature');
    expect(act('sign-in').textContent).toContain('Start free 14-day Pro trial');
    expect(act('sign-in').textContent).toContain('No card required');
    expect(dialog().textContent).toContain('Already have an account?');
    dispose();
    expect(document.querySelector('[data-zcdt-upgrade-modal]')).toBeNull();
  });

  it('signs in, closes, restores focus and resumes the requested export', async () => {
    const send = vi.fn(async (type: string) =>
      type === 'billing:getEntitlement' ? signedOut : proAccount,
    );
    const { trigger, resumed } = setup(send);
    const changed = vi.fn();
    document.addEventListener(ACCOUNT_CHANGED_EVENT, changed);
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('signed-out'));
    act('sign-in').click();
    expect(dialog().dataset.view).toBe('signing-in');
    await vi.waitFor(() => expect(modal().hidden).toBe(true));
    expect(send).toHaveBeenCalledWith('billing:signIn');
    expect(resumed).toHaveBeenCalledWith({ format: 'csv' });
    expect(changed).toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    document.removeEventListener(ACCOUNT_CHANGED_EVENT, changed);
  });

  it('the secondary sign-in link runs the same action', async () => {
    const send = vi.fn(async (type: string) =>
      type === 'billing:getEntitlement' ? signedOut : proAccount,
    );
    const { resumed } = setup(send);
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('signed-out'));
    act('sign-in-existing').click();
    await vi.waitFor(() => expect(resumed).toHaveBeenCalledOnce());
  });

  it('moves to the Free upgrade view when sign-in lands on an unentitled account', async () => {
    const send = vi.fn(async (type: string) =>
      type === 'billing:getEntitlement' ? signedOut : freeAccount,
    );
    const { resumed } = setup(send);
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('signed-out'));
    act('sign-in').click();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('free'));
    expect(modal().hidden).toBe(false);
    expect(resumed).not.toHaveBeenCalled();
  });

  it('resolves a pending stored-pair recovery with one more read', async () => {
    const reads = vi.fn();
    const send = async (type: string) => {
      if (type === 'billing:signIn')
        return { signedIn: false, signedOutPending: true, entitlement: FREE };
      reads();
      return reads.mock.calls.length === 1 ? signedOut : proAccount;
    };
    const { resumed } = setup(send);
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('signed-out'));
    act('sign-in').click();
    await vi.waitFor(() => expect(resumed).toHaveBeenCalledOnce());
  });

  it('shows Free copy from the contract and routes plan/account actions', async () => {
    const send = vi.fn(async (type: string) =>
      type === 'billing:getEntitlement' ? freeAccount : null,
    );
    setup(send);
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('free'));
    expect(act('plans').textContent).toBe('Upgrade to Pro — $23/month');
    act('account').click();
    await flush();
    expect(send).toHaveBeenCalledWith('billing:openAccount');
    expect(dialog().dataset.view).toBe('free');
    act('plans').click();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('awaiting-checkout'));
    expect(send).toHaveBeenCalledWith('billing:openUpgrade');
  });

  it('re-checks after checkout and resumes once Pro is active', async () => {
    let account: unknown = freeAccount;
    const send = vi.fn(async (type: string) =>
      type === 'billing:getEntitlement' ? account : null,
    );
    const { resumed } = setup(send);
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('free'));
    act('plans').click();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('awaiting-checkout'));
    act('check').click();
    await vi.waitFor(() => expect(dialog().dataset.hasError).toBe('true'));
    expect(resumed).not.toHaveBeenCalled();
    account = proAccount;
    act('check').click();
    await vi.waitFor(() => expect(resumed).toHaveBeenCalledWith({ format: 'csv' }));
    expect(modal().hidden).toBe(true);
  });

  it.each([
    ['Sign-in canceled', /cancelled/],
    ['network down', /could not reach/],
  ])('keeps the dialog open with a calm inline message on "%s"', async (message, pattern) => {
    const send = async (type: string) => {
      if (type === 'billing:signIn') throw new Error(message);
      return signedOut;
    };
    const { resumed } = setup(send);
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('signed-out'));
    act('sign-in').click();
    await vi.waitFor(() => expect(dialog().dataset.hasError).toBe('true'));
    expect(dialog().querySelector('[role="alert"]')?.textContent).toMatch(pattern);
    expect(modal().hidden).toBe(false);
    expect(resumed).not.toHaveBeenCalled();
    expect(act('sign-in')).not.toBeNull();
  });

  it.each([
    [{ cancelled: true }, /was cancelled/],
    [{ failed: true }, /Sign-in failed/],
  ])('distinguishes returned sign-in outcome %j', async (outcome, pattern) => {
    const { resumed } = setup(async (type: string) =>
      type === 'billing:signIn' ? { ...signedOut, ...outcome } : signedOut,
    );
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('signed-out'));
    act('sign-in').click();
    await vi.waitFor(() => expect(dialog().dataset.hasError).toBe('true'));
    expect(dialog().querySelector('[role="alert"]')?.textContent).toMatch(pattern);
    expect(resumed).not.toHaveBeenCalled();
  });

  it('falls back to the signed-out offer when the account service is unreachable', async () => {
    setup(async () => {
      throw new Error('offline');
    });
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('signed-out'));
  });

  it('skips the dialog entirely if the user is already entitled', async () => {
    const { resumed } = setup(async () => proAccount);
    raise();
    await vi.waitFor(() => expect(resumed).toHaveBeenCalledOnce());
    expect(modal().hidden).toBe(true);
  });

  it('closes with Escape, the close button and the backdrop, restoring focus each time', async () => {
    const { trigger } = setup(async () => signedOut);
    for (const how of ['escape', 'button', 'backdrop']) {
      raise();
      await vi.waitFor(() => expect(dialog().dataset.view).toBe('signed-out'));
      expect(dialog().contains(document.activeElement)).toBe(true);
      if (how === 'escape')
        dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (how === 'button') act('close').click();
      if (how === 'backdrop') modal().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(modal().hidden).toBe(true);
      expect(document.activeElement).toBe(trigger);
    }
  });

  it('does not resume an export the user dismissed while sign-in was pending', async () => {
    let finish: (value: unknown) => void = () => {};
    const send = (type: string) =>
      type === 'billing:signIn'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(signedOut);
    const { resumed } = setup(send);
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('signed-out'));
    act('sign-in').click();
    act('close').click();
    finish(proAccount);
    await flush();
    expect(resumed).not.toHaveBeenCalled();
  });

  it('traps Tab inside the dialog', async () => {
    setup(async () => signedOut);
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('signed-out'));
    const focusable = [...dialog().querySelectorAll<HTMLElement>('button:not([disabled])')];
    const last = focusable[focusable.length - 1];
    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);
    const back = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    focusable[0].dispatchEvent(back);
    expect(document.activeElement).toBe(last);
  });

  it('ignores upgrade events for other features', async () => {
    setup(async () => signedOut);
    document.dispatchEvent(
      new CustomEvent(UPGRADE_REQUIRED_EVENT, { detail: { featureId: 'githubSync' } }),
    );
    await flush();
    expect(modal().hidden).toBe(true);
  });

  it('restores focus when an open modal is unmounted', async () => {
    const { trigger, dispose } = setup(async () => signedOut);
    raise();
    await vi.waitFor(() => expect(dialog().dataset.view).toBe('signed-out'));
    dispose();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('export control states', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  const mount = (account: unknown | Error, extra: Record<string, unknown> = {}) => {
    const root = document.createElement('section');
    root.id = 'zcdt-function-export';
    document.body.append(root);
    const getEntitlement = vi.fn(async () => {
      if (account instanceof Error) throw account;
      return account as never;
    });
    const dispose = mountFunctionExport(root, { getEntitlement, ...extra });
    disposers.push(dispose);
    const q = (selector: string) => root.querySelector<HTMLElement>(selector) as HTMLElement;
    return { root, dispose, q, getEntitlement };
  };

  it('keeps a neutral tooltip and no badge for every account plan', async () => {
    const free = mount(signedOut);
    expect(free.q('[data-zcdt-export-run]')).not.toBeNull();
    expect(free.root.querySelector('.zx-badge')).toBeNull();
    expect(free.q('[data-zcdt-export-run]').title).toBe('Export functions');
    await vi.waitFor(() => expect(free.root.dataset.exportPlan).toBe('free'));
    expect(free.root.querySelector('.zx-badge')).toBeNull();
    free.dispose();
    document.body.innerHTML = '';
    const entitled = mount(proAccount);
    await vi.waitFor(() => expect(entitled.root.dataset.exportPlan).toBe('pro'));
    expect(entitled.root.querySelector('.zx-badge')).toBeNull();
  });

  it('shows no badge when the account service fails', async () => {
    const failing = mount(new Error('offline'));
    await flush();
    expect(failing.root.dataset.exportPlan).toBe('unknown');
    expect(failing.root.querySelector('.zx-badge')).toBeNull();
  });

  it('opens a three-format menu and requests the chosen format', async () => {
    const { root, q } = mount(proAccount, {
      load: vi.fn(async () => ({ records: [], skipped: [] })),
      download: vi.fn(),
      contextIsCurrent: () => true,
    });
    const requested = vi.fn();
    root.addEventListener(EXPORT_REQUEST_EVENT, (event) =>
      requested((event as CustomEvent).detail),
    );
    expect(q('.zx-menu').hidden).toBe(true);
    q('[data-zcdt-export-run]').click();
    expect(q('.zx-menu').hidden).toBe(false);
    expect(q('[data-zcdt-export-run]').getAttribute('aria-expanded')).toBe('true');
    expect(
      [...root.querySelectorAll('[data-zcdt-export-format]')].map(
        (n) => (n as HTMLElement).dataset.zcdtExportFormat,
      ),
    ).toEqual(['json', 'csv', 'markdown']);
    q('[data-zcdt-export-format="markdown"]').click();
    expect(requested).toHaveBeenCalledWith({ format: 'markdown' });
    expect(q('.zx-menu').hidden).toBe(true);
  });

  it('closes the menu on Escape and outside click', () => {
    const { q } = mount(proAccount);
    q('[data-zcdt-export-run]').click();
    q('.zx-menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(q('.zx-menu').hidden).toBe(true);
    q('[data-zcdt-export-run]').click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(q('.zx-menu').hidden).toBe(true);
  });

  it('opens on the first keyboard item and restores the trigger before tabbing away', () => {
    const { q } = mount(proAccount);
    const trigger = q('[data-zcdt-export-run]');
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(q('[data-zcdt-export-format="json"]'));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    expect(q('.zx-menu').hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('reports progress, success with filename, and errors with retry', async () => {
    history.replaceState({}, '', '/org42/settings/functions');
    let release: () => void = () => {};
    let fail = false;
    const download = vi.fn();
    const { root, q } = mount(proAccount, {
      load: vi.fn(async (_context: unknown, progress: (v: object) => void) => {
        progress({ loaded: 12, total: 140 });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        if (fail) throw new Error('boom');
        return {
          records: [
            {
              summary: { id: '1', display_name: 'One', category: 'Standalone' },
              detail: { id: '1', script: 'info 1;' },
            },
          ],
          skipped: [{ id: '2', name: 'Missing', apiName: '', reason: 'Zoho returned HTTP 503' }],
        };
      }),
      download,
      contextIsCurrent: () => true,
    });
    const status = () => q('[data-zcdt-export-status]');
    q('[data-zcdt-export-run]').click();
    q('[data-zcdt-export-format="json"]').click();
    await vi.waitFor(() => expect(status().textContent).toContain('Exporting 12 of 140'));
    expect((q('[data-zcdt-export-run]') as HTMLButtonElement).disabled).toBe(true);
    expect(root.getAttribute('aria-busy')).toBe('true');
    release();
    await vi.waitFor(() =>
      expect(status().textContent).toContain(
        "Exported 1 of 2 functions — 1 couldn't be read from Zoho (listed in the file)",
      ),
    );
    expect(status().textContent).toMatch(/\.json/);
    expect((q('[data-zcdt-export-run]') as HTMLButtonElement).disabled).toBe(false);
    status().querySelector<HTMLButtonElement>('.zx-dismiss')?.click();
    expect(status().textContent).toBe('');

    fail = true;
    q('[data-zcdt-export-run]').click();
    q('[data-zcdt-export-format="csv"]').click();
    await vi.waitFor(() => expect(status().textContent).toContain('Exporting 12 of 140'));
    release();
    await vi.waitFor(() => expect(status().dataset.kind).toBe('error'));
    expect(status().textContent).toContain('No file was downloaded');
    expect(q('[data-zcdt-export-run]').textContent).toBe('Export');
    expect(q('.zx-actions').textContent).toContain('Try againDismiss');
    fail = false;
    status().querySelector<HTMLButtonElement>('.zx-retry')?.click();
    await vi.waitFor(() => expect(status().textContent).toContain('Exporting 12 of 140'));
    release();
    await vi.waitFor(() => expect(status().dataset.kind).toBe('complete'));
    expect(status().textContent).toMatch(/\.csv/);
  });
});
