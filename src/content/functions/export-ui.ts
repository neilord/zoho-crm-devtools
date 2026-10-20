import { FREE } from '../../billing/entitlement';
import { EXPORT_FORMATS, type ExportFormat, isExportFormat } from '../../features/function-export';
import { getFeature, isFeatureAvailable } from '../../features/registry';
import { loadSettings } from '../../settings/storage';
import { billingMessage, downloadTextFile } from '../../shared/browser';
import {
  mountUpgradeHook,
  UPGRADE_REQUIRED_EVENT,
  type UpgradeRequiredDetail,
} from '../billing/upgrade-hook';
import { isFunctionsListLocation } from '../zoho/functions-page';
import { resolveCrmContext } from './crm-context';
import { checkIcon, chevronIcon, downloadIcon, el, spinnerIcon, warnIcon } from './dom';
import exportCss from './export.css?inline';
import { type ExportDependencies, type ExportState, runFunctionExport } from './export-controller';
import { ACCOUNT_CHANGED_EVENT, EXPORT_REQUEST_EVENT, EXPORT_STATE_EVENT } from './export-events';
import { loadExportFunctions } from './export-loader';

export { EXPORT_REQUEST_EVENT, EXPORT_STATE_EVENT };
export const EXPORT_MOUNT_ID = 'zcdt-function-export';
const STYLE_ID = 'zcdt-function-export-style';
const SUCCESS_LINGER_MS = 6_000;

const FORMAT_COPY: Record<ExportFormat, { label: string; hint: string }> = {
  json: { label: 'JSON', hint: 'Full backup, including code' },
  csv: { label: 'CSV', hint: 'Spreadsheet-friendly' },
  markdown: { label: 'Markdown', hint: 'Readable documentation' },
};

/** Resolved account plan for the export gate. */
export type ExportPlanState = 'unknown' | 'pro' | 'free';

/**
 * Export control: a native-looking button that opens a format menu, plus an anchored status popover.
 * Light DOM (hooks stay queryable); styles are injected once and scoped under the root id.
 */
export function mountFunctionExport(
  root: HTMLElement,
  overrides: Partial<ExportDependencies> = {},
): () => void {
  const doc = root.ownerDocument;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = exportCss;
    doc.head.append(style);
  }
  root.dataset.zcdtFunctionExport = '';
  root.dataset.exportState = 'idle';
  root.dataset.exportPlan = 'unknown';

  const button = el(
    'button',
    {
      className: 'zx-trigger',
      type: 'button',
      title: 'Export functions',
      attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
      dataset: { zcdtExportRun: '' },
    },
    [
      downloadIcon(16),
      el('span', { className: 'zx-trigger-label', text: 'Export' }),
      chevronIcon(12),
    ],
  );
  const menu = el('div', {
    className: 'zx-menu',
    attrs: { role: 'menu', 'aria-label': 'Export format' },
  });
  menu.hidden = true;
  const items = EXPORT_FORMATS.map((format) =>
    el(
      'button',
      {
        className: 'zx-item',
        type: 'button',
        attrs: { role: 'menuitem' },
        dataset: { zcdtExportFormat: format },
      },
      [
        el('span', { className: 'zx-item-label', text: FORMAT_COPY[format].label }),
        el('span', { className: 'zx-item-hint', text: FORMAT_COPY[format].hint }),
      ],
    ),
  );
  menu.append(...items);
  const status = el('div', {
    className: 'zx-status',
    attrs: { 'aria-live': 'polite' },
    dataset: { zcdtExportStatus: '' },
  });
  const row = el('div', { className: 'zx-row' }, [button, status]);
  root.append(menu, row);

  let disposed = false;
  let active: AbortController | undefined;
  let lingerTimer: ReturnType<typeof setTimeout> | undefined;
  let menuOpen = false;
  const positionStatus = (): void => {
    if (!status.childNodes.length) return;
    const anchor = button.getBoundingClientRect();
    const width = status.getBoundingClientRect().width;
    status.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
    status.style.top = `${anchor.bottom + 6 + (menuOpen ? menu.getBoundingClientRect().height + 6 : 0)}px`;
  };
  const setMenu = (open: boolean, focusFirst = false): void => {
    menuOpen = open;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      // Zoho's toolbar clips overflow. Fixed positioning escapes it without changing native CSS.
      const anchor = button.getBoundingClientRect();
      const width = menu.getBoundingClientRect().width;
      menu.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
      menu.style.top = `${anchor.bottom + 6}px`;
      if (focusFirst) items[0]?.focus();
    }
    positionStatus();
  };

  const dismissStatus = (): void => {
    clearTimeout(lingerTimer);
    status.replaceChildren();
  };
  const dismissButton = () =>
    el('button', {
      className: 'zx-dismiss',
      type: 'button',
      text: 'Dismiss',
      onClick: () => dismissStatus(),
    });
  const renderStatus = (value: ExportState): void => {
    clearTimeout(lingerTimer);
    status.dataset.kind = value.status;
    if (value.status === 'checking-entitlement') {
      status.replaceChildren(
        el('span', { className: 'zx-msg' }, [
          spinnerIcon(14),
          document.createTextNode('Checking your plan\u2026'),
        ]),
      );
    } else if (value.status === 'loading') {
      const known = value.total > 0;
      const bar = el('span', { className: 'zx-bar', attrs: { 'aria-hidden': 'true' } }, [
        el('span', { className: 'zx-bar-fill' }),
      ]);
      if (known)
        bar.style.setProperty(
          '--zx-progress',
          `${Math.round((value.loaded / value.total) * 100)}%`,
        );
      else bar.dataset.indeterminate = 'true';
      status.replaceChildren(
        el('span', { className: 'zx-msg' }, [
          spinnerIcon(14),
          document.createTextNode(
            known ? `Exporting ${value.loaded} of ${value.total}\u2026` : 'Exporting\u2026',
          ),
        ]),
        bar,
      );
    } else if (value.status === 'complete') {
      status.replaceChildren(
        el('span', { className: 'zx-msg zx-ok' }, [
          checkIcon(14),
          el('span', {
            text: value.skipped
              ? `Exported ${value.count} of ${value.total} functions — ${value.skipped} couldn't be read from Zoho (listed in the file)`
              : `Exported ${value.count} ${value.count === 1 ? 'function' : 'functions'}`,
          }),
        ]),
        el('span', { className: 'zx-file', text: value.filename, title: value.filename }),
        el('div', { className: 'zx-actions' }, [dismissButton()]),
      );
      lingerTimer = setTimeout(dismissStatus, SUCCESS_LINGER_MS);
    } else if (value.status === 'error') {
      status.replaceChildren(
        el('span', { className: 'zx-msg zx-err' }, [
          warnIcon(14),
          el('span', { text: value.message }),
        ]),
        el('div', { className: 'zx-actions' }, [
          el('button', {
            className: 'zx-retry',
            type: 'button',
            text: 'Try again',
            onClick: () => requestExport(value.format),
          }),
          dismissButton(),
        ]),
      );
    } else {
      // Upgrade-required: the modal owns the message; leave no stale chip behind.
      dismissStatus();
    }
    positionStatus();
  };

  const setPlan = (plan: ExportPlanState): void => {
    root.dataset.exportPlan = plan;
  };
  let planGeneration = 0;
  const refreshPlan = async (): Promise<void> => {
    const mine = ++planGeneration;
    try {
      const read = overrides.getEntitlement ?? (() => billingMessage('billing:getEntitlement'));
      let account = await read();
      if (account.signedOutPending) account = await read();
      if (disposed || mine !== planGeneration) return;
      if (account.signedIn && !account.entitlement.checkedAt) return setPlan('unknown');
      const entitled = isFeatureAvailable(
        getFeature('exportFunctions'),
        account.signedIn ? account.entitlement : FREE,
      );
      setPlan(entitled ? 'pro' : 'free');
    } catch {
      if (!disposed && mine === planGeneration) setPlan('unknown');
    }
  };
  // Never blocks rendering: the control is usable immediately and the plan resolves later.
  void refreshPlan();
  const unmountUpgrade = mountUpgradeHook(root);
  const notify = (value: ExportState) => {
    if (disposed) return;
    root.dataset.exportState = value.status;
    renderStatus(value);
    if (value.status === 'upgrade-required') setPlan('free');
    root.dispatchEvent(new CustomEvent(EXPORT_STATE_EVENT, { bubbles: true, detail: value }));
    overrides.state?.(value);
  };
  const setBusy = (busy: boolean): void => {
    button.disabled = busy;
    for (const item of items) item.disabled = busy;
    root.setAttribute('aria-busy', String(busy));
  };
  const request = async (event: Event) => {
    const format = (event as CustomEvent<{ format: unknown }>).detail?.format;
    if (disposed || active || !isExportFormat(format)) return;
    active = new AbortController();
    setMenu(false);
    setBusy(true);
    try {
      const settings = await loadSettings();
      if (!settings.enabled || disposed) return;
      const context = resolveCrmContext();
      if (!context) {
        notify({ status: 'error', format, message: 'Open a Zoho Functions list to export.' });
        return;
      }
      await runFunctionExport(
        context,
        format,
        {
          getEntitlement: () => billingMessage('billing:getEntitlement'),
          load: loadExportFunctions,
          download: downloadTextFile,
          upgradeRequired: () =>
            root.dispatchEvent(
              new CustomEvent<UpgradeRequiredDetail>(UPGRADE_REQUIRED_EVENT, {
                bubbles: true,
                detail: { featureId: 'exportFunctions', reason: 'pro-required' },
              }),
            ),
          contextIsCurrent: () => {
            const current = resolveCrmContext();
            return (
              !disposed &&
              isFunctionsListLocation() &&
              current?.origin === context.origin &&
              current.orgId === context.orgId
            );
          },
          now: () => new Date().toISOString(),
          ...overrides,
          state: notify,
        },
        active.signal,
      );
    } catch {
      notify({
        status: 'error',
        format,
        message: 'Export is unavailable. Free tools remain available.',
      });
    } finally {
      active = undefined;
      if (!disposed) setBusy(false);
    }
  };
  function requestExport(format: ExportFormat): void {
    root.dispatchEvent(new CustomEvent(EXPORT_REQUEST_EVENT, { detail: { format } }));
  }
  const handle = (event: Event) => {
    void request(event);
  };
  const onAccountChanged = () => void refreshPlan();
  const onDocumentPointer = (event: Event) => {
    if (menuOpen && !root.contains(event.target as Node)) setMenu(false);
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (!menuOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setMenu(false);
      button.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const at = items.indexOf(doc.activeElement as HTMLButtonElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === 'Tab') {
      setMenu(false);
      // Continue tab order from the trigger rather than a now-hidden menu item.
      button.focus();
    }
  };
  root.addEventListener(EXPORT_REQUEST_EVENT, handle);
  root.addEventListener(ACCOUNT_CHANGED_EVENT, onAccountChanged);
  root.addEventListener('keydown', onKeydown);
  doc.addEventListener('mousedown', onDocumentPointer);
  window.addEventListener('resize', positionStatus);
  doc.addEventListener('scroll', positionStatus, true);
  button.addEventListener('click', () => setMenu(!menuOpen, false));
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      // The root also handles menu arrows; don't advance twice on the opening key.
      event.stopPropagation();
      setMenu(true, true);
    }
  });
  for (const item of items) {
    item.addEventListener('click', () => {
      const format = item.dataset.zcdtExportFormat;
      if (isExportFormat(format)) requestExport(format);
      button.focus();
    });
  }
  return () => {
    disposed = true;
    clearTimeout(lingerTimer);
    active?.abort();
    root.removeEventListener(EXPORT_REQUEST_EVENT, handle);
    root.removeEventListener(ACCOUNT_CHANGED_EVENT, onAccountChanged);
    root.removeEventListener('keydown', onKeydown);
    doc.removeEventListener('mousedown', onDocumentPointer);
    window.removeEventListener('resize', positionStatus);
    doc.removeEventListener('scroll', positionStatus, true);
    unmountUpgrade();
    menu.remove();
    row.remove();
  };
}
