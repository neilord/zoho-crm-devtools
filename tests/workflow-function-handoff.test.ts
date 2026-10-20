import { afterEach, expect, it, vi } from 'vitest';
import script from '../public/zcdt-function-edit-bridge.js?raw';
import {
  consumeWorkflowFunctionHandoff,
  openWorkflowFunctionTab,
  startWorkflowFunctionHandoff,
} from '../src/content/workflows/function-handoff';
import { openIsolatedTab } from '../src/shared/browser';
import { context } from './fixtures/workflows';

vi.mock('../src/shared/browser', async (original) => ({
  ...(await original<typeof import('../src/shared/browser')>()),
  openIsolatedTab: vi.fn(() => true),
}));
const current = () => ({ ...context, origin: location.origin });
const markerURL = () => {
  openWorkflowFunctionTab(current(), {
    id: '501',
    api_name: 'wf_synthetic',
    display_name: '',
    category: '',
  });
  return vi.mocked(openIsolatedTab).mock.calls.at(-1)?.[0] as string;
};
afterEach(() => {
  history.replaceState(null, '', '/');
  sessionStorage.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
it('opens an isolated Functions URL without touching the workflow route or fetching source', () => {
  history.replaceState(null, '', '/crm/org999001/settings/workflow-rules');
  const original = location.href;
  const url = markerURL();
  expect(url).toContain('/settings/functions/myFunctions#zcdt-workflow-function=');
  expect(location.href).toBe(original);
  expect(url).not.toContain('sourceText');
});
it.each(['myFunctions', ''])('consumes once on Functions/%s and rejects replay', (suffix) => {
  const url = markerURL().replace('/myFunctions#', `${suffix ? '/myFunctions' : ''}#`);
  history.replaceState(null, '', url);
  expect(consumeWorkflowFunctionHandoff(current())).toMatchObject({
    id: '501',
    apiName: 'wf_synthetic',
  });
  expect(location.hash).toBe('');
  expect(consumeWorkflowFunctionHandoff(current())).toBeNull();
  history.replaceState(null, '', url);
  expect(() => consumeWorkflowFunctionHandoff(current())).toThrow('expired');
});
it.each(['expired', 'org', 'route', 'identity'])('rejects a %s marker', (kind) => {
  const url = new URL(markerURL());
  const marker = JSON.parse(decodeURIComponent(url.hash.split('=')[1]));
  if (kind === 'expired') marker.expires = Date.now() - 1;
  if (kind === 'org') marker.orgId = '999002';
  if (kind === 'identity') marker.id = '../501';
  if (kind === 'route') url.pathname = '/crm/org999001/settings/workflow-rules';
  url.hash = `zcdt-workflow-function=${encodeURIComponent(JSON.stringify(marker))}`;
  history.replaceState(null, '', url);
  expect(() => consumeWorkflowFunctionHandoff(current())).toThrow();
});
it('shows a persistent visible error for a malformed handoff', async () => {
  history.replaceState(
    null,
    '',
    '/crm/org999001/settings/functions/myFunctions#zcdt-workflow-function=bad',
  );
  startWorkflowFunctionHandoff(current());
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not open'),
  );
});
it('workflow bridge never transitions the SPA, acknowledges errors and waits for the module', async () => {
  vi.useFakeTimers();
  const render = vi.fn(),
    transition = vi.fn(),
    leave = vi.fn();
  const win = window as unknown as Record<string, unknown>;
  win.Lyte = { Router: { transitionTo: transition } };
  win.customFunctionsObj = undefined;
  const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  // Run the actual shipped bridge against synthetic page globals.
  const run = new Function('window', 'document', script);
  run(window, document);
  const send = (id: string) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: location.origin,
        data: {
          source: 'zcdt-workflow-function',
          action: 'editInCrm',
          requestId: id,
          detail: { id: '501' },
        },
      }),
    );
  try {
    history.replaceState(null, '', '/crm/org999001/settings/functions/myFunctions');
    send('one');
    expect(render).not.toHaveBeenCalled();
    win.customFunctionsObj = { renderEditorView: render, leavePage: leave };
    await vi.advanceTimersByTimeAsync(200);
    expect(render).not.toHaveBeenCalled();
    history.replaceState(null, '', '/crm/org999001/settings/functions');
    document.body.innerHTML = '<input data-zcqa="fxn_lv_search">';
    await vi.advanceTimersByTimeAsync(200);
    expect(render).toHaveBeenCalledWith('{"id":"501"}', '', '', 'edit');
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ ok: true }), location.origin);
    render.mockImplementation(() => {
      throw new Error('not ready');
    });
    send('two');
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }), location.origin);
    history.replaceState(null, '', '/crm/org999001/settings/workflow-rules');
    send('three');
    expect(render).toHaveBeenCalledTimes(2);
    expect(transition).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    history.replaceState(null, '', '/crm/org999001/settings/functions');
    document.body.replaceChildren();
    send('timeout');
    post.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: 'timeout', ok: false }),
      location.origin,
    );
  } finally {
    delete win.Lyte;
    delete win.customFunctionsObj;
    vi.useRealTimers();
  }
});
