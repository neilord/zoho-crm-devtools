import type { WorkflowSearchResult } from './search';
import type {
  WorkflowAction,
  WorkflowCriteria,
  WorkflowFieldMapping,
  WorkflowIndexFailure,
  WorkflowRule,
} from './types';
import { renderCodeBox } from './view-code';
import { button, el, marked, text } from './view-dom';
import { icon } from './view-icons';
import {
  criteriaLeaves,
  describeTrigger,
  type FunctionAction,
  failureFor,
  formatModified,
  formatValue,
  isOpenableFunction,
  KIND_LABELS,
  type LocatedAction,
  listActions,
  matchedActionKeys,
  moduleBadge,
  predicateParts,
  TRIGGER_LABELS,
} from './view-model';

export interface DetailHandlers {
  onOpenRule(rule: WorkflowRule): void;
  onOpenFunction(rule: WorkflowRule, action: FunctionAction): void;
  onToggleCode(key: string): void;
  onRetry(failure: WorkflowIndexFailure): void;
}

export interface DetailInput {
  rule: WorkflowRule;
  result: WorkflowSearchResult | undefined;
  query: string;
  failures: readonly WorkflowIndexFailure[];
  expandedCode: ReadonlySet<string>;
  /** Action key currently being handed to the editor, if any. */
  openingFunction: string | null;
  handlers: DetailHandlers;
}

const dot = (on: boolean | null) =>
  el('span', { className: 'fs-dot', dataset: { on: String(on === true) } });

export function renderDetailEmpty(): HTMLElement {
  return el('aside', { className: 'fs-info', attrs: { 'aria-label': 'Rule details' } }, [
    el('div', { className: 'fs-empty center' }, [
      el('span', { className: 'ico' }, [icon('search', 24)]),
      el('h3', { text: 'Select a rule' }),
      el('p', { text: 'Use ↑ and ↓ to browse the list, and Enter to open the rule in Zoho.' }),
    ]),
  ]);
}

function skeleton(width?: string): HTMLElement {
  const s = el('span', { className: 'skel' });
  if (width) s.style.width = width;
  return s;
}

function warnLine(
  message: Array<Node | null>,
  bad: boolean,
  retry?: { failure: WorkflowIndexFailure; onRetry(f: WorkflowIndexFailure): void },
): HTMLElement {
  return el('div', { className: `warnline${bad ? ' bad' : ''}`, attrs: { role: 'status' } }, [
    icon('warn', 14),
    el('span', {}, message),
    retry
      ? button('wf-btn', 'Retry', () => retry.onRetry(retry.failure), [icon('refresh', 12)], {
          attrs: { 'data-fk': `retry:${retry.failure.id}` },
        })
      : null,
  ]);
}

function kv(rows: Array<[string, Array<Node | null> | Node | string | null]>): HTMLElement | null {
  const present = rows.filter(([, v]) => v !== null && v !== '');
  if (present.length === 0) return null;
  const dl = el('dl', { className: 'kv' });
  for (const [label, value] of present) {
    dl.appendChild(el('dt', { text: label }));
    const dd = el('dd');
    if (typeof value === 'string') dd.appendChild(text(value));
    else if (Array.isArray(value)) for (const n of value) n && dd.appendChild(n);
    else if (value) dd.appendChild(value);
    dl.appendChild(dd);
  }
  return dl;
}

function renderCriteria(
  c: WorkflowCriteria | null,
  query: string,
  nested = false,
  modified = false,
): HTMLElement {
  if (!c) return el('div', { className: 'anyrec', text: 'Every record (no condition)' });
  if (c.kind === 'predicate') {
    const { comparator, value } = predicateParts(c, modified);
    return el('div', { className: 'leaf' }, [
      el('span', { className: 'f' }, marked(c.field.label, query)),
      text(' '),
      el('span', { className: 'c', text: comparator }),
      value ? text(' ') : null,
      value ? el('span', { className: 'v' }, marked(value, query)) : null,
    ]);
  }
  if (c.kind === 'unknown') {
    return el('pre', { className: 'mono rawjson' }, marked(c.jsonText, query));
  }
  const kids: Node[] = [];
  c.children.forEach((child, i) => {
    if (i > 0) kids.push(el('div', {}, [el('span', { className: 'op', text: c.operator })]));
    kids.push(renderCriteria(child, query, true, modified));
  });
  return el('div', { className: nested ? 'grp' : '' }, kids);
}

function mappings(list: readonly WorkflowFieldMapping[], query: string): HTMLElement | null {
  if (list.length === 0) return null;
  return kv(
    list.map((m): [string, Node[]] => [
      m.field.label,
      marked(formatValue(m.displayValue ?? m.value), query),
    ]),
  );
}

function functionBody(
  rule: WorkflowRule,
  a: FunctionAction,
  located: LocatedAction,
  input: DetailInput,
): Array<Node | null> {
  const { query, handlers } = input;
  const out: Array<Node | null> = [];
  out.push(
    kv([
      ['API name', a.apiName ? el('span', { className: 'mono' }, marked(a.apiName, query)) : null],
      [
        'Arguments',
        a.arguments.length
          ? a.arguments.map((arg) =>
              el(
                'div',
                { className: 'mono' },
                marked(`${arg.name} = ${formatValue(arg.value)}`, query),
              ),
            )
          : null,
      ],
    ]),
  );
  const failure = failureFor(rule, a, input.failures);
  if (failure || a.state === 'failed') {
    out.push(
      warnLine(
        [text("Zoho did not return this function's configuration. It is not searchable yet.")],
        true,
        failure ? { failure, onRetry: handlers.onRetry } : undefined,
      ),
    );
    return out;
  }
  if (a.joinConfidence === 'uncertain') {
    out.push(
      warnLine(
        [
          el('b', { text: 'Uncertain match. ' }),
          text('Linked to the function catalogue by name only, so its source is not used.'),
        ],
        false,
      ),
    );
    return out;
  }
  if (a.sourceState === 'loading' || a.sourceState === 'not-requested') {
    out.push(
      el('div', { className: 'dpend' }, [
        icon('refresh', 13, 'spin'),
        text(' Loading function source…'),
      ]),
    );
    return out;
  }
  if (a.sourceState === 'unavailable' || !a.sourceText) {
    out.push(
      warnLine(
        [
          el('b', { text: 'Source unavailable. ' }),
          text(
            a.joinConfidence === 'none'
              ? 'This function was not found in the function catalogue, so it cannot be searched by code.'
              : 'Zoho returned this function without code (common for extension functions), so it cannot be searched by code.',
          ),
        ],
        true,
      ),
    );
    return out;
  }
  const codeKey = `${rule.id}:${located.key}`;
  if (isOpenableFunction(a)) {
    out.push(
      el('div', { className: 'fnact' }, [
        button(
          'wf-btn',
          input.openingFunction === a.delugeFunctionId ? 'Opening…' : 'Open function in editor',
          () => handlers.onOpenFunction(rule, a),
          [icon('code', 12)],
          {
            disabled: input.openingFunction !== null,
            title: `Open ${a.apiName} in the Deluge editor`,
            attrs: { 'data-fk': `fn:${located.key}` },
          },
        ),
      ]),
    );
  }
  out.push(
    el('div', { className: 'abw' }, [
      renderCodeBox({
        name: a.apiName ?? a.bindingName,
        source: a.sourceText,
        query,
        expanded: input.expandedCode.has(codeKey),
        focusKey: `code:${codeKey}`,
        onToggle: () => handlers.onToggleCode(codeKey),
      }),
    ]),
  );
  return out;
}

function actionBody(
  rule: WorkflowRule,
  located: LocatedAction,
  input: DetailInput,
): { title: string; body: Array<Node | null> } {
  const a: WorkflowAction = located.action;
  const q = input.query;
  switch (a.kind) {
    case 'fieldUpdate': {
      const value = formatValue(a.value);
      return {
        title: a.field?.label ?? a.name,
        body: [
          kv([
            [
              'Field',
              a.field
                ? [
                    ...marked(a.field.label, q),
                    a.relatedModule
                      ? el('span', { className: 'fs-badge inline', text: a.relatedModule.label })
                      : null,
                  ]
                : null,
            ],
            ['Set to', value ? el('span', { className: 'mono' }, marked(value, q)) : null],
          ]),
          /\$\{/.test(value)
            ? el('div', {
                className: 'more wrap',
                text: 'Expression, evaluated by Zoho when the rule runs.',
              })
            : null,
        ],
      };
    }
    case 'task':
      return {
        title: a.subject ?? a.name,
        body: [
          mappings(a.fieldMappings, q) ??
            kv([['Subject', a.subject ? marked(a.subject, q) : null]]),
        ],
      };
    case 'emailNotification': {
      const t = a.template;
      const pending = t && (t.state === 'not-requested' || t.state === 'loading');
      return {
        title: a.name,
        body: [
          kv([
            ['Template', t ? marked(t.name, q) : null],
            ['Subject', t?.subject ? marked(t.subject, q) : pending ? skeleton('150px') : null],
            ['Body', t?.bodyText ? marked(t.bodyText.slice(0, 280), q) : null],
            ['Recipients', marked(formatValue(a.recipients), q)],
          ]),
        ],
      };
    }
    case 'webhook':
      return {
        title: a.name,
        body: [
          el('div', {}, [
            a.method ? el('span', { className: 'meth', text: a.method }) : null,
            el('span', { className: 'url' }, marked(a.url ?? '', q)),
          ]),
          el('div', {
            className: 'more wrap',
            text: 'Configuration only. The URL is never called from here.',
          }),
        ],
      };
    case 'function':
      return {
        title: a.apiName ?? a.bindingName ?? a.name,
        body: functionBody(rule, a, located, input),
      };
    case 'slack':
      return {
        title: 'Slack notification',
        body: [
          kv([
            ['Message', a.message ? marked(a.message, q) : null],
            ['Notify', marked(formatValue(a.notifyTo), q)],
          ]),
        ],
      };
    case 'assignOwner':
      return {
        title: 'Assign owner',
        body: [kv([['Assign to', marked(formatValue(a.assignTo), q)]])],
      };
    case 'addTags':
      return {
        title: 'Add tags',
        body: [
          el(
            'div',
            {},
            a.tags.map((tag) => el('span', { className: 'fs-badge inline' }, marked(tag.name, q))),
          ),
          a.overwrite !== null
            ? el('div', {
                className: 'more wrap',
                text: a.overwrite ? 'Replaces existing tags.' : 'Keeps existing tags.',
              })
            : null,
        ],
      };
    case 'convert':
      return { title: 'Convert', body: [mappings(a.fieldMappings, q)] };
    default:
      return {
        title: a.rawType || 'Unrecognized action',
        body: [
          el('div', {
            className: 'more wrap',
            text: 'Type not recognized by this version. Shown and searchable as raw text.',
          }),
          el('pre', { className: 'mono rawjson' }, marked(a.jsonText, q)),
        ],
      };
  }
}

function actionCard(
  rule: WorkflowRule,
  located: LocatedAction,
  matched: boolean,
  input: DetailInput,
): HTMLElement {
  const a = located.action;
  const failure = failureFor(rule, a, input.failures);
  const pending = a.state === 'not-requested' || a.state === 'loading';
  const { title, body } = actionBody(rule, located, input);
  const failed = (a.state === 'failed' || failure) && a.kind !== 'function';
  const isFunction = a.kind === 'function';
  const head = el('div', { className: 'ah' }, [
    el('span', { className: 'ak' }, [icon(a.kind, 15)]),
    el('div', { className: 'hd' }, [
      el('div', { className: 'kt', text: KIND_LABELS[a.kind] }),
      el('div', { className: 'an' }, marked(title || a.name || KIND_LABELS[a.kind], input.query)),
    ]),
    matched ? el('span', { className: 'hitflag', text: 'Match' }) : null,
  ]);
  let content: Array<Node | null>;
  if (failed) {
    content = [
      warnLine(
        [text("Zoho did not return this action's configuration. It is not searchable yet.")],
        true,
        failure ? { failure, onRetry: input.handlers.onRetry } : undefined,
      ),
    ];
  } else if (pending && !isFunction) {
    content = [skeleton('180px')];
  } else {
    content = body;
  }
  const wide = content.filter((n) => n instanceof HTMLElement && n.classList.contains('abw'));
  const narrow = content.filter((n) => !wide.includes(n));
  return el(
    'div',
    {
      className: `act${matched ? ' matched' : ''}`,
      dataset: { actionKey: located.key, matched: matched ? '1' : '0' },
    },
    [head, narrow.length ? el('div', { className: 'ab' }, narrow) : null, ...wide],
  );
}

function groupLabel(kind: 'instant' | 'scheduled', schedule?: string | null): HTMLElement {
  return el('div', { className: 'grpl' }, [
    icon(kind === 'instant' ? 'trigger' : 'clock', 12),
    text(kind === 'instant' ? ' Instant actions' : ' Scheduled '),
    schedule ? el('span', { className: 'tag', text: schedule }) : null,
  ]);
}

export function renderDetail(input: DetailInput): HTMLElement {
  const { rule, query, handlers } = input;
  const loaded = rule.detailState === 'loaded';
  const all = listActions(rule);
  const matched = matchedActionKeys(input.result);
  const modified = formatModified(rule.modifiedTime);
  const detailFailure = input.failures.find(
    (f) => f.target.kind === 'ruleDetail' && f.target.ruleId === rule.id,
  );

  const meta = el('div', { className: 'dmeta' }, [
    el('span', { className: 'fs-badge', text: moduleBadge(rule) }),
    modified ? el('span', { text: `Modified ${modified}` }) : null,
    loaded
      ? el('span', {
          text: `· ${rule.conditions.length} condition${rule.conditions.length === 1 ? '' : 's'} · ${all.length} action${all.length === 1 ? '' : 's'}`,
        })
      : null,
  ]);
  const head = el('div', { className: 'fs-info-head' }, [
    el('div', { className: 'dh1' }, [
      el('h2', {}, marked(rule.name, query)),
      el('span', { className: `st ${rule.active ? 'on' : 'off'}` }, [
        dot(rule.active),
        text(rule.active === null ? 'Unknown' : rule.active ? 'Active' : 'Inactive'),
      ]),
    ]),
    meta,
    rule.description ? el('p', { className: 'ddesc' }, marked(rule.description, query)) : null,
  ]);

  const sections: Array<Node | null> = [];
  if (rule.trigger) {
    const t = rule.trigger;
    const tree =
      t.type === 'field_update' && criteriaLeaves(t.criteria).length > 1 ? t.criteria : null;
    sections.push(
      el('div', { className: 'sec' }, [
        el('div', { className: 'fs-info-label' }, [
          text('Trigger'),
          el('span', { className: 'line' }),
        ]),
        el('div', { className: 'trg' }, [
          el('span', { className: 'tic' }, [
            icon(t.type === 'date_or_datetime' ? 'clock' : 'trigger', 16),
          ]),
          el('div', { className: 'tgb' }, [
            el('div', {}, marked(describeTrigger(t, rule), query)),
            tree
              ? el('div', { className: 'crit' }, [renderCriteria(tree, query, false, true)])
              : null,
            el('div', {
              className: 'raw',
              text: t.type === 'unknown' ? t.rawType : `${t.type} · ${TRIGGER_LABELS[t.type]}`,
            }),
          ]),
        ]),
      ]),
    );
  }

  if (!loaded) {
    sections.push(
      rule.detailState === 'failed'
        ? el('div', { className: 'sec' }, [
            warnLine(
              [
                text(
                  "Zoho did not return this rule's conditions and actions. It is searchable by name only.",
                ),
              ],
              true,
              detailFailure ? { failure: detailFailure, onRetry: handlers.onRetry } : undefined,
            ),
          ])
        : el('div', { className: 'sec' }, [
            el('div', { className: 'dpend' }, [
              icon('refresh', 14, 'spin'),
              text(" Loading this rule's conditions and actions…"),
            ]),
            el('div', { className: 'dskel' }, [
              skeleton(),
              skeleton('80%'),
              skeleton('90%'),
              skeleton('60%'),
            ]),
          ]),
    );
  } else {
    const condSections: HTMLElement[] = rule.conditions.map((condition, ci) => {
      const mine = all.filter((l) => l.location.conditionIndex === ci);
      const instant = mine.filter((l) => l.location.timing === 'instant');
      const scheduled = new Map<number, LocatedAction[]>();
      for (const l of mine) {
        if (l.location.timing === 'scheduled') {
          const list = scheduled.get(l.location.scheduleIndex) ?? [];
          list.push(l);
          scheduled.set(l.location.scheduleIndex, list);
        }
      }
      const kids: Array<Node | null> = [];
      kids.push(el('div', { className: 'crit' }, [renderCriteria(condition.criteria, query)]));
      if (condition.relatedCriteria?.criteria) {
        kids.push(
          el('div', { className: 'grpl' }, [
            text('Related '),
            condition.relatedCriteria.module
              ? el('span', { className: 'tag', text: condition.relatedCriteria.module.label })
              : null,
          ]),
          el('div', { className: 'crit' }, [
            renderCriteria(condition.relatedCriteria.criteria, query),
          ]),
        );
      }
      if (instant.length) {
        kids.push(groupLabel('instant'));
        for (const l of instant) kids.push(actionCard(rule, l, matched.has(l.key), input));
      }
      for (const list of scheduled.values()) {
        kids.push(groupLabel('scheduled', list[0].scheduleLabel));
        for (const l of list) kids.push(actionCard(rule, l, matched.has(l.key), input));
      }
      const count = mine.length;
      return el('div', { className: 'cond' }, [
        el('header', {}, [
          el('span', { className: 'seq', text: String(ci + 1) }),
          text(
            rule.conditions.length > 1
              ? `Condition ${ci + 1} of ${rule.conditions.length}`
              : 'Condition',
          ),
          el('span', { className: 'sub', text: `· ${count} action${count === 1 ? '' : 's'}` }),
        ]),
        el('div', { className: 'cb' }, kids),
      ]);
    });
    sections.push(
      el('div', { className: 'sec' }, [
        el('div', { className: 'fs-info-label' }, [
          text('Conditions & actions'),
          el('span', { className: 'line' }),
        ]),
        ...(condSections.length
          ? condSections
          : [el('div', { className: 'anyrec', text: 'This rule has no conditions or actions.' })]),
      ]),
    );
  }

  // Footer: the primary function is the matched one, else the first openable.
  const openable = all.filter((l) => isOpenableFunction(l.action));
  const primary = openable.find((l) => matched.has(l.key)) ?? openable[0];
  const anyFunction = all.some((l) => l.action.kind === 'function');
  const footer = el('div', { className: 'fs-info-footer' }, [
    button(
      'fs-edit-button',
      'Open in Zoho',
      () => handlers.onOpenRule(rule),
      [icon('external', 15)],
      {
        attrs: { 'data-act': 'open-rule', 'data-fk': 'open-rule' },
      },
    ),
    anyFunction
      ? button(
          'fs-edit-button sec2',
          input.openingFunction ? 'Opening…' : 'Open function in editor',
          () => primary && handlers.onOpenFunction(rule, primary.action as FunctionAction),
          [icon('code', 15)],
          {
            disabled: !primary || input.openingFunction !== null,
            title: primary
              ? `Open ${(primary.action as FunctionAction).apiName} in the Deluge editor`
              : 'No function source available to open',
            attrs: { 'data-act': 'open-function', 'data-fk': 'open-function' },
          },
        )
      : null,
  ]);

  return el('aside', { className: 'fs-info', attrs: { 'aria-label': 'Rule details' } }, [
    head,
    el('div', { className: 'fs-info-scroll', attrs: { tabindex: '-1' } }, sections),
    footer,
  ]);
}
