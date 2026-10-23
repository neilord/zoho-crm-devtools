import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeDelugeEffects } from '../src/content/automation-map/analyzer';
import type { AutomationGraphInputs } from '../src/content/automation-map/types';
import {
  click,
  key,
  type MountedMap,
  mountMap,
  mountWithStore,
  portForInputs,
} from './automation-map-ui-helpers';
import { fixtureInputs } from './fixtures/automation-map';

const HOSTILE = '<img src=x onerror=alert(1)>';

/** The fixture with hostile text planted in every CRM-controlled string the UI renders. */
function hostileInputs(): AutomationGraphInputs {
  const inputs = fixtureInputs();
  const source = `// ${HOSTILE}\nzoho.crm.updateRecord("Deals",recordId,{"Stage":"${HOSTILE}"});`;
  const catalogue = inputs.functions.map((f) => ({
    id: f.delugeId,
    apiName: f.summary.api_name ?? f.delugeId,
    category: 'standalone',
  }));
  return {
    ...inputs,
    modules: inputs.modules.map((m, i) =>
      i === 3 ? { ...m, label: `Deals ${HOSTILE}`, pluralLabel: `Deals ${HOSTILE}` } : m,
    ),
    fields: new Map(
      [...inputs.fields].map(([m, fields]) => [
        m,
        fields.map((f) => (f.apiName === 'Stage' ? { ...f, label: `Stage ${HOSTILE}` } : f)),
      ]),
    ),
    rules: inputs.rules.map((r, i) =>
      i === 3
        ? {
            ...r,
            name: `Rule ${HOSTILE}`,
            conditions: r.conditions.map((c) => ({
              ...c,
              instantActions: c.instantActions.map((a) =>
                a.kind === 'webhook'
                  ? { ...a, url: `https://${HOSTILE}.example.invalid/x` }
                  : a.kind === 'emailNotification' && a.template
                    ? {
                        ...a,
                        template: {
                          ...a.template,
                          name: HOSTILE,
                          subject: HOSTILE,
                          bodyText: HOSTILE,
                        },
                      }
                    : a,
              ),
            })),
          }
        : r.id === 'rule-000'
          ? {
              ...r,
              conditions: r.conditions.map((c) => ({
                ...c,
                instantActions: c.instantActions.map((a) =>
                  a.kind === 'emailNotification' && a.template
                    ? {
                        ...a,
                        template: {
                          ...a.template,
                          subject: HOSTILE,
                          name: HOSTILE,
                          bodyText: HOSTILE,
                        },
                      }
                    : a.kind === 'webhook'
                      ? { ...a, url: `https://${HOSTILE}.example.invalid/x` }
                      : a,
                ),
              })),
            }
          : r,
    ),
    functions: inputs.functions.map((f) =>
      f.delugeId === 'f-003'
        ? {
            ...f,
            summary: { ...f.summary, display_name: `Fn ${HOSTILE}` },
            sourceText: source,
            effects: analyzeDelugeEffects(source, {
              functionId: 'f-003',
              parameters: ['recordId'],
              catalogue,
            }),
          }
        : f,
    ),
    buttons: inputs.buttons.map((b, i) => (i === 0 ? { ...b, name: `Button ${HOSTILE}` } : b)),
    schedules: inputs.schedules.map((s, i) =>
      i === 0 ? { ...s, name: HOSTILE, recurrenceLabel: HOSTILE } : s,
    ),
  };
}

describe('CRM text never becomes markup', () => {
  let map: MountedMap | null = null;
  const writers = {
    innerHTML: vi.fn(),
    outerHTML: vi.fn(),
    insertAdjacentHTML: vi.fn(),
    write: vi.fn(),
  };
  const restore: Array<() => void> = [];

  afterEach(() => {
    map?.handle.close();
    map = null;
    document.body.replaceChildren();
    for (const undo of restore.splice(0)) undo();
    for (const spy of Object.values(writers)) spy.mockClear();
    history.replaceState(null, '', location.pathname);
  });

  function spyOnHtmlSinks() {
    const targets: Array<[object, 'innerHTML' | 'outerHTML']> = [
      [Element.prototype, 'innerHTML'],
      [Element.prototype, 'outerHTML'],
      // jsdom defines the shadow root's own innerHTML separately from Element's.
      [ShadowRoot.prototype, 'innerHTML'],
    ];
    for (const [proto, name] of targets) {
      const original = Object.getOwnPropertyDescriptor(proto, name) as PropertyDescriptor;
      Object.defineProperty(proto, name, {
        ...original,
        set(this: Element, value: string) {
          writers[name](value);
          original.set?.call(this, value);
        },
      });
      restore.push(() => Object.defineProperty(proto, name, original));
    }
    const insert = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (
      this: Element,
      ...args: Parameters<typeof insert>
    ) {
      writers.insertAdjacentHTML(...args);
      return insert.apply(this, args);
    };
    restore.push(() => {
      Element.prototype.insertAdjacentHTML = insert;
    });
    const write = document.write;
    document.write = (...args: string[]) => writers.write(...args);
    restore.push(() => {
      document.write = write;
    });
    // The spies have to work, or "never called" proves nothing.
    const probe = document.createElement('div');
    probe.innerHTML = '<b>probe</b>';
    probe.insertAdjacentHTML('beforeend', '<i>probe</i>');
    document.createElement('div').attachShadow({ mode: 'open' }).innerHTML = '<b>probe</b>';
    expect(writers.innerHTML).toHaveBeenCalledTimes(2);
    expect(writers.insertAdjacentHTML).toHaveBeenCalledTimes(1);
    for (const spy of Object.values(writers)) spy.mockClear();
  }

  const assertSafe = (m: MountedMap) => {
    expect(m.shadow.querySelectorAll('img')).toHaveLength(0);
    expect(m.shadow.querySelectorAll('[onerror], [onload], [onclick]')).toHaveLength(0);
    expect(document.querySelectorAll('img')).toHaveLength(0);
    for (const spy of Object.values(writers)) expect(spy).not.toHaveBeenCalled();
  };

  it('renders hostile names, labels, subjects, URLs and source as inert text in every view', () => {
    spyOnHtmlSinks();
    const { port } = portForInputs(hostileInputs());
    map = mountWithStore({ view: 'fields' }, { port });
    const store = map.recorded.store();
    const visit = (state: Parameters<typeof store.set>[0]) => {
      store.set(state);
      assertSafe(map as MountedMap);
    };

    // Fields start and lens, with the hostile field label and writer names.
    visit({ view: 'fields', field: null });
    visit({ field: { moduleApiName: 'Deals', fieldApiName: 'Stage' } });
    expect(map.q('.lens-grid')?.textContent).toContain(HOSTILE);

    // List, search results, rail.
    visit({ view: 'list', query: 'img' });
    expect(map.q('.am-rail')?.textContent).toContain('<img');
    visit({ query: '' });
    visit({ view: 'list' });

    // Inspector for every kind that carries hostile text.
    for (const id of [
      'rule:rule-003',
      'rule:rule-000',
      'function:f-003',
      'field:Deals.Stage',
      'template:guide-0',
      'button:review-partner',
      'schedule:nightly-review',
      'module:Deals',
    ]) {
      visit({ selectedId: id, inspectorOpen: true });
    }
    visit({ selectedId: 'function:f-003', inspectorOpen: true });
    expect(map.q('.codebox')?.textContent).toContain(HOSTILE);
    expect(map.q('.ins-head h2')?.textContent).toBe(`Fn ${HOSTILE}`);

    // Trace and board placeholders, coverage popover, shortcuts.
    visit({ view: 'board' });
    visit({ view: 'trace', traceRootId: 'function:f-003' });
    click(map.q('.wf-index .wf-pill'));
    assertSafe(map);
    click(map.q('[aria-label="Keyboard shortcuts"]'));
    assertSafe(map);
  });

  it('keeps hostile text out of the URL hash and renders a hostile search query as text', () => {
    spyOnHtmlSinks();
    const { port } = portForInputs(hostileInputs());
    const typed = '<script>alert(2)</script>';
    map = mountWithStore({ view: 'list', query: typed }, { port });
    assertSafe(map);
    expect(map.q('.lt-empty h3')?.textContent).toBe(`No matches for "${typed}"`);
    expect(map.shadow.querySelectorAll('script')).toHaveLength(0);
    click(map.q('.lt-empty button'));
    expect(map.q('.am-search input')).toHaveProperty('value', '');
    map.recorded.store().set({ query: HOSTILE, selectedId: 'rule:rule-003', inspectorOpen: true });
    const input = map.q('.am-search input') as HTMLInputElement;
    key(input, 'a');
    click(map.qa('.ins-acts button').find((b) => b.textContent?.includes('Copy link')));
    expect(location.hash).toContain('q=');
    expect(location.hash).not.toContain('<');
    assertSafe(map);
  });

  it('shows hostile module labels in the module filter as text', () => {
    spyOnHtmlSinks();
    const { port } = portForInputs(hostileInputs());
    map = mountMap({ port });
    expect(map.q('.am-rail')?.textContent).toContain(HOSTILE);
    assertSafe(map);
  });
});
