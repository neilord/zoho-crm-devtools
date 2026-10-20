import type { WorkflowSearchResult } from './search';
import type { WorkflowActionKind, WorkflowRule } from './types';
import { button, el, marked, markRanges, text } from './view-dom';
import { icon, kindIcon } from './view-icons';
import {
  bestProvenance,
  describeProvenance,
  KIND_LABELS,
  KIND_ORDER,
  listActions,
  moduleBadge,
  triggerSummary,
} from './view-model';

export const rowId = (rule: WorkflowRule): string => `wf-opt-${rule.id}`;

interface ChipSummary {
  counts: Map<WorkflowActionKind, number>;
  pending: number;
}

function chipSummary(rule: WorkflowRule): ChipSummary {
  const counts = new Map<WorkflowActionKind, number>();
  let pending = 0;
  for (const { action } of listActions(rule)) {
    if (action.state === 'loaded') counts.set(action.kind, (counts.get(action.kind) ?? 0) + 1);
    else pending++;
  }
  return { counts, pending };
}

/** Everything a row displays, as a string: rebuild only when this changes (keeps clicks intact). */
export function rowSignature(result: WorkflowSearchResult, query: string): string {
  const { rule } = result;
  const chips = chipSummary(rule);
  const best = query.trim() ? bestProvenance(result) : null;
  return JSON.stringify([
    rule.name,
    rule.active,
    moduleBadge(rule),
    triggerSummary(rule),
    rule.detailState,
    rule.conditions.length,
    [...chips.counts],
    chips.pending,
    best ? describeProvenance(rule, best) : null,
    result.matches.length,
  ]);
}

function actionChips(
  rule: WorkflowRule,
  activeKinds: ReadonlySet<WorkflowActionKind>,
): HTMLElement {
  const set = el('span', { className: 'ai-set' });
  if (rule.detailState === 'failed') {
    set.appendChild(
      el('span', { className: 'ai-chip pend', title: 'Rule details could not be loaded' }, [
        icon('warn', 14),
      ]),
    );
    return set;
  }
  if (rule.detailState !== 'loaded') {
    set.appendChild(el('span', { className: 'skel', attrs: { 'aria-hidden': 'true' } }));
    return set;
  }
  const { counts, pending } = chipSummary(rule);
  for (const kind of KIND_ORDER) {
    const n = counts.get(kind);
    if (!n) continue;
    set.appendChild(
      el(
        'span',
        {
          className: `ai-chip${activeKinds.has(kind) ? ' hit' : ''}`,
          title: `${KIND_LABELS[kind]}${n > 1 ? ` ×${n}` : ''}`,
        },
        [kindIcon(kind, 15), n > 1 ? el('sup', { text: String(n) }) : null],
      ),
    );
  }
  if (pending > 0) {
    set.appendChild(
      el(
        'span',
        {
          className: 'ai-chip pend',
          title: `${pending} action${pending > 1 ? 's' : ''} still loading or failed`,
        },
        [icon('unknown', 15)],
      ),
    );
  }
  return set;
}

export interface RowInput {
  result: WorkflowSearchResult;
  selected: boolean;
  query: string;
  activeKinds: ReadonlySet<WorkflowActionKind>;
  onSelect(rule: WorkflowRule): void;
}

export function renderRow(input: RowInput): HTMLLIElement {
  const { result, query } = input;
  const { rule } = result;
  const conditions =
    rule.detailState === 'loaded'
      ? `${rule.conditions.length} condition${rule.conditions.length === 1 ? '' : 's'}`
      : rule.detailState === 'failed'
        ? 'details unavailable'
        : 'details loading…';

  const best = query.trim() ? bestProvenance(result, input.activeKinds) : null;
  let r3: HTMLElement | null = null;
  if (best) {
    const view = describeProvenance(rule, best);
    const more = result.matches.length - 1;
    r3 = el('div', { className: 'r3' }, [
      el('span', { className: 'prov' }, [
        el('span', { className: 'w', text: view.where }),
        view.ref ? el('span', { className: 'ref', text: view.ref }) : null,
      ]),
      el(
        'span',
        { className: `snip${view.mono ? '' : ' plain'}` },
        markRanges(view.snippet, view.highlights),
      ),
      more > 0 ? el('span', { className: 'more', text: `+${more} more` }) : null,
    ]);
  }

  const li = el(
    'li',
    {
      className: 'fs-row',
      attrs: { role: 'option', 'aria-selected': String(input.selected), id: rowId(rule) },
      dataset: { ruleId: rule.id },
      onClick: () => input.onSelect(rule),
    },
    [
      el('div', { className: 'r1' }, [
        el('span', {
          className: 'fs-dot',
          dataset: { on: String(rule.active === true) },
          title: rule.active ? 'Active' : 'Inactive',
        }),
        el('span', { className: 'nm', title: rule.name }, marked(rule.name, query)),
        el('span', { className: 'fs-badge', text: moduleBadge(rule) }),
        el('span', { className: 'sp' }),
        actionChips(rule, input.activeKinds),
      ]),
      el('div', { className: 'r2' }, [
        el('span', { className: 'tr' }, [text(triggerSummary(rule))]),
        el('span', { className: 'dotsep', text: '·' }),
        el('span', { className: 'nowrap', text: conditions }),
      ]),
      r3,
    ],
  );
  return li;
}

export interface EmptyInput {
  kind: 'empty-org' | 'no-results' | 'listing' | 'failed';
  query: string;
  scopeLabel: string | null;
  filterCount: number;
  indexing: boolean;
  actions: {
    searchEverywhere(): void;
    clearFilters(): void;
    retry(): void;
  };
}

export function renderEmpty(input: EmptyInput): HTMLElement {
  if (input.kind === 'listing') {
    return el('div', { className: 'fs-empty', attrs: { role: 'status' } }, [
      icon('refresh', 26, 'spin'),
      el('p', { text: 'Loading workflow rules…' }),
    ]);
  }
  if (input.kind === 'failed') {
    return el('div', { className: 'fs-empty', attrs: { role: 'alert' } }, [
      el('span', { className: 'ico' }, [icon('warn', 26)]),
      el('h3', { text: 'Could not load workflow rules' }),
      el('p', { text: 'Zoho did not return the rule list. Check your connection and try again.' }),
      button('wf-btn', 'Try again', input.actions.retry, [icon('refresh', 13)]),
    ]);
  }
  if (input.kind === 'empty-org') {
    return el('div', { className: 'fs-empty' }, [
      el('span', { className: 'ico' }, [icon('inbox', 26)]),
      el('h3', { text: 'No workflow rules in this org' }),
      el('p', {
        text: 'There is nothing to search yet. Rules you create under Setup → Automation → Workflow Rules will appear here.',
      }),
    ]);
  }
  const q = input.query.trim();
  const sugg: HTMLElement[] = [];
  if (input.scopeLabel) {
    sugg.push(
      button(
        'wf-btn',
        `Search everywhere instead of “${input.scopeLabel}”`,
        input.actions.searchEverywhere,
      ),
    );
  }
  if (input.filterCount > 0) {
    sugg.push(
      button(
        'wf-btn',
        `Clear ${input.filterCount} filter${input.filterCount > 1 ? 's' : ''}`,
        input.actions.clearFilters,
      ),
    );
  }
  return el('div', { className: 'fs-empty', attrs: { role: 'status' } }, [
    el('span', { className: 'ico' }, [icon('search', 26)]),
    el('h3', { text: q ? `No rules match “${q}”` : 'No rules match these filters' }),
    el('p', {
      text: q
        ? 'Search matches the exact text you typed. Try fewer words, or check the spelling of API names such as Lead_Status.'
        : 'Loosen a filter to see more rules.',
    }),
    input.indexing
      ? el('p', {
          text: 'Indexing is still running. Actions, templates and function code are being added, so a match may appear in a moment.',
        })
      : null,
    el('div', { className: 'sugg' }, sugg),
  ]);
}
