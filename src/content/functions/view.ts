import { backIcon, editIcon, el, highlightNodes } from './dom';
import { formatTimestamp } from './format';
import { getCategoryLabel } from './search';
import type { FunctionRecord, ZohoAssociatedPlace, ZohoFunctionTasks, ZohoRestApi } from './types';
import { getFunctionSource } from './types';

export interface CategoryButtonModel {
  key: string | null;
  label: string;
  count: number;
}

/** A category filter button. `key: null` represents the "All" pseudo-category. */
export function renderCategoryButton(
  model: CategoryButtonModel,
  active: boolean,
  onSelect: (key: string | null) => void,
): HTMLButtonElement {
  return el(
    'button',
    {
      className: 'fs-category',
      type: 'button',
      attrs: { 'aria-pressed': String(active) },
      onClick: () => onSelect(model.key),
    },
    [
      el('span', { text: model.label }),
      el('span', { className: 'fs-category-count', text: String(model.count) }),
    ],
  );
}

function restApiFlag(api: ZohoRestApi): HTMLElement {
  return el('span', { className: 'fs-api-flag', title: api.active ? 'Enabled' : 'Disabled' }, [
    el('span', { className: 'fs-dot', dataset: { on: String(Boolean(api.active)) } }),
    el('span', { text: api.type ?? 'api' }),
  ]);
}

/** A single function row in the list. `highlight` marks matched search text. */
export function renderFunctionRow(
  record: FunctionRecord,
  onOpen: (record: FunctionRecord) => void,
  highlight = '',
): HTMLLIElement {
  const { summary } = record;
  const updated = formatTimestamp(summary.updatedTime);

  const titleChildren: Array<Node | null> = [
    el('span', {}, highlightNodes(summary.display_name, highlight)),
  ];
  if (summary.api_name) {
    titleChildren.push(
      el('span', { className: 'fs-row-api' }, highlightNodes(`(${summary.api_name})`, highlight)),
    );
  }

  const mainChildren: Array<Node | null> = [
    el('div', { className: 'fs-row-title' }, titleChildren),
  ];
  if (summary.description) {
    mainChildren.push(
      el(
        'div',
        { className: 'fs-row-desc', title: summary.description },
        highlightNodes(summary.description, highlight),
      ),
    );
  }
  mainChildren.push(
    el('div', { className: 'fs-row-badges' }, [
      el('span', { className: 'fs-badge', text: getCategoryLabel(summary.category) }),
    ]),
  );

  const sideChildren: Array<Node | null> = [];
  if (updated) {
    sideChildren.push(el('div', { text: updated.date }));
    sideChildren.push(el('div', { className: 'fs-meta', text: updated.time }));
  }
  if (summary.rest_api && summary.rest_api.length > 0) {
    sideChildren.push(el('div', { className: 'fs-row-badges' }, summary.rest_api.map(restApiFlag)));
  }

  return el(
    'li',
    {
      className: 'fs-row',
      attrs: { role: 'button', tabindex: '0' },
      dataset: { id: summary.id },
      onClick: () => onOpen(record),
    },
    [
      el('div', { className: 'fs-row-main' }, mainChildren),
      el('div', { className: 'fs-row-side' }, sideChildren),
    ],
  );
}

export function renderEmptyState(message: string): HTMLElement {
  return el('div', { className: 'fs-empty', text: message });
}

function associationBlock(places: ZohoAssociatedPlace[]): HTMLElement {
  const children = places.map((place) =>
    el('div', { className: 'fs-info-row' }, [
      el('span', { className: 'fs-dot', dataset: { on: String(Boolean(place.status)) } }),
      el('span', { text: ` ${place.module ?? place.name ?? ''} ` }),
      el('span', { className: 'fs-muted', text: place._type ? `(${place._type})` : '' }),
    ]),
  );
  return el('div', {}, [el('h4', { text: 'Associations' }), ...children]);
}

function tasksBlock(tasks: ZohoFunctionTasks): HTMLElement | null {
  const rows: HTMLElement[] = [];
  for (const integration of tasks.integrations ?? []) {
    rows.push(
      el('div', { className: 'fs-info-row' }, [
        el('span', { className: 'fs-muted', text: `${integration.service ?? 'integration'}: ` }),
        el('span', { text: integration.function ?? '' }),
      ]),
    );
  }
  for (const webhook of tasks.webhooks ?? []) {
    rows.push(
      el('div', { className: 'fs-info-row' }, [
        el('span', { className: 'fs-muted', text: 'webhook: ' }),
        el('span', { text: webhook.method ?? '' }),
      ]),
    );
  }
  for (const _ of tasks.sendmail ?? []) {
    rows.push(el('div', { className: 'fs-info-row fs-muted', text: 'sendmail' }));
  }

  return rows.length > 0 ? el('div', {}, [el('h4', { text: 'Integrations' }), ...rows]) : null;
}

export interface DetailHandlers {
  onBack: () => void;
  onEdit: (record: FunctionRecord) => void;
}

/** The detail view: source on the left, metadata + actions on the right. */
export function renderDetail(
  record: FunctionRecord,
  handlers: DetailHandlers,
  highlight = '',
): HTMLElement {
  const { summary, detail } = record;

  const bar = el('div', { className: 'fs-detail-bar' }, [
    el(
      'button',
      { className: 'fs-icon-button', type: 'button', title: 'Back', onClick: handlers.onBack },
      [backIcon(18)],
    ),
    el('span', { className: 'fs-detail-title', text: summary.display_name }),
  ]);

  const source = detail
    ? getFunctionSource(record) || '// No source available.'
    : '// Loading source…';
  const code = el('pre', { className: 'fs-code' }, highlightNodes(source, highlight));

  const info = renderInfoPanel(record, handlers);

  return el('div', { className: 'fs-detail' }, [
    bar,
    el('div', { className: 'fs-detail-body' }, [code, info]),
  ]);
}

function renderInfoPanel(record: FunctionRecord, handlers: DetailHandlers): HTMLElement {
  const { summary, detail } = record;
  const created = formatTimestamp(summary.createdTime);
  const updated = formatTimestamp(summary.updatedTime);

  const children: Array<Node | null> = [
    el('div', { className: 'fs-info-row' }, [
      el('span', {
        className: 'fs-badge',
        text: summary.source ? `${summary.source}: ${summary.category}` : summary.category,
      }),
    ]),
  ];

  if (summary.api_name) {
    children.push(el('div', { className: 'fs-info-row fs-muted', text: summary.api_name }));
  }
  if (summary.description) {
    children.push(el('div', { className: 'fs-info-row', text: summary.description }));
  }

  if (summary.rest_api && summary.rest_api.length > 0) {
    children.push(el('h4', { text: 'REST API' }));
    for (const api of summary.rest_api) {
      children.push(
        el('div', { className: 'fs-info-row' }, [
          el('span', { className: 'fs-dot', dataset: { on: String(Boolean(api.active)) } }),
          el('span', { text: ` ${api.type ?? 'api'}` }),
        ]),
      );
    }
  }

  if (detail?.modified_by) {
    children.push(
      el('div', { className: 'fs-info-row fs-meta' }, [
        el('span', { text: 'Last modified by ' }),
        el('span', { text: detail.modified_by }),
      ]),
    );
  }
  if (created) {
    children.push(
      el('div', {
        className: 'fs-info-row fs-meta',
        text: `Created ${created.date} ${created.time}`,
      }),
    );
  }
  if (updated) {
    children.push(
      el('div', {
        className: 'fs-info-row fs-meta',
        text: `Updated ${updated.date} ${updated.time}`,
      }),
    );
  }

  const places = detail?.associated_place ?? summary.associated_place;
  if (places && places.length > 0) {
    children.push(associationBlock(places));
  }
  if (summary.tasks) {
    children.push(tasksBlock(summary.tasks));
  }

  children.push(
    el(
      'button',
      { className: 'fs-edit-button', type: 'button', onClick: () => handlers.onEdit(record) },
      [editIcon(16), el('span', { text: 'Edit in CRM' })],
    ),
  );

  return el('div', { className: 'fs-info' }, children);
}
