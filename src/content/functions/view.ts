import { backIcon, editIcon, el, highlightNodes, spinnerIcon } from './dom';
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

/**
 * A single function row in the list, rendered as one table-like line: name/api/tag
 * on the left, full timestamp and REST status on the right. `highlight` marks
 * matched search text. `title` carries the description as a tooltip since the
 * row itself has no room for a second line.
 */
export function renderFunctionRow(
  record: FunctionRecord,
  onOpen: (record: FunctionRecord) => void,
  highlight = '',
): HTMLLIElement {
  const { summary } = record;
  const updated = formatTimestamp(summary.updatedTime);

  const titleChildren: Array<Node | null> = [
    el('span', { className: 'fs-row-name' }, highlightNodes(summary.display_name, highlight)),
  ];
  if (summary.api_name) {
    titleChildren.push(
      el('span', { className: 'fs-row-api' }, highlightNodes(`(${summary.api_name})`, highlight)),
    );
  }
  titleChildren.push(
    el('span', { className: 'fs-badge fs-row-tag', text: getCategoryLabel(summary.category) }),
  );

  const sideChildren: Array<Node | null> = [];
  if (updated) {
    sideChildren.push(
      el('span', { className: 'fs-row-time', text: `${updated.date}, ${updated.time}` }),
    );
  }
  if (summary.rest_api && summary.rest_api.length > 0) {
    sideChildren.push(el('span', { className: 'fs-row-flags' }, summary.rest_api.map(restApiFlag)));
  }

  return el(
    'li',
    {
      className: 'fs-row',
      title: summary.description || undefined,
      attrs: { role: 'button', tabindex: '0' },
      dataset: { id: summary.id },
      onClick: () => onOpen(record),
    },
    [
      el('div', { className: 'fs-row-main' }, titleChildren),
      el('div', { className: 'fs-row-side' }, sideChildren),
    ],
  );
}

export function renderEmptyState(message: string): HTMLElement {
  return el('div', { className: 'fs-empty', text: message });
}

/** Shown while nothing has rendered yet (no cache, first-ever load), so a slow list request reads as active rather than broken. */
export function renderLoadingState(message: string): HTMLElement {
  return el('div', { className: 'fs-empty fs-loading' }, [
    spinnerIcon(28),
    el('p', { className: 'fs-loading-text', text: message }),
  ]);
}

/** A titled block in the info panel. Returns null when it has no content. */
function infoSection(title: string, children: Array<Node | null>): HTMLElement | null {
  const present = children.filter((child): child is Node => child !== null);
  if (present.length === 0) {
    return null;
  }
  return el('section', { className: 'fs-info-section' }, [
    el('h4', { className: 'fs-info-label', text: title }),
    ...present,
  ]);
}

/** A label/value pair for the metadata section. */
function metaRow(label: string, value: string): HTMLElement {
  return el('div', { className: 'fs-meta-row' }, [
    el('span', { className: 'fs-meta-label', text: label }),
    el('span', { className: 'fs-meta-value', text: value }),
  ]);
}

function associationList(places: ZohoAssociatedPlace[]): HTMLElement {
  return el(
    'div',
    { className: 'fs-info-list' },
    places.map((place) =>
      el('div', { className: 'fs-info-item' }, [
        el('span', { className: 'fs-dot', dataset: { on: String(Boolean(place.status)) } }),
        el('span', { className: 'fs-info-item-text', text: place.module ?? place.name ?? '' }),
        place._type ? el('span', { className: 'fs-muted', text: `(${place._type})` }) : null,
      ]),
    ),
  );
}

function tasksList(tasks: ZohoFunctionTasks): HTMLElement | null {
  const rows: HTMLElement[] = [];
  for (const integration of tasks.integrations ?? []) {
    rows.push(
      el('div', { className: 'fs-info-item' }, [
        el('span', { className: 'fs-muted', text: `${integration.service ?? 'integration'}: ` }),
        el('span', { className: 'fs-info-item-text', text: integration.function ?? '' }),
      ]),
    );
  }
  for (const webhook of tasks.webhooks ?? []) {
    rows.push(
      el('div', { className: 'fs-info-item' }, [
        el('span', { className: 'fs-muted', text: 'webhook: ' }),
        el('span', { className: 'fs-info-item-text', text: webhook.method ?? '' }),
      ]),
    );
  }
  for (const _ of tasks.sendmail ?? []) {
    rows.push(el('div', { className: 'fs-info-item fs-muted', text: 'sendmail' }));
  }

  return rows.length > 0 ? el('div', { className: 'fs-info-list' }, rows) : null;
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

  const head = el('div', { className: 'fs-info-head' }, [
    el('span', {
      className: 'fs-badge',
      text: summary.source ? `${summary.source}: ${summary.category}` : summary.category,
    }),
    summary.api_name ? el('div', { className: 'fs-info-apiname', text: summary.api_name }) : null,
    summary.description ? el('p', { className: 'fs-info-desc', text: summary.description }) : null,
  ]);

  const metaRows: Array<Node | null> = [];
  if (detail?.modified_by) {
    metaRows.push(metaRow('Modified by', detail.modified_by));
  }
  if (created) {
    metaRows.push(metaRow('Created', `${created.date} · ${created.time}`));
  }
  if (updated) {
    metaRows.push(metaRow('Updated', `${updated.date} · ${updated.time}`));
  }

  let restApiChips: HTMLElement | null = null;
  if (summary.rest_api && summary.rest_api.length > 0) {
    restApiChips = el(
      'div',
      { className: 'fs-chips' },
      summary.rest_api.map((api) =>
        el('span', { className: 'fs-chip' }, [
          el('span', { className: 'fs-dot', dataset: { on: String(Boolean(api.active)) } }),
          el('span', { text: api.type ?? 'api' }),
        ]),
      ),
    );
  }

  const places = detail?.associated_place ?? summary.associated_place;

  const scroll = el('div', { className: 'fs-info-scroll' }, [
    head,
    infoSection('Details', metaRows),
    infoSection('REST API', [restApiChips]),
    infoSection('Associations', [places && places.length > 0 ? associationList(places) : null]),
    infoSection('Integrations', [summary.tasks ? tasksList(summary.tasks) : null]),
  ]);

  const footer = el('div', { className: 'fs-info-footer' }, [
    el(
      'button',
      { className: 'fs-edit-button', type: 'button', onClick: () => handlers.onEdit(record) },
      [editIcon(16), el('span', { text: 'Edit in CRM' })],
    ),
  ]);

  return el('div', { className: 'fs-info' }, [scroll, footer]);
}
