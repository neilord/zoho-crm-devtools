import type { WorkflowFacetCount } from './search';
import type { WorkflowActionKind, WorkflowTriggerType } from './types';
import { button, el, text } from './view-dom';
import { icon } from './view-icons';
import {
  type CodeFilter,
  type Coverage,
  KIND_LABELS,
  type TriggerFieldOption,
  type UiFacetCounts,
  type UiFilters,
} from './view-model';

export interface RailHandlers {
  toggleStatus(v: 'active' | 'inactive'): void;
  toggleModule(v: string): void;
  toggleTrigger(v: WorkflowTriggerType): void;
  toggleKind(v: WorkflowActionKind): void;
  toggleCode(v: CodeFilter): void;
  toggleAllModules(): void;
}

const MODULE_LIMIT = 7;

function option(
  label: string,
  count: number,
  on: boolean,
  onClick: () => void,
  lead?: Node,
): HTMLButtonElement {
  return el(
    'button',
    {
      className: `opt${count === 0 && !on ? ' zero' : ''}`,
      type: 'button',
      attrs: { 'aria-pressed': String(on) },
      dataset: { fk: `opt:${label}` },
      onClick,
    },
    [
      el('span', { className: 'box' }, on ? [icon('check', 11)] : []),
      lead ?? null,
      el('span', { className: 't', text: label, title: label }),
      el('span', { className: 'n', text: String(count) }),
    ],
  );
}

function group(
  title: string,
  partial: string | null,
  children: Array<Node | null>,
  id?: string,
  className = 'fac',
): HTMLElement {
  return el('div', { className, attrs: id ? { role: 'group', 'aria-labelledby': id } : {} }, [
    el('h5', { attrs: id ? { id } : {} }, [
      text(title),
      partial
        ? el('span', {
            className: 'part',
            text: partial,
            title: 'Still indexing, so counts will grow',
          })
        : null,
    ]),
    ...children,
  ]);
}

const dot = (on: boolean) => el('span', { className: 'fs-dot', dataset: { on: String(on) } });

/** The facet groups, rebuilt on every change. The trigger-field input is kept by the caller so typing keeps focus. */
export function renderRailGroups(
  counts: UiFacetCounts,
  ui: UiFilters,
  coverage: Coverage,
  showAllModules: boolean,
  h: RailHandlers,
): { before: HTMLElement[]; after: HTMLElement[] } {
  const modules: WorkflowFacetCount[] = [...counts.modules];
  // Selected modules stay listed even if the current search zeroes them.
  const shown = showAllModules
    ? modules
    : modules.filter((m, i) => i < MODULE_LIMIT || ui.modules.has(m.key));
  const hidden = modules.length - shown.length;
  const indexing = coverage.status.kind === 'indexing';
  const partialActions =
    indexing && (coverage.pending.actions > 0 || coverage.pending.details > 0) ? 'partial' : null;
  const partialSources =
    indexing && (coverage.pending.sources > 0 || coverage.pending.details > 0) ? 'partial' : null;
  const triggers = counts.triggerTypes;
  const before = [
    group(
      'Status',
      null,
      [
        option(
          'Active',
          counts.active.active,
          ui.status.has('active'),
          () => h.toggleStatus('active'),
          dot(true),
        ),
        option(
          'Inactive',
          counts.active.inactive,
          ui.status.has('inactive'),
          () => h.toggleStatus('inactive'),
          dot(false),
        ),
      ],
      'wf-f-status',
    ),
    group(
      'Module',
      null,
      [
        ...shown.map((m) =>
          option(m.label, m.count, ui.modules.has(m.key), () => h.toggleModule(m.key)),
        ),
        modules.length > MODULE_LIMIT
          ? button(
              'wf-btn link more',
              showAllModules ? 'Show fewer' : `Show ${hidden} more`,
              h.toggleAllModules,
            )
          : null,
      ],
      'wf-f-module',
    ),
    group(
      'Trigger',
      null,
      [
        ...triggers.map((t) =>
          option(t.label, t.count, ui.triggerTypes.has(t.key), () => h.toggleTrigger(t.key)),
        ),
      ],
      'wf-f-trigger',
      'fac fac-open',
    ),
  ];
  const after = [
    group(
      'Action',
      partialActions ? 'partial' : null,
      counts.actionKinds.map((k) =>
        option(
          KIND_LABELS[k.key],
          k.count,
          ui.actionKinds.has(k.key),
          () => h.toggleKind(k.key),
          el('span', { className: 'ai' }, [icon(k.key, 14)]),
        ),
      ),
      'wf-f-action',
    ),
    group(
      'Function code',
      partialSources ? 'partial' : null,
      [
        option(
          'Has function code',
          counts.code.has,
          ui.code.has('has'),
          () => h.toggleCode('has'),
          el('span', { className: 'ai' }, [icon('code', 14)]),
        ),
        option(
          'Source unavailable',
          counts.code.missing,
          ui.code.has('missing'),
          () => h.toggleCode('missing'),
          el('span', { className: 'ai' }, [icon('warn', 14)]),
        ),
      ],
      'wf-f-code',
    ),
  ];
  return { before, after };
}

export function renderTriggerFieldOptions(options: readonly TriggerFieldOption[]): HTMLElement[] {
  return [...options]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((o) => el('option', { attrs: { value: o.label }, text: o.apiName }));
}
