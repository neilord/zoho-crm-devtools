import { afterEach, describe, expect, it } from 'vitest';
import {
  type KeyContext,
  type KeyInput,
  resolveKey,
} from '../src/content/automation-map/ui/keyboard';
import { key, type MountedMap, mountMap } from './automation-map-ui-helpers';

const ctx = (patch: Partial<KeyContext> = {}): KeyContext => ({
  typing: false,
  canvasFocused: false,
  searchFocused: false,
  view: 'board',
  hasSelection: true,
  selectedIsField: false,
  ...patch,
});
const k = (keyName: string, patch: Partial<KeyInput> = {}): KeyInput => ({
  key: keyName,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...patch,
});

describe('keyboard map (resolver)', () => {
  it('maps / to search and ? to the shortcut sheet, matching on key not code', () => {
    expect(resolveKey(k('/'), ctx())).toEqual({ type: 'focus-search' });
    expect(resolveKey(k('?', { shiftKey: true }), ctx())).toEqual({ type: 'help' });
  });

  it('maps F, B and L to the three views in either case', () => {
    expect(resolveKey(k('f'), ctx())).toEqual({ type: 'view', view: 'fields' });
    expect(resolveKey(k('B'), ctx())).toEqual({ type: 'view', view: 'board' });
    expect(resolveKey(k('l'), ctx())).toEqual({ type: 'view', view: 'list' });
  });

  it('maps T to a trace only with a selection, and W only for a selected field', () => {
    expect(resolveKey(k('t'), ctx())).toEqual({ type: 'trace' });
    expect(resolveKey(k('t'), ctx({ hasSelection: false }))).toBeNull();
    expect(resolveKey(k('w'), ctx())).toBeNull();
    expect(resolveKey(k('w'), ctx({ selectedIsField: true }))).toEqual({ type: 'writers' });
  });

  it('always resolves Escape, even while typing', () => {
    expect(resolveKey(k('Escape'), ctx({ typing: true }))).toEqual({ type: 'escape' });
  });

  it('ignores letters and slashes while typing, and any modified shortcut', () => {
    for (const keyName of ['/', 'f', 'b', 'l', 't', '?'])
      expect(resolveKey(k(keyName), ctx({ typing: true }))).toBeNull();
    expect(resolveKey(k('f', { ctrlKey: true }), ctx())).toBeNull();
    expect(resolveKey(k('b', { metaKey: true }), ctx())).toBeNull();
    expect(resolveKey(k('l', { altKey: true }), ctx())).toBeNull();
  });

  it('steps through search matches with Enter and Shift+Enter in the search box only', () => {
    expect(resolveKey(k('Enter'), ctx({ typing: true, searchFocused: true }))).toEqual({
      type: 'next-match',
      dir: 1,
    });
    expect(
      resolveKey(k('Enter', { shiftKey: true }), ctx({ typing: true, searchFocused: true })),
    ).toEqual({
      type: 'next-match',
      dir: -1,
    });
    expect(resolveKey(k('Enter'), ctx())).toBeNull();
  });

  it('adjusts trace depth with [ ] { } outside the canvas, and leaves them to the canvas inside it', () => {
    const trace = ctx({ view: 'trace' });
    expect(resolveKey(k('['), trace)).toEqual({
      type: 'trace-depth',
      which: 'downstream',
      delta: -1,
    });
    expect(resolveKey(k(']'), trace)).toEqual({
      type: 'trace-depth',
      which: 'downstream',
      delta: 1,
    });
    expect(resolveKey(k('{', { shiftKey: true }), trace)).toEqual({
      type: 'trace-depth',
      which: 'upstream',
      delta: -1,
    });
    expect(resolveKey(k('}', { shiftKey: true }), trace)).toEqual({
      type: 'trace-depth',
      which: 'upstream',
      delta: 1,
    });
    expect(resolveKey(k(']'), ctx({ view: 'trace', canvasFocused: true }))).toBeNull();
    expect(resolveKey(k(']'), ctx({ view: 'board' }))).toBeNull();
  });

  it('leaves zoom and arrow keys to the canvas', () => {
    for (const keyName of [
      '+',
      '=',
      '-',
      '0',
      '1',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
    ])
      expect(resolveKey(k(keyName), ctx())).toBeNull();
  });

  it('ignores keys during IME composition', () => {
    expect(resolveKey(k('f', { isComposing: true }), ctx())).toBeNull();
  });
});

describe('keyboard map (overlay)', () => {
  let map: MountedMap | null = null;
  afterEach(() => {
    map?.handle.close();
    map = null;
    document.body.replaceChildren();
    history.replaceState(null, '', location.pathname);
  });

  it('switches views with F, B and L and disposes the canvas it leaves', () => {
    map = mountMap({ initialState: { view: 'board' } });
    const panel = map.q('.am-panel') as HTMLElement;
    expect(map.recorded.mounts.board).toBe(1);
    key(panel, 'l');
    expect(map.recorded.store().get().view).toBe('list');
    expect(map.recorded.disposed.board).toBe(1);
    expect(map.q('#am-list')?.hasAttribute('hidden')).toBe(false);
    key(panel, 'f');
    expect(map.recorded.store().get().view).toBe('fields');
    key(panel, 'b');
    expect(map.recorded.mounts.board).toBe(2);
  });

  it('focuses the search box on / and does not type the slash into it', () => {
    map = mountMap();
    const panel = map.q('.am-panel') as HTMLElement;
    panel.focus();
    const event = key(panel, '/');
    expect(event.defaultPrevented).toBe(true);
    expect(map.shadow.activeElement).toBe(map.q('.am-search input'));
  });

  it('opens the shortcut sheet on ? and traces the selection on T', () => {
    map = mountMap({
      initialState: { view: 'board', selectedId: 'rule:rule-003', inspectorOpen: true },
    });
    const panel = map.q('.am-panel') as HTMLElement;
    key(panel, '?', { shiftKey: true });
    expect(map.q('.am-keys')).not.toBeNull();
    key(panel, 'Escape');
    key(panel, 't');
    expect(map.recorded.store().get()).toMatchObject({
      view: 'trace',
      traceRootId: 'rule:rule-003',
    });
    expect(map.recorded.store().get().traceDepth).toEqual({ upstream: 2, downstream: 3 });
  });

  it('traces a field with the field depths and opens its lens on W', () => {
    map = mountMap({
      initialState: { view: 'board', selectedId: 'field:Deals.Stage', inspectorOpen: true },
    });
    const panel = map.q('.am-panel') as HTMLElement;
    key(panel, 'w');
    expect(map.recorded.store().get().view).toBe('fields');
    expect(map.recorded.store().get().field).toEqual({
      moduleApiName: 'Deals',
      fieldApiName: 'Stage',
    });
  });

  it('adjusts trace depth with the bracket keys', () => {
    map = mountMap({ initialState: { view: 'trace', traceRootId: 'rule:rule-003' } });
    const panel = map.q('.am-panel') as HTMLElement;
    key(panel, ']');
    expect(map.recorded.store().get().traceDepth.downstream).toBe(4);
    key(panel, '{', { shiftKey: true });
    expect(map.recorded.store().get().traceDepth.upstream).toBe(1);
  });

  it('does not act on shortcuts typed into the search box', () => {
    map = mountMap({ initialState: { view: 'board' } });
    const input = map.q('.am-search input') as HTMLInputElement;
    input.focus();
    key(input, 'l');
    expect(map.recorded.store().get().view).toBe('board');
  });

  it('leaves bracket keys to a focused canvas', () => {
    map = mountMap({ initialState: { view: 'trace', traceRootId: 'rule:rule-003' } });
    const canvas = map.q('[data-canvas="trace"]') as HTMLElement;
    canvas.focus();
    key(canvas, ']');
    expect(map.recorded.store().get().traceDepth.downstream).toBe(3);
  });
});
