import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeWorkflowSearchOverlay,
  isWorkflowSearchOverlayOpen,
  openWorkflowSearchOverlay,
  type WorkflowOverlayDependencies,
} from '../src/content/workflows/overlay';
import {
  condition,
  FakeIndex,
  failure,
  fieldUpdateTrigger,
  functionAction,
  progress,
  rule,
  sampleRules,
  snapshot,
} from './workflow-ui-fixtures';

const context = { origin: 'https://crm.example.test', orgId: '999001', csrfHeader: '' };

function root(): ShadowRoot {
  const host = document.getElementById('zcdt-workflow-search-overlay');
  if (!host?.shadowRoot) throw new Error('overlay is not open');
  return host.shadowRoot;
}
const q = <T extends Element = HTMLElement>(sel: string): T => {
  const node = root().querySelector<T>(sel);
  if (!node) throw new Error(`missing ${sel}`);
  return node;
};
const qa = (sel: string) => [...root().querySelectorAll<HTMLElement>(sel)];
const rowNames = () => qa('.fs-row .nm').map((n) => n.textContent);
const choose = (name: string) => click(byText('.fs-row', name));

async function openWith(
  index: FakeIndex,
  over: Partial<WorkflowOverlayDependencies> = {},
): Promise<{ invoker: HTMLButtonElement; deps: ReturnType<typeof makeDeps> }> {
  const invoker = document.createElement('button');
  document.body.appendChild(invoker);
  const deps = makeDeps(index);
  await openWorkflowSearchOverlay(context, invoker, { ...deps, ...over });
  return { invoker, deps };
}
function makeDeps(index: FakeIndex) {
  return {
    requestAccess: vi.fn(async () => true),
    createIndex: vi.fn(() => index),
    openRule: vi.fn(),
    openFunction: vi.fn(async () => true),
    isCurrent: vi.fn(() => true),
  };
}
function type(value: string): void {
  const input = q<HTMLInputElement>('.wf-search input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  vi.advanceTimersByTime(100);
}
function key(
  k: string,
  target: Element = q('.wf-search input'),
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: k,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}
const click = (el: Element) => (el as HTMLElement).click();
const byText = (sel: string, text: string) => {
  const hit = qa(sel).find((n) => n.textContent?.includes(text));
  if (!hit) throw new Error(`no ${sel} containing ${text}`);
  return hit;
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});
afterEach(() => {
  closeWorkflowSearchOverlay();
  vi.useRealTimers();
});

describe('opening and access', () => {
  it('resolves entitlement before creating the index and never builds one when denied', async () => {
    const index = new FakeIndex();
    const order: string[] = [];
    const { deps } = await openWith(index, {
      requestAccess: vi.fn(async () => {
        order.push('access');
        return false;
      }),
      createIndex: vi.fn(() => {
        order.push('index');
        return index;
      }),
    });
    expect(order).toEqual(['access']);
    expect(isWorkflowSearchOverlayOpen()).toBe(false);
    expect(deps.openRule).not.toHaveBeenCalled();
  });

  it('creates the index only after access is granted, loads it and shows the dialog', async () => {
    const index = new FakeIndex();
    const order: string[] = [];
    await openWith(index, {
      requestAccess: vi.fn(async () => {
        order.push('access');
        return true;
      }),
      createIndex: vi.fn(() => {
        order.push('index');
        return index;
      }),
    });
    expect(order).toEqual(['access', 'index']);
    expect(index.loads).toBe(1);
    expect(q('.fs-panel').getAttribute('role')).toBe('dialog');
    expect(q('.fs-brand').textContent).toBe('Search All Workflows');
    expect(root().activeElement).toBe(q('.wf-search input'));
  });

  it('ignores a second click while the access check is pending', async () => {
    const index = new FakeIndex();
    let release: (v: boolean) => void = () => {};
    const requestAccess = vi.fn(() => new Promise<boolean>((r) => (release = r)));
    const invoker = document.createElement('button');
    document.body.appendChild(invoker);
    const deps = { ...makeDeps(index), requestAccess };
    const first = openWorkflowSearchOverlay(context, invoker, deps);
    await openWorkflowSearchOverlay(context, invoker, deps);
    expect(requestAccess).toHaveBeenCalledTimes(1);
    expect(invoker.getAttribute('aria-busy')).toBe('true');
    release(true);
    await first;
    expect(isWorkflowSearchOverlayOpen()).toBe(true);
    expect(invoker.hasAttribute('aria-busy')).toBe(false);
  });
});

describe('rendering', () => {
  it('lists every rule with module, trigger summary and action chips, and opens details for the first', async () => {
    await openWith(new FakeIndex());
    expect(rowNames()).toEqual([
      'Basket welcome',
      'Partner ping',
      'Ripeness check',
      'Still loading',
    ]);
    const first = qa('.fs-row')[0];
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(q('.fs-info h2').textContent).toBe('Basket welcome');
    const ripeness = byText('.fs-row', 'Ripeness check');
    expect(ripeness.textContent).toContain('Stage is modified to “Ripe”');
    expect(ripeness.querySelectorAll('.ai-chip').length).toBeGreaterThanOrEqual(2);
    expect(q('.wf-count').textContent).toBe('4 of 4 rules');
  });

  it('shows a loading skeleton for rules whose details have not arrived', async () => {
    await openWith(new FakeIndex());
    const loading = byText('.fs-row', 'Still loading');
    expect(loading.textContent).toContain('details loading');
    click(loading);
    expect(q('.fs-info .dpend').textContent).toContain('Loading this rule');
  });

  it('renders unknown action types as raw text instead of dropping them', async () => {
    await openWith(new FakeIndex());
    choose('Partner ping');
    const raw = qa('.fs-info .act').map((n) => n.textContent ?? '');
    expect(raw.some((t) => t.includes('mystery_action') && t.includes('sourdough'))).toBe(true);
    expect(raw.some((t) => t.includes('https://partner.example.test/hook'))).toBe(true);
  });

  it('renders scheduled actions grouped under their schedule label', async () => {
    const r = rule({
      id: '2001',
      name: 'Later',
      conditions: [
        {
          ...sampleRules()[0].conditions[0],
          instantActions: [],
          scheduledActions: [
            {
              id: 's1',
              offset: { unit: 5, period: 'minutes', raw: null },
              label: '{}',
              actions: [sampleRules()[0].conditions[0].instantActions[0]],
              raw: null,
            },
          ],
        },
      ],
    });
    await openWith(new FakeIndex(snapshot([r])));
    expect(q('.fs-info .grpl').textContent).toContain('Scheduled');
    expect(q('.fs-info .grpl .tag').textContent).toBe('5 minutes');
  });
});

describe('search and provenance', () => {
  it('debounces input, highlights title text and explains a function-code match with its line', async () => {
    await openWith(new FakeIndex());
    const input = q<HTMLInputElement>('.wf-search input');
    input.value = 'invokeurl';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rowNames()).toHaveLength(4); // not yet applied
    vi.advanceTimersByTime(100);
    expect(rowNames()).toEqual(['Ripeness check']);
    const prov = q('.fs-row .prov');
    expect(prov.textContent).toContain('Function code');
    expect(prov.textContent).toContain('wf_score_orchard');
    expect(prov.textContent).toContain('line 4');
    expect(q('.fs-row .snip mark').textContent?.toLowerCase()).toBe('invokeurl');
  });

  it('explains action and email-template matches with readable provenance', async () => {
    await openWith(new FakeIndex());
    type('ripe_on');
    const prov = q('.fs-row .prov');
    expect(prov.textContent).toContain('Field update');
    expect(q('.fs-row .snip').textContent).toBe('Stamp ripe date · Ripe_On = today');
    expect(q('.fs-row .snip mark').textContent).toBe('Ripe_On');
    type('your basket is ready');
    expect(q('.fs-row .prov').textContent).toContain('Email template');
    expect(q('.fs-row .snip mark').textContent?.toLowerCase()).toBe('your basket is ready');
  });

  it('summarises trigger and condition matches as readable text, not JSON slices', async () => {
    const alpha = rule({
      id: '4001',
      name: 'Alpha',
      trigger: fieldUpdateTrigger('Stage', 'Stage', 'Ripe'),
      conditions: [condition([])],
    });
    const beta = rule({ id: '4002', name: 'Beta', conditions: [condition([])] });
    await openWith(new FakeIndex(snapshot([alpha, beta])));
    type('ripe');
    expect(q('.fs-row .prov').textContent).toContain('Trigger');
    expect(q('.fs-row .snip').textContent).toBe('Stage is modified to “Ripe”');
    expect(q('.fs-row .snip mark').textContent).toBe('Ripe');
    type('pear');
    expect(qa('.fs-row .prov').map((n) => n.textContent)[0]).toContain('Condition 1');
    expect(q('.fs-row .snip').textContent).toBe('Fruit is “Pear”');
  });

  it('flags the matching action card and marks the hit line inside the code box', async () => {
    await openWith(new FakeIndex());
    type('invokeurl');
    const matched = qa('.fs-info .act.matched');
    expect(matched).toHaveLength(1); // only the function card contains the term
    expect(matched.every((n) => n.querySelector('.hitflag'))).toBe(true);
    const hit = q('.fs-info .cl.hit');
    expect(hit.textContent).toContain('invokeurl');
    expect(hit.querySelector('.no')?.textContent).toBe('4');
  });

  it('keeps long code inside a scrolling box with the toggle still present', async () => {
    const longSource = Array.from(
      { length: 40 },
      (_, i) => `  line_${i + 1} = ${'x'.repeat(200)};`,
    ).join('\n');
    const r = rule({
      id: '3001',
      name: 'Long code',
      conditions: [
        {
          ...sampleRules()[0].conditions[0],
          instantActions: [functionAction('wf_long', { sourceText: longSource })],
        },
      ],
    });
    await openWith(new FakeIndex(snapshot([r])));
    expect(qa('.fs-info .cl')).toHaveLength(14); // collapsed head
    expect(q('.fs-info .gap-l').textContent).toContain('26 lines hidden');
    const toggle = byText('.fs-info .cbar button', 'Show all lines');
    click(toggle);
    expect(qa('.fs-info .cl')).toHaveLength(40);
    expect(byText('.fs-info .cbar button', 'Collapse')).toBeTruthy();
  });

  it('shows the empty-results state with recovery actions', async () => {
    await openWith(new FakeIndex());
    click(byText('.wf-scope', 'Name'));
    type('zzzz-nothing');
    expect(q('.fs-empty h3').textContent).toContain('No rules match “zzzz-nothing”');
    click(byText('.fs-empty .wf-btn', 'Search everywhere'));
    expect(q('.fs-empty h3').textContent).toContain('No rules match');
    expect(byText('.wf-scope[aria-pressed="true"]', 'Everywhere')).toBeTruthy();
  });

  it('announces counts for deliberate changes only', async () => {
    const index = new FakeIndex();
    await openWith(index);
    type('welcome');
    expect(q('.sr-only').textContent).toBe('1 of 4 rules shown');
    index.publish(snapshot([...sampleRules(), rule({ id: '1005', name: 'Welcome extra' })]));
    vi.advanceTimersByTime(300);
    expect(rowNames()).toHaveLength(2);
    expect(q('.sr-only').textContent).toBe('1 of 4 rules shown'); // not re-announced on an index tick
  });
});

describe('filters', () => {
  it('toggles a module filter, shows a removable chip, updates counts, then clears all', async () => {
    await openWith(new FakeIndex());
    click(byText('.opt', 'Baskets'));
    expect(rowNames()).toEqual(['Basket welcome', 'Partner ping']);
    expect(q('.fs-chip').textContent).toContain('Module');
    expect(q('.wf-count').textContent).toBe('2 of 4 rules');
    click(q('.fs-chip button'));
    expect(rowNames()).toHaveLength(4);
    click(byText('.opt', 'Inactive'));
    expect(rowNames()).toEqual(['Basket welcome']);
    click(byText('.opt', 'Active'));
    expect(rowNames()).toHaveLength(4); // both statuses selected means no status filter
    click(byText('.wf-btn', 'Clear all'));
    expect(qa('.fs-chip')).toHaveLength(0);
    expect(q('.wf-none').textContent).toBe('No filters applied');
  });

  it('filters by action kind and by function-code availability', async () => {
    await openWith(new FakeIndex());
    click(byText('.opt', 'Webhook'));
    expect(rowNames()).toEqual(['Partner ping']);
    click(q('.fs-chip button'));
    click(byText('.opt', 'Has function code'));
    expect(rowNames()).toEqual(['Ripeness check']);
    click(q('.fs-chip button'));
    click(byText('.opt', 'Source unavailable'));
    expect(rowNames()).toEqual([]);
  });

  it('matches a typed trigger field against real trigger fields', async () => {
    await openWith(new FakeIndex());
    const field = q<HTMLInputElement>('.wf-rail input');
    field.value = 'stag';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(rowNames()).toEqual(['Ripeness check']);
    field.value = 'nonexistent_field';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(rowNames()).toEqual([]);
  });

  it('hides trigger types with no rules and sorts on request', async () => {
    await openWith(new FakeIndex());
    const triggers = qa('.fac[role="group"] .opt').map((n) => n.textContent ?? '');
    expect(triggers.some((t) => t.includes('Email sent'))).toBe(false);
    const sort = q<HTMLSelectElement>('.wf-sort select');
    sort.value = 'name';
    sort.dispatchEvent(new Event('change'));
    expect(rowNames()).toEqual([
      'Basket welcome',
      'Partner ping',
      'Ripeness check',
      'Still loading',
    ]);
  });
});

describe('keyboard', () => {
  it('moves the selection with arrow keys and mirrors it into aria-activedescendant', async () => {
    await openWith(new FakeIndex());
    const input = q<HTMLInputElement>('.wf-search input');
    key('ArrowDown');
    expect(q('.fs-row[aria-selected="true"] .nm').textContent).toBe('Partner ping');
    expect(input.getAttribute('aria-activedescendant')).toBe('wf-opt-1003');
    expect(q('.fs-info h2').textContent).toBe('Partner ping');
    key('ArrowUp');
    key('ArrowUp');
    expect(q('.fs-row[aria-selected="true"] .nm').textContent).toBe('Basket welcome');
  });

  it('opens the selected rule on Enter, disposes the index first and closes', async () => {
    const index = new FakeIndex();
    const { deps } = await openWith(index);
    key('ArrowDown');
    key('Enter');
    expect(deps.openRule).toHaveBeenCalledWith('1003');
    expect(index.disposed).toBe(true);
    expect(isWorkflowSearchOverlayOpen()).toBe(false);
  });

  it('focuses search on / unless the user is already typing', async () => {
    await openWith(new FakeIndex());
    const input = q<HTMLInputElement>('.wf-search input');
    q<HTMLButtonElement>('.fs-list').focus();
    expect(key('/', q('.fs-list')).defaultPrevented).toBe(true);
    expect(root().activeElement).toBe(input);
    expect(key('/', input).defaultPrevented).toBe(false);
  });

  it('does not let Zoho see keystrokes typed in the dashboard', async () => {
    await openWith(new FakeIndex());
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    key('a');
    document.removeEventListener('keydown', seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it('closes the coverage popover first on Esc, then the dashboard, and restores focus', async () => {
    const { invoker } = await openWith(new FakeIndex());
    click(q('.wf-pill'));
    expect(q('.wf-pop')).toBeTruthy();
    key('Escape');
    expect(root().querySelector('.wf-pop')).toBeNull();
    expect(isWorkflowSearchOverlayOpen()).toBe(true);
    key('Escape');
    expect(isWorkflowSearchOverlayOpen()).toBe(false);
    expect(document.activeElement).toBe(invoker);
  });

  it('traps Tab inside the dialog', async () => {
    await openWith(new FakeIndex());
    const focusables = qa(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )
      .filter((n) => n.style.display !== 'none')
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const last = focusables[focusables.length - 1];
    last.focus();
    expect(key('Tab', last).defaultPrevented).toBe(true);
    expect(root().activeElement).toBe(focusables[0]);
    expect(key('Tab', focusables[0], { shiftKey: true }).defaultPrevented).toBe(true);
    expect(root().activeElement).toBe(last);
  });
});

describe('focus survives rebuilds', () => {
  it('keeps focus on a clicked facet option so Esc and arrows still reach the dialog', async () => {
    await openWith(new FakeIndex());
    const before = byText('.opt', 'Baskets') as HTMLButtonElement;
    before.focus();
    click(before);
    const active = root().activeElement as HTMLElement | null;
    expect(active?.isConnected).toBe(true);
    expect(active).not.toBe(before);
    expect(active?.textContent).toContain('Baskets');
    expect(active?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps focus on scope pills, the status pill and the code toggle', async () => {
    const longSource = Array.from({ length: 30 }, (_, i) => `  step_${i} = ${i};`).join('\n');
    const r = rule({
      id: '3002',
      name: 'Long code',
      conditions: [condition([functionAction('wf_long', { sourceText: longSource })])],
    });
    await openWith(new FakeIndex(snapshot([r])));
    const scope = byText('.wf-scope', 'Actions') as HTMLButtonElement;
    scope.focus();
    click(scope);
    expect(root().activeElement?.textContent).toContain('Actions');
    expect(root().activeElement?.isConnected).toBe(true);

    const toggle = byText('.fs-info .cbar button', 'Show all lines') as HTMLButtonElement;
    toggle.focus();
    click(toggle);
    expect(root().activeElement?.isConnected).toBe(true);
    expect(root().activeElement?.textContent).toBe('Collapse');

    const pill = q<HTMLButtonElement>('.wf-pill');
    pill.focus();
    click(pill);
    expect(root().activeElement?.isConnected).toBe(true);
    expect(root().activeElement?.classList.contains('wf-pill')).toBe(true);
    // Esc dispatched from the live focus target still closes the popover, then the dialog.
    key('Escape', root().activeElement as Element);
    expect(root().querySelector('.wf-pop')).toBeNull();
    key('Escape', root().activeElement as Element);
    expect(isWorkflowSearchOverlayOpen()).toBe(false);
  });

  it('returns focus to the search box when the focused control disappears', async () => {
    await openWith(new FakeIndex());
    click(byText('.opt', 'Baskets'));
    const chipButton = q<HTMLButtonElement>('.fs-chip button');
    chipButton.focus();
    click(chipButton);
    expect(root().activeElement?.isConnected).toBe(true);
    expect(root().activeElement).toBe(q('.wf-search input'));
  });
});

describe('coverage', () => {
  it('shows indexing progress with an honest partial-index banner while a search needs missing data', async () => {
    const index = new FakeIndex(
      snapshot(sampleRules(), {
        phase: 'details',
        isComplete: false,
        ruleDetailsLoaded: 3,
        rulesListed: 4,
      }),
    );
    await openWith(index);
    expect(q('.wf-pill').textContent).toContain('Indexing');
    expect(root().querySelector('.wf-partial')).toBeNull(); // nothing searched yet
    type('x');
    expect(q('.wf-partial').textContent).toContain('Partial index');
    expect(q('.wf-partial').textContent).toContain('rule details');
  });

  it('never moves the indexing percentage backwards and marks later stages provisional', async () => {
    const early = sampleRules();
    const index = new FakeIndex(
      snapshot(early, {
        phase: 'details',
        isComplete: false,
        ruleDetailsLoaded: 3,
        rulesListed: 4,
      }),
    );
    await openWith(index);
    const percent = () => Number(q('.wf-pill').textContent?.match(/(\d+)%/)?.[1]);
    const before = percent();
    const pending = early.map((r) => ({
      ...r,
      conditions: r.conditions.map((c) => ({
        ...c,
        instantActions: c.instantActions.map((a) => ({ ...a, state: 'not-requested' as const })),
      })),
    }));
    index.publish(
      snapshot(pending, {
        phase: 'actions',
        isComplete: false,
        ruleDetailsLoaded: 3,
        rulesListed: 4,
      }),
    );
    vi.advanceTimersByTime(1000);
    expect(percent()).toBeGreaterThanOrEqual(before);
    click(q('.wf-pill'));
    expect(q('.wf-pop').textContent).toContain('More will appear as dependencies load');
    expect(root().querySelectorAll('.wf-pop .bar.done').length).toBeLessThanOrEqual(2); // rules, details only
  });

  it('reports a clean index as fully indexed', async () => {
    await openWith(new FakeIndex(snapshot(sampleRules(), { rulesListed: 4 })));
    expect(q('.wf-pill').textContent).toContain('Fully indexed');
  });

  it('lists gaps, retries one failure and retries all failed dependencies', async () => {
    const retry = vi.fn(async () => {});
    const index = new FakeIndex(
      snapshot(sampleRules(), {
        isComplete: false,
        functionSourcesUnavailable: 1,
        functionSourcesUncertain: 1,
        failures: [failure('f1', retry)],
      }),
    );
    await openWith(index);
    expect(q('.wf-pill').textContent).toContain('Indexed · 3 gaps');
    click(q('.wf-pill'));
    expect(q('.wf-pop').textContent).toContain('1 unavailable');
    expect(q('.wf-pop').textContent).toContain('1 uncertain');
    click(byText('.wf-pop .failures .wf-btn', 'Retry'));
    expect(retry).toHaveBeenCalledTimes(1);
    click(q('.wf-pop [data-act="retry-all"]'));
    expect(index.retried).toBe(1);
  });

  it('offers a retry on a failed action card', async () => {
    const retry = vi.fn(async () => {});
    const rules = sampleRules();
    const bad = rules[2];
    const failing = { ...bad.conditions[0].instantActions[0], state: 'failed' as const };
    rules[2] = {
      ...bad,
      failureIds: ['f1'],
      conditions: [{ ...bad.conditions[0], instantActions: [failing] }],
    };
    await openWith(
      new FakeIndex(snapshot(rules, { isComplete: false, failures: [failure('f1', retry)] })),
    );
    choose('Partner ping');
    click(byText('.fs-info .warnline .wf-btn', 'Retry'));
    expect(retry).toHaveBeenCalled();
  });

  it('shows a failed list as a recoverable empty state', async () => {
    const index = new FakeIndex({
      rules: [],
      progress: progress({ phase: 'failed', isComplete: false }),
    });
    await openWith(index);
    expect(q('.fs-empty h3').textContent).toContain('Could not load');
    expect(q('.wf-pill').textContent).toContain('Index failed');
    click(q('.fs-empty .wf-btn'));
    expect(index.loads).toBe(2);
  });

  it('shows empty-org and listing states', async () => {
    const index = new FakeIndex({
      rules: [],
      progress: progress({ phase: 'listing', isComplete: false }),
    });
    await openWith(index);
    expect(q('.fs-empty').textContent).toContain('Loading workflow rules');
    index.publish({ rules: [], progress: progress() });
    vi.advanceTimersByTime(300);
    expect(q('.fs-empty h3').textContent).toBe('No workflow rules in this org');
  });

  it('keeps the selected rule and its scroll while snapshots stream in', async () => {
    const index = new FakeIndex();
    await openWith(index);
    choose('Partner ping');
    index.publish(snapshot(sampleRules()));
    vi.advanceTimersByTime(300);
    expect(q('.fs-row[aria-selected="true"] .nm').textContent).toBe('Partner ping');
    expect(q('.fs-info h2').textContent).toBe('Partner ping');
  });
});

describe('handoffs and lifecycle', () => {
  it('opens the rule in Zoho from the footer button', async () => {
    const { deps } = await openWith(new FakeIndex());
    choose('Ripeness check');
    click(q('[data-act="open-rule"]'));
    expect(deps.openRule).toHaveBeenCalledWith('1001');
    expect(isWorkflowSearchOverlayOpen()).toBe(false);
  });

  it('hands the related function to the editor using the exact catalogue id', async () => {
    const { deps } = await openWith(new FakeIndex());
    choose('Ripeness check');
    click(q('[data-act="open-function"]'));
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.openFunction).toHaveBeenCalledTimes(1);
    const summary = (deps.openFunction.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(summary).toMatchObject({ id: '501', api_name: 'wf_score_orchard' });
    expect(isWorkflowSearchOverlayOpen()).toBe(true);
  });

  it('keeps the dashboard open and reports a failed editor handoff', async () => {
    await openWith(new FakeIndex(), { openFunction: vi.fn(async () => false) });
    choose('Ripeness check');
    click(q('[data-act="open-function"]'));
    await vi.advanceTimersByTimeAsync(0);
    expect(isWorkflowSearchOverlayOpen()).toBe(true);
    expect(q('.toast').textContent).toContain('Could not open the function');
  });

  it('disables the editor handoff when the source is not available', async () => {
    const r = sampleRules()[0];
    const fn = {
      ...r.conditions[0].instantActions[1],
      sourceState: 'unavailable',
      sourceText: null,
    } as never;
    const rules = [{ ...r, conditions: [{ ...r.conditions[0], instantActions: [fn] }] }];
    await openWith(new FakeIndex(snapshot(rules)));
    expect(q<HTMLButtonElement>('[data-act="open-function"]').disabled).toBe(true);
    expect(q('.fs-info .warnline').textContent).toContain('Source unavailable');
  });

  it('flags a name-only join as uncertain and never shows its code', async () => {
    const r = sampleRules()[0];
    const fn = {
      ...r.conditions[0].instantActions[1],
      joinConfidence: 'uncertain',
      sourceState: 'unavailable',
      sourceText: null,
    } as never;
    const rules = [{ ...r, conditions: [{ ...r.conditions[0], instantActions: [fn] }] }];
    await openWith(new FakeIndex(snapshot(rules)));
    expect(q('.fs-info .warnline').textContent).toContain('Uncertain match');
    expect(root().querySelector('.codebox')).toBeNull();
  });

  it('closes, unsubscribes and disposes when the route or org changes', async () => {
    const index = new FakeIndex();
    let current = true;
    await openWith(index, { isCurrent: vi.fn(() => current) });
    expect(isWorkflowSearchOverlayOpen()).toBe(true);
    current = false;
    vi.advanceTimersByTime(500);
    expect(isWorkflowSearchOverlayOpen()).toBe(false);
    expect(index.disposed).toBe(true);
    expect(index.listeners.size).toBe(0);
    expect(document.getElementById('zcdt-workflow-search-overlay')).toBeNull();
  });

  it('survives a rejected load and offers a retry', async () => {
    const index = new FakeIndex({
      rules: [],
      progress: progress({ phase: 'idle', isComplete: false }),
    });
    index.loadError = new Error('boom');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await openWith(index);
    await vi.advanceTimersByTimeAsync(0);
    expect(q('.fs-empty h3').textContent).toContain('Could not load');
    spy.mockRestore();
  });
});

it('renders the source hit line and its mark together in row provenance and code preview', async () => {
  const source = `${'info "context";\n'.repeat(11)}payload.put("quote_total", 42);\nresponse = invokeurl\n[\nurl: "https://example.invalid"\n];`;
  const rules = [
    rule({
      id: '1001',
      name: 'Source regression',
      conditions: [condition([functionAction('wf_score_orchard', { sourceText: source })])],
    }),
  ];
  await openWith(new FakeIndex(snapshot(rules)));
  type('invokeurl');
  expect(q('.fs-row .ref').textContent).toContain('line 13');
  expect(q('.fs-row .snip').textContent).toBe('response = invokeurl');
  expect(q('.fs-row .snip mark').textContent).toBe('invokeurl');
  expect(q('.cl.hit .no').textContent).toBe('13');
  expect(q('.cl.hit .ct').textContent).toBe('response = invokeurl');
});
it('refreshes selected detail when metadata changes without a load-state change', async () => {
  const rules = sampleRules();
  const index = new FakeIndex(snapshot(rules));
  await openWith(index);
  choose('Ripeness check');
  expect(q('.fs-info h2').textContent).toBe('Ripeness check');
  index.publish(snapshot([{ ...rules[0], name: 'Revalidated name' }, ...rules.slice(1)]));
  vi.advanceTimersByTime(1000);
  expect(q('.fs-info h2').textContent).toBe('Revalidated name');
});
it('cancels a pending upgrade on route departure before any index is created', async () => {
  const index = new FakeIndex();
  const deps = makeDeps(index);
  let current = true;
  let signal: AbortSignal | undefined;
  const pending = openWith(index, {
    ...deps,
    isCurrent: () => current,
    requestAccess: async (_invoker, abort) => {
      signal = abort;
      return new Promise((resolve) => abort?.addEventListener('abort', () => resolve(false)));
    },
  });
  current = false;
  vi.advanceTimersByTime(1000);
  await pending;
  expect(signal?.aborted).toBe(true);
  expect(deps.createIndex).not.toHaveBeenCalled();
});
it('uses store totals and counters for coverage even when rule nodes are not present', async () => {
  await openWith(
    new FakeIndex(
      snapshot([], {
        phase: 'actions',
        isComplete: false,
        rulesTotal: 10,
        ruleDetailsTotal: 10,
        ruleDetailsLoaded: 10,
        actionResourcesTotal: 20,
        actionResourcesLoaded: 5,
        templatesTotal: null,
        functionSourcesTotal: null,
      }),
    ),
  );
  click(q('.wf-pill'));
  expect(qa('.wf-pop .cov .num').map((n) => n.textContent)).toContain('5/20');
});

it('discards a snapshot received after route departure before the route poll runs', async () => {
  const index = new FakeIndex();
  let current = true;
  await openWith(index, { isCurrent: () => current });
  const oldNames = rowNames();
  current = false;
  index.publish(snapshot([rule({ id: '1006', name: 'Stale route rule' })]));
  expect(rowNames()).toEqual(oldNames);
  await Promise.resolve();
  expect(isWorkflowSearchOverlayOpen()).toBe(false);
});
