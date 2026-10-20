import { button, el, text } from './view-dom';
import { icon } from './view-icons';
import type { Coverage } from './view-model';

export interface CoverageHandlers {
  onRetryAll(): void;
  onRetryFailure(index: number): void;
  onReindex(): void;
}

/** The header status pill: indexing progress, coverage gaps, or a failed/cancelled index. */
const width = (node: HTMLElement, percent: number): HTMLElement => {
  node.style.width = `${percent}%`;
  return node;
};

export function renderIndexPill(
  coverage: Coverage,
  open: boolean,
  onToggle: () => void,
): HTMLButtonElement {
  const s = coverage.status;
  let cls = 'wf-pill';
  let label: string;
  let lead: Node;
  let extra: Node | null = null;
  switch (s.kind) {
    case 'indexing':
      lead = icon('refresh', 13, 'spin');
      label = `Indexing ${s.percent}%`;
      extra = el('span', { className: 'mini' }, [width(el('i'), s.percent)]);
      break;
    case 'complete':
      cls += ' ok';
      lead = icon('check', 13);
      label = 'Fully indexed';
      break;
    case 'gaps':
      cls += ' warn';
      lead = icon('warn', 13);
      label = `Indexed · ${s.count} gap${s.count === 1 ? '' : 's'}`;
      break;
    case 'failed':
      cls += ' bad';
      lead = icon('warn', 13);
      label = 'Index failed';
      break;
    default:
      cls += ' warn';
      lead = icon('warn', 13);
      label = 'Indexing stopped';
  }
  if (coverage.refreshing) label += ' · refreshing…';
  return el(
    'button',
    {
      className: cls,
      type: 'button',
      attrs: {
        'aria-expanded': String(open),
        'aria-controls': 'wf-coverage',
        'aria-haspopup': 'dialog',
      },
      dataset: { status: s.kind, fk: 'pill' },
      onClick: onToggle,
    },
    [lead, text(label), extra],
  );
}

function row(r: Coverage['rows'][number]): HTMLElement {
  const fraction = r.total === 0 ? 1 : Math.min(1, r.done / r.total);
  const wrap = el('div', { className: 'cov' }, [
    el('span', { className: 'lbl', text: r.label }),
    el(
      'span',
      {
        className: `bar${fraction >= 1 && r.failed === 0 && !r.provisional ? ' done' : ''}`,
        attrs: {
          role: 'progressbar',
          'aria-label': r.label,
          'aria-valuemin': '0',
          'aria-valuemax': String(r.total),
          'aria-valuenow': String(r.done),
        },
      },
      [width(el('i'), Math.round(fraction * 100))],
    ),
    el('span', { className: 'num', text: `${r.done}/${r.provisional ? '?' : r.total}` }),
  ]);
  for (const note of r.notes) wrap.appendChild(el('span', { className: 'gap', text: note }));
  return wrap;
}

export function renderCoveragePopover(coverage: Coverage, handlers: CoverageHandlers): HTMLElement {
  const s = coverage.status;
  const finished = s.kind === 'complete' || s.kind === 'gaps';
  const title = finished
    ? 'Index coverage'
    : s.kind === 'failed'
      ? 'Index failed'
      : 'Building the index';
  const sub =
    s.kind === 'failed'
      ? 'Zoho did not return the rule list, so nothing could be indexed. Retry to try again.'
      : s.kind === 'cancelled'
        ? 'Indexing was stopped before it finished. Re-index to continue.'
        : finished
          ? 'Everything Zoho returned is searchable. Items below could not be read.'
          : 'Names, modules and status are searchable now. Conditions, actions, templates and code are added as they load.';
  const failures = coverage.failures;
  const foot = el('div', { className: 'foot' }, [
    el('span', {
      className: 'footnote',
      text: finished
        ? coverage.gaps
          ? `${coverage.gaps} gap${coverage.gaps === 1 ? '' : 's'}`
          : 'No gaps'
        : '',
    }),
    failures.length > 0 || s.kind === 'failed'
      ? button(
          'wf-btn',
          failures.length > 1 ? `Retry ${failures.length} failed` : 'Retry failed',
          handlers.onRetryAll,
          [icon('refresh', 13)],
          { attrs: { 'data-act': 'retry-all', 'data-fk': 'retry-all' } },
        )
      : button('wf-btn', 'Re-index', handlers.onReindex, [icon('refresh', 13)], {
          attrs: { 'data-act': 'reindex' },
        }),
  ]);
  const list =
    failures.length > 0
      ? el(
          'ul',
          { className: 'failures' },
          failures.slice(0, 6).map((f, i) =>
            el('li', {}, [
              el('span', { className: 'fmsg', text: failureLabel(f.target.kind) }),
              button('wf-btn link', 'Retry', () => handlers.onRetryFailure(i), [], {
                title: f.message,
              }),
            ]),
          ),
        )
      : null;
  return el(
    'div',
    {
      className: 'wf-pop',
      attrs: { id: 'wf-coverage', role: 'dialog', 'aria-label': 'Index coverage' },
    },
    [
      el('h4', { text: title }),
      el('p', { className: 'sub', text: sub }),
      ...coverage.rows.map(row),
      list,
      foot,
    ],
  );
}

function failureLabel(kind: string): string {
  switch (kind) {
    case 'list':
      return 'Rule list';
    case 'ruleDetail':
      return 'Rule details';
    case 'actionResource':
      return 'Action configuration';
    case 'template':
      return 'Email template';
    case 'functionSource':
      return 'Function source';
    case 'metadata':
      return 'Module fields';
    default:
      return 'Function catalogue';
  }
}

export function coverageSignature(c: Coverage, open: boolean): string {
  return JSON.stringify([open, c.refreshing, c.status, c.rows, c.failures.map((f) => f.id)]);
}
