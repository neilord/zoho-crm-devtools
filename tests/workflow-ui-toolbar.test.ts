import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapWorkflowSearch } from '../src/content/workflows/bootstrap';
import {
  injectWorkflowSearchButton,
  removeWorkflowSearchButton,
  WORKFLOW_SEARCH_BUTTON_ID,
  WORKFLOW_SEARCH_BUTTON_STYLE_ID,
} from '../src/content/workflows/toolbar-button';

const TOOLBAR =
  '<div id="bar" class="dF"><lyte-input id="wfSearchWithName1" data-zcqa="wfSearchWithName1"></lyte-input><div class="dF mlAuto"><button id="create">Create Rule</button></div></div>';
const buttons = () => document.querySelectorAll(`#${WORKFLOW_SEARCH_BUTTON_ID}`);
const anchor = () => document.getElementById('wfSearchWithName1') as HTMLElement;

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = TOOLBAR;
  history.pushState({}, '', '/crm/org999001/settings/workflow-rules');
});
const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  removeWorkflowSearchButton();
});

describe('workflow toolbar button', () => {
  it('sits directly after the native search, neutral and without a plan badge', () => {
    const button = injectWorkflowSearchButton(anchor(), () => {});
    expect(button?.id).toBe(WORKFLOW_SEARCH_BUTTON_ID);
    expect(anchor().nextElementSibling).toBe(button);
    expect(button?.textContent).toBe('Search All Workflows');
    expect(button?.textContent).not.toMatch(/pro|paid|plus|max/i);
    expect(button?.getAttribute('aria-label')).toBe('Search All Workflows');
    expect(document.getElementById(WORKFLOW_SEARCH_BUTTON_STYLE_ID)?.textContent).toContain(
      ':focus-visible',
    );
  });

  it('is idempotent across repeated calls and routes clicks to the latest handler', () => {
    const first = vi.fn();
    const second = vi.fn();
    injectWorkflowSearchButton(anchor(), first);
    injectWorkflowSearchButton(anchor(), second);
    injectWorkflowSearchButton(anchor(), second);
    expect(buttons()).toHaveLength(1);
    expect(document.querySelectorAll(`#${WORKFLOW_SEARCH_BUTTON_STYLE_ID}`)).toHaveLength(1);
    (buttons()[0] as HTMLButtonElement).click();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0][0]).toBe(buttons()[0]);
  });

  it('re-seats itself when Zoho remounts the toolbar with a new anchor', () => {
    injectWorkflowSearchButton(anchor(), () => {});
    document.body.innerHTML = TOOLBAR;
    injectWorkflowSearchButton(anchor(), () => {});
    expect(buttons()).toHaveLength(1);
    expect(anchor().nextElementSibling?.id).toBe(WORKFLOW_SEARCH_BUTTON_ID);
  });

  it('does nothing for an anchor with no parent', () => {
    expect(injectWorkflowSearchButton(document.createElement('div'), () => {})).toBeNull();
  });
});

describe('workflow bootstrap', () => {
  function setup(enabled = true) {
    let report: (a: HTMLElement | null) => void = () => {};
    const stop = vi.fn();
    const open = vi.fn(async () => {});
    const observeAnchor = vi.fn((cb: (a: HTMLElement | null) => void) => {
      report = cb;
      return stop;
    });
    return {
      open,
      stop,
      report: (a: HTMLElement | null) => report(a),
      start: async () => {
        const dispose = await bootstrapWorkflowSearch({
          isEnabled: async () => enabled,
          observeAnchor,
          open,
        });
        disposers.push(dispose);
        return dispose;
      },
    };
  }

  it('stays inert when the extension is disabled', async () => {
    const s = setup(false);
    await s.start();
    expect(s.stop).not.toHaveBeenCalled();
    expect(buttons()).toHaveLength(0);
  });

  it('inserts one button per anchor report and opens the dashboard with the CRM context', async () => {
    const s = setup();
    const dispose = await s.start();
    s.report(anchor());
    s.report(anchor());
    expect(buttons()).toHaveLength(1);
    (buttons()[0] as HTMLButtonElement).click();
    expect(s.open).toHaveBeenCalledTimes(1);
    const [context, invoker] = s.open.mock.calls[0] as unknown as [Record<string, string>, Element];
    expect(context.orgId).toBe('999001');
    expect(invoker).toBe(buttons()[0]);
    dispose();
    expect(buttons()).toHaveLength(0);
    expect(s.stop).toHaveBeenCalled();
  });

  it('survives an SPA remount: old button goes with the old toolbar, new anchor gets exactly one', async () => {
    const s = setup();
    await s.start();
    s.report(anchor());
    document.body.innerHTML = '';
    s.report(null);
    expect(buttons()).toHaveLength(0);
    document.body.innerHTML = TOOLBAR;
    s.report(anchor());
    expect(buttons()).toHaveLength(1);
  });

  it('restores the button if Zoho re-renders the toolbar around the same anchor', async () => {
    const s = setup();
    await s.start();
    s.report(anchor());
    buttons()[0].remove();
    await Promise.resolve();
    // MutationObserver callbacks are microtask-queued in jsdom.
    await new Promise((r) => setTimeout(r, 0));
    expect(buttons()).toHaveLength(1);
  });
});
