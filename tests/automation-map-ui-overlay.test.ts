import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_ID, mountAutomationMap } from '../src/content/automation-map/ui/overlay';
import { click, flush, key, type MountedMap, mountMap } from './automation-map-ui-helpers';
import { createFixturePort } from './fixtures/automation-map-port';

let map: MountedMap | null = null;
afterEach(() => {
  map?.handle.close();
  map = null;
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  history.replaceState(null, '', location.pathname);
});

describe('overlay shell', () => {
  it('mounts a body-level host with a shadow root, dialog semantics and the three views', () => {
    map = mountMap();
    expect(document.getElementById(HOST_ID)).toBe(map.host);
    const dialog = map.q('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('am-title');
    expect(map.q('#am-title')?.textContent).toContain('Automation Map');
    expect(map.qa('.am-seg button').map((b) => b.dataset.view)).toEqual([
      'fields',
      'board',
      'list',
    ]);
    expect(map.q('.am-seg [data-view="fields"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('locks page scroll while open and restores it on close', () => {
    document.documentElement.style.overflow = 'scroll';
    map = mountMap();
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    map.handle.close();
    expect(document.documentElement.style.overflow).toBe('scroll');
    expect(document.body.style.overflow).toBe('');
  });

  it('restores focus to the invoker and reports onClose exactly once', () => {
    const invoker = document.createElement('button');
    document.body.append(invoker);
    invoker.focus();
    map = mountMap();
    expect(document.activeElement).toBe(map.host);
    map.handle.close();
    map.handle.close();
    expect(document.activeElement).toBe(invoker);
    expect(map.closed.count).toBe(1);
    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it('closes from the close button', () => {
    map = mountMap();
    click(map.q('[data-act="close"]'));
    expect(map.closed.count).toBe(1);
  });

  it('closes on a mousedown on the scrim but not inside the panel', () => {
    map = mountMap();
    const panel = map.q('.am-panel') as HTMLElement;
    panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(map.closed.count).toBe(0);
    (map.q('.am-overlay') as HTMLElement).dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    );
    expect(map.closed.count).toBe(1);
  });

  it('replaces an earlier overlay instead of stacking two', () => {
    map = mountMap();
    const first = map;
    const second = mountMap();
    expect(first.closed.count).toBe(1);
    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1);
    map = second;
  });

  it('keeps keystrokes inside the overlay from reaching the page', () => {
    map = mountMap();
    const page = vi.fn();
    document.addEventListener('keydown', page);
    const input = map.q('.am-search input') as HTMLInputElement;
    input.focus();
    key(input, 'a');
    key(input, '/');
    document.removeEventListener('keydown', page);
    expect(page).not.toHaveBeenCalled();
  });
});

describe('focus trap', () => {
  it('cycles Tab from the last focusable element to the first and back', () => {
    map = mountMap();
    const items = [
      ...map.shadow.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((n) => !n.closest('[hidden]'));
    const first = items[0];
    const last = items[items.length - 1];
    last.focus();
    const forward = key(last, 'Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(map.shadow.activeElement).toBe(first);
    const back = key(first, 'Tab', { shiftKey: true });
    expect(back.defaultPrevented).toBe(true);
    expect(map.shadow.activeElement).toBe(last);
  });

  it('leaves Tab alone in the middle of the dialog', () => {
    map = mountMap();
    const input = map.q('.am-search input') as HTMLInputElement;
    input.focus();
    expect(key(input, 'Tab').defaultPrevented).toBe(false);
  });
});

describe('escape ladder', () => {
  it('closes the first open item in order: shortcuts, popover, search, selection, then the map', async () => {
    map = mountMap({
      initialState: {
        view: 'list',
        query: 'Stage',
        selectedId: 'rule:rule-003',
        inspectorOpen: true,
      },
    });
    const search = map.q('.am-search input') as HTMLInputElement;
    expect(search.value).toBe('Stage');
    // shortcuts sheet
    click(map.q('[aria-label="Keyboard shortcuts"]'));
    expect(map.q('.am-keys')).not.toBeNull();
    key(map.q('.am-keys [data-fk="keys-close"]') as HTMLElement, 'Escape');
    expect(map.q('.am-keys')).toBeNull();
    // coverage popover
    click(map.q('.wf-index .wf-pill'));
    expect(map.q('.wf-pop')).not.toBeNull();
    key(map.shadow.activeElement ?? search, 'Escape');
    expect(map.q('.wf-pop')).toBeNull();
    // search text
    search.focus();
    key(search, 'Escape');
    expect(search.value).toBe('');
    expect(map.closed.count).toBe(0);
    // selection / inspector
    expect(map.q('.am-insp.open')).not.toBeNull();
    key(map.q('.am-panel') as HTMLElement, 'Escape');
    expect(map.q('.am-insp.open')).toBeNull();
    expect(map.closed.count).toBe(0);
    // map
    key(map.q('.am-panel') as HTMLElement, 'Escape');
    expect(map.closed.count).toBe(1);
    await flush();
  });

  it('steps back out of a field lens before closing', () => {
    map = mountMap({ initialState: { field: { moduleApiName: 'Deals', fieldApiName: 'Stage' } } });
    expect(map.q('.lens-grid')).not.toBeNull();
    key(map.q('.am-panel') as HTMLElement, 'Escape');
    expect(map.q('.lens-start')).not.toBeNull();
    expect(map.closed.count).toBe(0);
  });

  it('leaves a trace for the board before clearing the selection', () => {
    map = mountMap({
      initialState: {
        view: 'trace',
        traceRootId: 'rule:rule-003',
        selectedId: 'rule:rule-003',
        inspectorOpen: true,
      },
    });
    expect(map.q('[data-canvas="trace"]')).not.toBeNull();
    key(map.q('.am-panel') as HTMLElement, 'Escape');
    expect(map.q('[data-canvas="board"]')).not.toBeNull();
    expect(map.recorded.store().get().selectedId).toBe('rule:rule-003');
  });

  it('does not act on an Escape the canvas already handled', () => {
    map = mountMap({ initialState: { view: 'board' } });
    const canvas = map.q('[data-canvas="board"]') as HTMLElement;
    canvas.addEventListener('keydown', (e) => e.preventDefault());
    key(canvas, 'Escape');
    expect(map.closed.count).toBe(0);
  });
});

describe('resilience', () => {
  it('keeps the shell alive and says "no matches" when the port search throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fixture = createFixturePort('full');
    map = mountMap({
      port: {
        ...fixture.port,
        search: () => {
          throw new Error('index exploded');
        },
      },
      initialState: { view: 'list', query: 'stage' },
    });
    expect(map.q('.rail-results h4')?.textContent).toContain('Results for "stage"');
    expect(map.q('.lt-empty h3')?.textContent).toContain('No matches');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('shows an inert placeholder when a canvas view throws while mounting', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handle = mountAutomationMap({
      port: createFixturePort('full').port,
      views: {
        board: () => {
          throw new Error('canvas exploded');
        },
        trace: () => () => {},
        styles: '',
      },
      initialState: { view: 'board' },
    });
    const root = (document.getElementById(HOST_ID) as HTMLElement).shadowRoot as ShadowRoot;
    expect(root.querySelector('#am-board')?.textContent).toContain('This view could not load');
    expect(root.querySelector('.am-seg')).not.toBeNull();
    handle.close();
    error.mockRestore();
  });

  it('survives a field lens that throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fixture = createFixturePort('full');
    map = mountMap({
      port: {
        ...fixture.port,
        fieldLens: () => {
          throw new Error('lens exploded');
        },
      },
      initialState: { field: { moduleApiName: 'Deals', fieldApiName: 'Stage' } },
    });
    expect(map.q('.lens-foot')).not.toBeNull();
    error.mockRestore();
  });
});
