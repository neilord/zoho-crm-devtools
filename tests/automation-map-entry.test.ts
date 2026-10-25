import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These tests cover the map's own lifecycle, so the Coming soon gate is off here. The gate itself
// is covered by automation-map-waitlist.test.ts.
vi.mock('../src/features/automation-map-gate', () => ({
  AUTOMATION_MAP_COMING_SOON: false,
  automationMapComingSoon: () => false,
}));

import { FREE } from '../src/billing/entitlement';
import {
  type AutomationMapEntryDependencies,
  type AutomationMapOverlayOptions,
  startAutomationMapEntryPoints,
} from '../src/content/automation-map/bootstrap';
import {
  hasAutomationMapHash,
  requestAutomationMap,
} from '../src/content/automation-map/entry/request';
import { mountUpgradeHook, UPGRADE_REQUIRED_EVENT } from '../src/content/billing/upgrade-hook';
import {
  closeWorkflowSearchOverlay,
  openWorkflowSearchOverlay,
} from '../src/content/workflows/overlay';
import {
  injectWorkflowSearchButton,
  WORKFLOW_SEARCH_BUTTON_ID,
} from '../src/content/workflows/toolbar-button';
import { renderDetail } from '../src/content/workflows/view-detail';
import { resolveCrmContext } from '../src/content/zoho/crm-context';
import { fixtureInputs } from './fixtures/automation-map';
import { FakeIndex } from './workflow-ui-fixtures';

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, '', '/crm/org123/settings/index');
  document.body.innerHTML = '';
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.useRealTimers();
});
function setup(extra: Partial<AutomationMapEntryDependencies> = {}) {
  const store = {
    subscribe: vi.fn(),
    sourceText: vi.fn(),
    retry: vi.fn(),
    refresh: vi.fn(async () => {}),
    refreshAccess: vi.fn(),
    start: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  const port = { dispose: vi.fn() } as unknown as ReturnType<
    AutomationMapEntryDependencies['createPort']
  >;
  const unmount = vi.fn();
  const mountOverlay = vi.fn((_options: AutomationMapOverlayOptions) => unmount);
  const enabled = vi.fn(async () => true);
  const createStore = vi.fn(() => store);
  const views = { board: () => () => {}, trace: () => () => {}, styles: 'canvas-css' };
  const entry = startAutomationMapEntryPoints({
    context: resolveCrmContext,
    isEnabled: enabled,
    createStore,
    createPort: () => port,
    resolveUi: async () => ({ mountOverlay, views }),
    ...extra,
  });
  cleanups.push(entry.dispose);
  return { entry, store, port, mountOverlay, unmount, enabled, createStore, views };
}
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};
describe('Automation Map entry lifecycle', () => {
  it('does not open automatically, then shares one instance across concurrent requests', async () => {
    const s = setup();
    await flush();
    expect(s.mountOverlay).not.toHaveBeenCalled();
    await Promise.all([
      s.entry.openAutomationMap({ entry: 'settings' }),
      s.entry.openAutomationMap({ entry: 'toolbar' }),
    ]);
    expect(s.mountOverlay).toHaveBeenCalledOnce();
    expect(s.createStore).toHaveBeenCalledOnce();
    expect(s.mountOverlay.mock.calls[0][0].initialState.view).toBe('fields');
    expect(s.mountOverlay.mock.calls[0][0].views).toBe(s.views);
    expect(s.store.start).toHaveBeenCalledOnce();
    await s.entry.openAutomationMap({ entry: 'toolbar' });
    expect(s.mountOverlay).toHaveBeenCalledOnce();
  });
  it('disposes all owners on close and permits a later reopen', async () => {
    const s = setup();
    await s.entry.openAutomationMap({ entry: 'toolbar' });
    s.mountOverlay.mock.calls[0][0].onClose();
    expect(s.store.dispose).toHaveBeenCalledOnce();
    expect(s.port.dispose).toHaveBeenCalledOnce();
    expect(s.unmount).toHaveBeenCalledOnce();
    await s.entry.openAutomationMap({ entry: 'settings' });
    expect(s.mountOverlay).toHaveBeenCalledTimes(2);
  });
  it('keeps the map within the org but disposes on org departure and disable', async () => {
    const s = setup();
    await s.entry.openAutomationMap({ entry: 'toolbar' });
    history.pushState({}, '', '/crm/org123/tab/Leads');
    await vi.advanceTimersByTimeAsync(250);
    expect(s.unmount).not.toHaveBeenCalled();
    history.pushState({}, '', '/crm/org456/settings/index');
    await vi.advanceTimersByTimeAsync(250);
    expect(s.store.dispose).toHaveBeenCalledOnce();
    expect(s.port.dispose).toHaveBeenCalledOnce();
    expect(s.unmount).toHaveBeenCalledOnce();
    await s.entry.openAutomationMap({ entry: 'toolbar' });
    s.enabled.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(s.unmount).toHaveBeenCalledTimes(2);
  });
  it('cancels pending UI resolution when org changes or the controller is disposed', async () => {
    let finish!: (ui: Awaited<ReturnType<AutomationMapEntryDependencies['resolveUi']>>) => void;
    const pending = new Promise<Awaited<ReturnType<AutomationMapEntryDependencies['resolveUi']>>>(
      (r) => {
        finish = r;
      },
    );
    const s = setup({ resolveUi: () => pending });
    const opened = s.entry.openAutomationMap({ entry: 'toolbar' });
    await flush();
    history.pushState({}, '', '/crm/org456/settings/index');
    finish({ mountOverlay: s.mountOverlay, views: s.views });
    await opened;
    expect(s.createStore).not.toHaveBeenCalled();
    s.entry.dispose();
    await s.entry.openAutomationMap({ entry: 'toolbar' });
    expect(s.createStore).not.toHaveBeenCalled();
  });
  it('does not allocate after disposal during the final enabled check', async () => {
    let finish!: (value: boolean) => void;
    const enabled = vi.fn().mockResolvedValue(true);
    const s = setup({ isEnabled: enabled });
    await flush();
    enabled.mockResolvedValueOnce(true).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const opening = s.entry.openAutomationMap({ entry: 'toolbar' });
    await flush();
    s.entry.dispose();
    finish(true);
    await opening;
    expect(s.createStore).not.toHaveBeenCalled();
  });
  it('disposes a synchronous close during mount without starting the store', async () => {
    const unmount = vi.fn();
    const s = setup({
      resolveUi: async () => ({
        views: { board: () => () => {}, trace: () => () => {}, styles: '' },
        mountOverlay: (options) => {
          options.onClose();
          return unmount;
        },
      }),
    });
    await s.entry.openAutomationMap({ entry: 'toolbar' });
    expect(s.store.dispose).toHaveBeenCalledOnce();
    expect(s.port.dispose).toHaveBeenCalledOnce();
    expect(unmount).toHaveBeenCalledOnce();
    expect(s.store.start).not.toHaveBeenCalled();
  });
  it('renders Settings entry for every account, repairs SPA remounts and removes on departure', async () => {
    const fragment =
      '<div class="crmSetupHomeGroupCards" aria-label="Developer Hub"><div class="listItems" id="devSpace_functions"><a class="setupMenulink">Functions</a></div></div>';
    document.body.innerHTML = fragment;
    const s = setup();
    await flush();
    expect(document.querySelectorAll('[data-zcdt-map-entry]')).toHaveLength(1);
    document.body.innerHTML = fragment;
    await flush();
    expect(document.querySelectorAll('[data-zcdt-map-entry]')).toHaveLength(1);
    document.querySelector<HTMLElement>('[data-zcdt-map-entry] a')?.click();
    await flush();
    expect(s.mountOverlay.mock.calls[0][0].initialState.view).toBe('fields');
    history.pushState({}, '', '/crm/org123/tab/Leads');
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('[data-zcdt-map-entry]')).toBeNull();
  });
  it('places the toolbar action after Search All Workflows and opens Board', async () => {
    history.replaceState({}, '', '/crm/org123/settings/workflow-rules');
    document.body.innerHTML = '<div><input id="search"><button>Create rule</button></div>';
    const anchor = document.getElementById('search') as HTMLElement;
    injectWorkflowSearchButton(anchor, () => {});
    const s = setup();
    await flush();
    const button = document.getElementById(WORKFLOW_SEARCH_BUTTON_ID)
      ?.nextElementSibling as HTMLButtonElement;
    expect(button.textContent).toBe('Automation MapBeta');
    expect(button.getAttribute('aria-label')).toBe('Automation Map (Beta)');
    button.click();
    await flush();
    expect(s.mountOverlay.mock.calls[0][0].initialState.view).toBe('board');
  });
  it('passes Show on map rule and module into Board selection and inspector', async () => {
    const rule = fixtureInputs().rules[0];
    const s = setup();
    const detail = renderDetail({
      rule,
      result: undefined,
      query: '',
      failures: [],
      expandedCode: new Set(),
      openingFunction: null,
      handlers: { onOpenRule() {}, onOpenFunction() {}, onToggleCode() {}, onRetry() {} },
    });
    document.body.append(detail);
    const button = detail.querySelector<HTMLButtonElement>('[data-act="show-on-map"]');
    expect(button?.className).toBe('fs-edit-button sec2');
    button?.click();
    await flush();
    expect(s.mountOverlay.mock.calls[0][0].initialState).toMatchObject({
      view: 'board',
      selectedId: `rule:${rule.id}`,
      focusModuleApiName: rule.module.apiName,
      inspectorOpen: true,
    });
  });
  it('passes an opaque zcdt-map hash through once and handles later hashchange', async () => {
    const initialHash = '#zcdt-map=v1;view=trace;sel=rule:123';
    history.replaceState({}, '', initialHash);
    const s = setup();
    await flush();
    expect(s.mountOverlay.mock.calls[0][0].initialHash).toBe(initialHash);
    await vi.advanceTimersByTimeAsync(500);
    expect(s.mountOverlay).toHaveBeenCalledOnce();
    s.mountOverlay.mock.calls[0][0].onClose();
    history.replaceState({}, '', '#zcdt-map=v1;view=fields');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flush();
    expect(s.mountOverlay).toHaveBeenCalledTimes(2);
  });
  it('does not reopen from the map hash its own close leaves behind', async () => {
    const s = setup();
    await s.entry.openAutomationMap({ entry: 'toolbar' });
    // The overlay writes its hash while open; a UI close pops that history entry a moment later.
    history.replaceState({}, '', '#zcdt-map=v1;view=list');
    await vi.advanceTimersByTimeAsync(300);
    history.replaceState({}, '', '#zcdt-map=v1;view=list;sel=rule:123');
    s.mountOverlay.mock.calls[0][0].onClose();
    await vi.advanceTimersByTimeAsync(600);
    expect(s.mountOverlay).toHaveBeenCalledOnce();
    history.replaceState({}, '', '/crm/org123/settings/index');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.advanceTimersByTimeAsync(300);
    expect(s.mountOverlay).toHaveBeenCalledOnce();
    // Forward onto the map entry is a link again.
    history.replaceState({}, '', '#zcdt-map=v1;view=list');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flush();
    expect(s.mountOverlay).toHaveBeenCalledTimes(2);
  });
  it('stays inert when disabled and rejects requests without CRM context', async () => {
    const s = setup({ isEnabled: async () => false });
    requestAutomationMap({ entry: 'toolbar' });
    await flush();
    expect(s.createStore).not.toHaveBeenCalled();
    const noContext = setup({ context: () => null });
    await noContext.entry.openAutomationMap({ entry: 'toolbar' });
    expect(noContext.createStore).not.toHaveBeenCalled();
  });
  it.each(['#zcdt-map=v1', '#zcdt-map=v1;view=list'])('recognizes map key %s', (hash) =>
    expect(hasAutomationMapHash(hash)).toBe(true));
  it.each([
    '#not-zcdt-map=v1',
    '#q=zcdt-map=v1',
    '#workflow-function=123',
    '',
  ])('ignores unrelated hash %s', (hash) => expect(hasAutomationMapHash(hash)).toBe(false));
});

it('dismisses an existing Upgrade dialog before mounting the map', async () => {
  const stop = mountUpgradeHook(document.createElement('div'), {
    send: vi.fn().mockResolvedValue({ signedIn: false, entitlement: FREE }),
  });
  cleanups.push(stop);
  document.dispatchEvent(
    new CustomEvent(UPGRADE_REQUIRED_EVENT, {
      detail: { featureId: 'exportFunctions', reason: 'paid-required' },
    }),
  );
  await flush();
  const modal = document.querySelector<HTMLElement>('[data-zcdt-upgrade-modal]');
  expect(modal?.hidden).toBe(false);
  const s = setup();
  s.mountOverlay.mockImplementation(() => {
    expect(modal?.hidden).toBe(true);
    return s.unmount;
  });
  await s.entry.openAutomationMap({ entry: 'settings' });
  expect(s.mountOverlay).toHaveBeenCalledOnce();
});

it('review 3 closes the workflow dashboard before mounting a map that can show Upgrade', async () => {
  const invoker = document.createElement('button');
  document.body.append(invoker);
  cleanups.push(closeWorkflowSearchOverlay);
  await openWorkflowSearchOverlay(
    { origin: location.origin, orgId: '123', csrfHeader: '' },
    invoker,
    {
      requestAccess: async () => true,
      createIndex: () => new FakeIndex(),
      isCurrent: () => true,
    },
  );
  expect(document.getElementById('zcdt-workflow-search-overlay')).not.toBeNull();
  const s = setup();
  s.mountOverlay.mockImplementation(() => {
    expect(document.getElementById('zcdt-workflow-search-overlay')).toBeNull();
    return s.unmount;
  });
  await s.entry.openAutomationMap({
    entry: 'rule',
    focus: { ruleId: '123', moduleApiName: 'Orchards' },
  });
  expect(s.mountOverlay).toHaveBeenCalledOnce();
});

it('review 5 leaves decoded hash view and selection intact through the entry controller', async () => {
  const s = setup();
  await s.entry.openAutomationMap({
    entry: 'hash',
    initialHash: '#zcdt-map=v1;view=list;sel=rule:123',
  });
  expect(s.mountOverlay.mock.calls[0][0].initialState).toEqual({});
  expect(s.mountOverlay.mock.calls[0][0].initialHash).toBe('#zcdt-map=v1;view=list;sel=rule:123');
});

it('review 5 recognizes exactly the canonical hash format the UI codec decodes', () => {
  expect(hasAutomationMapHash('#zcdt-map=v1;view=list')).toBe(true);
  expect(hasAutomationMapHash('#native=1&zcdt-map=v1;view=list')).toBe(false);
});
