/** Right-hand inspector (UX spec §10): details, evidence-marked code, handoffs and actions. */

import type { WorkflowAction, WorkflowCriteria } from '../../workflows/types';
import {
  actionSummary,
  formatModified,
  predicateParts,
  triggerSummary,
} from '../../workflows/view-model';
import type {
  AutomationGraph,
  FunctionNode,
  MapEdge,
  MapNode,
  MapNodeId,
  RuleNode,
} from '../types';
import type { RegionEnv } from './actions';
import { evidenceMarkers, renderEvidenceCode } from './code';
import { button, captureFocus, el, marked, restoreFocus, text } from './dom';
import {
  describeAnalysis,
  evidenceTier,
  foreignDestination,
  moduleLabel,
  nodeName,
  ORG_WIDE,
  ownerOf,
  placementLabel,
  restApiLabel,
  SHARED,
  statusOf,
  TIER_LABEL,
} from './format';
import { mapIcon } from './icons';
import { ACTION_LABEL, KIND_COLOR, nodeIcon, nodeKindLabel, OP_LABEL } from './kinds';
import {
  buildLensModel,
  cascadeFor,
  cascadeText,
  declaredLabel,
  reachedWrites,
  writeCascade,
} from './lens-model';
import { groupLabel, groupOf } from './list-model';
import { graphVersion, type ShellModel } from './model';
import {
  badge,
  kindTile,
  lockPanel,
  lockRow,
  note,
  section,
  skeletonBlock,
  statusMark,
} from './parts';

export interface Inspector {
  el: HTMLElement;
  update(m: ShellModel): void;
  /** Clears all content (entitlement changes must not leave names in hidden DOM). */
  reset(): void;
}

const MAX_LINKS = 12;
const HUB_LINKS = 40;

interface Ctx {
  env: RegionEnv;
  m: ShellModel;
  node: MapNode;
  graph: AutomationGraph;
  teaser: boolean;
}

export function createInspector(env: RegionEnv): Inspector {
  const root = el('aside', {
    className: 'am-insp',
    attrs: { 'aria-label': 'Details', 'aria-hidden': 'true' },
  });
  let lastSig = '';
  let lastNode: string | null = null;

  const reset = () => {
    lastSig = '';
    lastNode = null;
    root.replaceChildren();
  };

  const update = (m: ShellModel) => {
    const { selectedId, inspectorOpen } = m.state;
    const open = inspectorOpen && selectedId !== null && m.access !== 'checking';
    root.classList.toggle('open', open);
    root.setAttribute('aria-hidden', String(!open));
    if (!open) {
      if (lastSig) reset();
      return;
    }
    const node = m.graph.nodes.get(selectedId as string);
    const sig = JSON.stringify([
      selectedId,
      graphVersion(m.graph),
      m.parsed.text,
      [...env.ui.expandedCode],
      env.ui.evidence,
      m.teaser,
      m.snapshot.phase,
      m.state.view,
    ]);
    if (sig === lastSig) return;
    lastSig = sig;
    const previous = root.querySelector<HTMLElement>('.ins-scroll');
    const scroll = lastNode === selectedId ? (previous?.scrollTop ?? 0) : 0;
    lastNode = selectedId;
    const focused = captureFocus(env.root, root);
    root.replaceChildren(
      ...(node ? build({ env, m, node, graph: m.graph, teaser: m.teaser }) : missing(m)),
    );
    restoreFocus(root, focused, env.fallback());
    const scroller = root.querySelector<HTMLElement>('.ins-scroll');
    if (scroller) scroller.scrollTop = scroll;
    if (node) afterBuild(root, scroll === 0);
  };

  return { el: root, update, reset };

  function missing(m: ShellModel): Node[] {
    const loading = m.snapshot.phase === 'loading' || m.snapshot.phase === 'enriching';
    return [
      el('div', { className: 'ins-head' }, [
        closeButton(env),
        el('h2', { text: loading ? 'Loading…' : 'Not in the map' }),
      ]),
      el('div', { className: 'ins-scroll' }, [
        loading
          ? skeletonBlock(4)
          : note(
              'This item is not in the current map. It may have been removed, or it is outside your plan.',
            ),
      ]),
    ];
  }
}

function afterBuild(root: HTMLElement, fresh: boolean): void {
  if (!fresh) return;
  // Evidence reveal is attached by the code view; nothing else needs measuring.
  root.querySelector<HTMLElement>('.ins-scroll')?.scrollTo?.({ top: 0 });
}

const closeButton = (env: RegionEnv): HTMLElement =>
  el(
    'button',
    {
      className: 'fs-icon-button ins-x',
      type: 'button',
      attrs: { 'aria-label': 'Close details', 'data-fk': 'insp-close' },
      onClick: () => env.actions.select(null),
    },
    [mapIcon('close', 14)],
  );

/* ---------- shared pieces ---------- */

function linkRow(c: Ctx, id: MapNodeId, meta?: string | null): HTMLElement | null {
  const target = c.graph.nodes.get(id);
  if (!target) return null;
  const target2 = ownerOf(c.graph, target);
  const row = el(
    'button',
    {
      className: 'lnk',
      type: 'button',
      dataset: { id: target2.id },
      onClick: () => c.env.actions.select(target2.id),
    },
    [
      kindTile(target2),
      el('span', { className: 'nm', text: nodeName(c.graph, target2, c.teaser) }),
      meta ? el('span', { className: 'meta', text: meta }) : null,
    ],
  );
  row.style.setProperty('--k', `var(${KIND_COLOR[target2.kind]})`);
  return row;
}

function linkList(
  c: Ctx,
  ids: readonly MapNodeId[],
  metaFn?: (id: MapNodeId) => string | null,
  limit = MAX_LINKS,
) {
  const unique = [
    ...new Set(
      ids.map((id) => {
        const n = c.graph.nodes.get(id);
        return n ? ownerOf(c.graph, n).id : id;
      }),
    ),
  ];
  const rows = unique
    .slice(0, limit)
    .map((id) => linkRow(c, id, metaFn?.(id) ?? null))
    .filter((r): r is HTMLElement => r !== null);
  if (unique.length > limit) rows.push(note(`+${unique.length - limit} more`, 'lens-empty small'));
  return rows;
}

function fieldChipFor(c: Ctx, edge: MapEdge): HTMLElement | null {
  const target = c.graph.nodes.get(edge.to);
  if (target?.kind !== 'field') return null;
  const tier = evidenceTier(edge);
  const label =
    target.bucket === 'unknownModule'
      ? 'module ?'
      : target.bucket === 'unknownFields'
        ? `${moduleLabel(c.graph, target.moduleApiName, c.teaser)} · ?`
        : `${moduleLabel(c.graph, target.moduleApiName, c.teaser)} · ${target.label}`;
  const chip = el(
    'button',
    {
      className: `fchip ${tier === 'exact' ? 'ex' : tier === 'partial' ? 'pa' : tier === 'unresolved' ? 'ur' : ''}`,
      type: 'button',
      title: `${TIER_LABEL[tier]}${foreignDestination(edge) ? ' · destination org unknown' : ''}`,
      onClick: () => c.env.actions.select(target.id),
    },
    [
      el('span', { className: 'fchip-t', text: label }),
      el('span', { className: 'sr-only', text: ` (${TIER_LABEL[tier]})` }),
    ],
  );
  return chip;
}

function writeRows(c: Ctx, edges: readonly MapEdge[], via?: (e: MapEdge) => string | null) {
  const rows: HTMLElement[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.to}|${edge.operation}|${edge.from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const chip = fieldChipFor(c, edge);
    if (!chip) continue;
    const tier = evidenceTier(edge);
    const lines = [...new Set((edge.spans ?? []).map((s) => s.line))];
    rows.push(
      el('div', { className: 'wrow' }, [
        chip,
        edge.operation
          ? el('span', {
              className: `op ${edge.operation === 'update' ? '' : edge.operation}`,
              text: OP_LABEL[edge.operation],
            })
          : null,
        edge.evidence === 'inferred'
          ? el('span', {
              className: `conf ${tier === 'exact' ? 'exact' : 'partial'}`,
              text: tier === 'exact' ? 'exact' : 'partial',
            })
          : edge.evidence === 'unresolved'
            ? el('span', { className: 'conf unknown', text: 'unresolved' })
            : null,
        via?.(edge) ? el('span', { className: 'via', text: via(edge) as string }) : null,
        ...lines.slice(0, 2).map((line) =>
          button(
            'ln',
            `line ${line}`,
            () =>
              c.env.actions.select(edge.from, { evidence: { nodeId: edge.from, edgeId: edge.id } }),
            [],
            {
              attrs: { 'data-line': String(line) },
            },
          ),
        ),
      ]),
    );
  }
  return rows;
}

function callers(c: Ctx, node: MapNode): MapNodeId[] {
  return (c.graph.incoming.get(node.id) ?? [])
    .filter((e) => e.kind === 'starts' || e.kind === 'invokes')
    .map((e) => e.from);
}

/** Callers grouped by home module (UX spec §10); a hub shows more of them. */
function groupedCallers(c: Ctx, ids: readonly MapNodeId[], limit: number): HTMLElement[] {
  const owners = [
    ...new Set(
      ids.map((id) => {
        const n = c.graph.nodes.get(id);
        return n ? ownerOf(c.graph, n).id : id;
      }),
    ),
  ];
  const groups = new Map<string, MapNodeId[]>();
  for (const id of owners.slice(0, limit)) {
    const node = c.graph.nodes.get(id);
    const key = node?.moduleApiName ?? '';
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const rows: HTMLElement[] = [];
  const grouped = groups.size > 1 || owners.length > 6;
  for (const [key, members] of groups) {
    if (grouped)
      rows.push(
        el('div', {
          className: 'grpl',
          text: `${key ? moduleLabel(c.graph, key, c.teaser) : ORG_WIDE} · ${members.length}`,
        }),
      );
    for (const id of members) {
      const row = linkRow(c, id, null);
      if (row) rows.push(row);
    }
  }
  if (owners.length > limit)
    rows.push(note(`+${owners.length - limit} more callers`, 'lens-empty small'));
  return rows;
}

function renderCriteria(c: WorkflowCriteria | null, query: string, nested = false): HTMLElement {
  if (!c) return el('div', { className: 'anyrec', text: 'Every record (no condition)' });
  if (c.kind === 'predicate') {
    const { comparator, value } = predicateParts(c);
    return el('div', { className: 'leaf' }, [
      el('span', { className: 'f' }, marked(c.field.label, query)),
      text(' '),
      el('span', { className: 'c', text: comparator }),
      value ? text(' ') : null,
      value ? el('span', { className: 'v' }, marked(value, query)) : null,
    ]);
  }
  if (c.kind === 'unknown')
    return el('pre', { className: 'mono rawjson' }, marked(c.jsonText, query));
  const kids: Node[] = [];
  c.children.forEach((child, i) => {
    if (i > 0) kids.push(el('div', {}, [el('span', { className: 'opr', text: c.operator })]));
    kids.push(renderCriteria(child, query, true));
  });
  return el('div', { className: nested ? 'grp' : '' }, kids);
}

/* ---------- per-kind bodies ---------- */

function actionTarget(c: Ctx, id: MapNodeId): MapNodeId {
  return (c.graph.outgoing.get(id) ?? [])[0]?.to ?? id;
}

function ruleActionRow(c: Ctx, id: MapNodeId, a: WorkflowAction, timing: string | null) {
  const target = actionTarget(c, id);
  const row = el(
    'button',
    {
      className: 'act',
      type: 'button',
      dataset: { id: target },
      onClick: () => c.env.actions.select(target),
    },
    [
      el('span', { className: 'ak' }, [mapIcon(a.kind, 14)]),
      el('span', { className: 'hd' }, [
        el('div', {
          className: 'kt',
          text: `${ACTION_LABEL[a.kind]}${timing ? ` · scheduled ${timing}` : ''}`,
        }),
        el('div', { className: 'an', text: actionSummary(a) || a.name }),
      ]),
      mapIcon('chevronR', 13),
    ],
  );
  return row;
}

function ruleBody(c: Ctx, node: RuleNode): Array<HTMLElement | null> {
  const r = node.rule;
  const query = c.m.parsed.text;
  const out: Array<HTMLElement | null> = [];
  out.push(
    section('Runs when', [
      el('div', { className: 'trg' }, [
        el('span', { className: 'tic' }, [mapIcon('trigger', 16)]),
        el('div', {
          text: r.trigger
            ? triggerSummary(r)
            : r.detailState === 'loaded'
              ? 'No trigger'
              : 'Trigger not loaded yet',
        }),
      ]),
    ]),
  );
  const failure = c.m.snapshot.coverage.failures.find(
    (f) => f.workflow && r.failureIds.includes(f.workflow.id),
  );
  if (failure)
    out.push(
      el('div', { className: 'warnline bad', attrs: { role: 'status' } }, [
        mapIcon('warn', 14),
        el('span', { text: failure.message }),
        button('wf-btn', 'Retry', () => c.env.actions.retry(failure.id), [mapIcon('refresh', 12)], {
          attrs: { 'data-fk': `retry:${failure.id}` },
        }),
      ]),
    );
  if (r.conditions.length === 0 && !failure) {
    out.push(
      section('Conditions & actions', [
        r.detailState === 'loaded'
          ? note('This rule has no conditions or actions.')
          : skeletonBlock(3),
      ]),
    );
  } else {
    out.push(
      section(
        'Conditions & actions',
        r.conditions.map((cond, ci) => {
          const actions: HTMLElement[] = [];
          cond.instantActions.forEach((a, ai) => {
            actions.push(ruleActionRow(c, `action:${r.id}/${ci}/i/${ai}`, a, null));
          });
          cond.scheduledActions.forEach((s, si) => {
            s.actions.forEach((a, ai) => {
              actions.push(ruleActionRow(c, `action:${r.id}/${ci}/s${si}/${ai}`, a, s.label));
            });
          });
          return el('div', { className: 'cond' }, [
            el('header', {}, [
              el('span', { className: 'seq', text: String(ci + 1) }),
              text(cond.criteria ? 'Condition' : 'Every record'),
              el('span', {
                className: 'sub',
                text: ` · ${actions.length} action${actions.length === 1 ? '' : 's'}`,
              }),
            ]),
            el('div', { className: 'cb' }, [
              cond.criteria
                ? el('div', { className: 'crit' }, [renderCriteria(cond.criteria, query)])
                : null,
              cond.relatedCriteria
                ? el('div', { className: 'crit' }, [
                    el('div', {
                      className: 'grpl',
                      text: `Related ${c.teaser ? 'records' : (cond.relatedCriteria.module?.label ?? 'records')}`,
                    }),
                    renderCriteria(cond.relatedCriteria.criteria, query),
                  ])
                : null,
              ...actions,
            ]),
          ]);
        }),
      ),
    );
  }
  const writes = reachedWrites(c.graph, node.id);
  out.push(
    section('Writes', [
      ...(writes.length
        ? writeRows(c, writes, (e) => {
            const source = c.graph.nodes.get(e.from);
            if (!source) return null;
            if (source.kind !== 'action') return `via ${source.label}`;
            // The edge note names the declaring action ("Task created (field mapping)"); only
            // a real field update is a "field update".
            return source.action.kind === 'fieldUpdate'
              ? 'via field update'
              : declaredLabel(c.graph, e, source);
          })
        : [note('No field writes found.')]),
    ]),
  );
  const cascades = writes.filter((e) => {
    const t = c.graph.nodes.get(e.to);
    return (
      writeCascade(c.graph, e) === 'possible' &&
      t?.kind === 'field' &&
      (c.graph.outgoing.get(t.id) ?? []).some((x) => x.kind === 'reacts')
    );
  });
  if (cascades.length)
    out.push(
      section(
        'Possible cascades',
        cascades.map((e) => {
          const t = c.graph.nodes.get(e.to);
          const rules = (c.graph.outgoing.get(e.to) ?? [])
            .filter((x) => x.kind === 'reacts')
            .map((x) => c.graph.nodes.get(x.to)?.label)
            .filter(Boolean);
          return el('div', { className: 'wrow wrap' }, [
            el('span', { className: 'cascnote possible' }, [
              mapIcon('loop', 12),
              text(` ${t ? nodeName(c.graph, t, c.teaser) : ''}`),
            ]),
            el('span', {
              className: 'via',
              text: `→ ${rules.slice(0, 4).join(', ')}${rules.length > 4 ? ` +${rules.length - 4}` : ''}`,
            }),
          ]);
        }),
      ),
    );
  return out;
}

function functionBody(c: Ctx, node: FunctionNode): Array<HTMLElement | null> {
  const out: Array<HTMLElement | null> = [];
  if (node.restApi)
    out.push(
      section('Entry point', [
        el('div', { className: 'trg' }, [
          el('span', { className: 'tic' }, [mapIcon('plug', 16)]),
          el('div', {
            text: `Callable over REST with ${restApiLabel(node.restApi)}. Treat as a possible trigger from outside Zoho.`,
          }),
        ]),
      ]),
    );
  const callerIds = callers(c, node);
  const hub = node.inDegree >= 8;
  const callerRows = groupedCallers(c, callerIds, hub ? HUB_LINKS : MAX_LINKS);
  const shown = new Set(
    callerIds.map((id) => {
      const n = c.graph.nodes.get(id);
      return n ? ownerOf(c.graph, n).id : id;
    }),
  ).size;
  out.push(
    section(`Called by${hub ? ' · hub' : ''}`, [
      ...(callerRows.length
        ? callerRows
        : [note('Not called by any indexed automation (unassociated).')]),
      c.teaser && node.inDegree > shown
        ? lockRow(c.env, [text(`${node.inDegree - shown} more callers are in the fog`)])
        : null,
    ]),
  );
  const source = c.env.port.sourceText(node.delugeId);
  const outgoing = c.graph.outgoing.get(node.id) ?? [];
  const writes = outgoing.filter((e) => e.kind === 'writes');
  if (c.teaser && source === null && node.analysis !== 'source-unavailable') {
    out.push(
      section('Code and effects', [
        lockPanel(c.env, 'What this function writes and calls is in the fog.'),
      ]),
    );
    return out;
  }
  out.push(
    section('Writes', [
      ...(writes.length
        ? [
            ...writeRows(c, writes),
            (() => {
              const first = writes[0];
              const cascade = cascadeText(cascadeFor(c.graph, first, node));
              return note(cascade.text, `lens-empty small ${cascade.tone}`);
            })(),
          ]
        : [
            note(
              node.analysis === 'analyzed'
                ? 'No recognised writes in analysed source. That does not mean it is read-only.'
                : node.analysis === 'pending'
                  ? 'Still being analysed.'
                  : 'Writes unknown: this function could not be fully analysed.',
            ),
          ]),
    ]),
  );
  const calls = outgoing.filter((e) => e.kind === 'invokes').map((e) => e.to);
  if (calls.length) out.push(section('Calls', linkList(c, calls)));
  const externals = outgoing.filter((e) => e.kind === 'calls').map((e) => e.to);
  if (externals.length) out.push(section('External', linkList(c, externals)));
  if (source !== null) {
    const focus = c.env.ui.evidence?.nodeId === node.id ? c.env.ui.evidence : null;
    const edge = focus?.edgeId ? outgoing.find((e) => e.id === focus.edgeId) : null;
    const view = renderEvidenceCode({
      name: node.apiName ?? node.label,
      source,
      query: c.m.parsed.text,
      markers: evidenceMarkers(c.graph, node),
      currentLine: edge?.spans?.[0]?.line ?? null,
      expanded: c.env.ui.expandedCode.has(node.id),
      onToggle: () => {
        if (!c.env.ui.expandedCode.delete(node.id)) c.env.ui.expandedCode.add(node.id);
        c.env.actions.refresh();
      },
    });
    out.push(section('Source', [view.el]));
    queueMicrotask(() => view.reveal());
  }
  const analysis = describeAnalysis(node);
  if (analysis)
    out.push(
      section('Analysis', [
        el('div', { className: `anabox ${analysis.tone}` }, [
          mapIcon(analysis.tone === 'ok' ? 'check' : 'warn', 14),
          el('span', { text: analysis.text }),
        ]),
      ]),
    );
  return out;
}

function fieldBody(c: Ctx, node: Extract<MapNode, { kind: 'field' }>): Array<HTMLElement | null> {
  const out: Array<HTMLElement | null> = [];
  if (node.bucket !== 'field') {
    const module = moduleLabel(c.graph, node.moduleApiName, c.teaser);
    out.push(
      section('What this means', [
        note(
          node.bucket === 'unknownFields'
            ? `These writers target ${module} records, but the analyser could not name the fields. Any ${module} field could be affected.`
            : 'These writers choose the module at run time. They could write any module and field.',
        ),
      ]),
    );
    out.push(
      section(
        'Writers',
        linkList(
          c,
          (c.graph.incoming.get(node.id) ?? [])
            .filter((e) => e.kind === 'writes')
            .map((e) => e.from),
        ),
      ),
    );
    return out;
  }
  const lens = buildLensModel(
    c.graph,
    c.env.port.fieldLens(node.moduleApiName as string, node.fieldApiName, c.m.filters),
    node.moduleApiName as string,
    node.fieldApiName,
    { scope: c.m.filters.scope, teaser: c.teaser },
  );
  out.push(
    section('Writers', [
      ...(lens.groups.length
        ? lens.groups.map((g) =>
            el('div', { className: 'wrow' }, [
              el('b', { className: 'grow', text: g.title }),
              badge(String(g.collapsible ? g.sources : g.items.length)),
            ]),
          )
        : [note('No known writers in analysed automation.')]),
      c.teaser ? lockRow(c.env, [text('Other writers are in the fog')]) : null,
      button(
        'fs-edit-button inline',
        'Open field lens',
        () =>
          c.env.actions.openField({
            moduleApiName: node.moduleApiName as string,
            fieldApiName: node.fieldApiName,
          }),
        [mapIcon('field', 14)],
      ),
    ]),
  );
  const reactors = [...lens.triggerReactors, ...lens.criteriaReactors];
  out.push(
    section('Reactors', [
      ...(reactors.length
        ? reactors.map((r) =>
            linkRow(c, r.rule.id, r.group === 'trigger' ? 'on change' : 'criteria'),
          )
        : [note('No rules react to this field.')]),
    ]),
  );
  return out;
}

function templateBody(
  c: Ctx,
  node: Extract<MapNode, { kind: 'template' }>,
): Array<HTMLElement | null> {
  const users = (c.graph.incoming.get(node.id) ?? [])
    .filter((e) => e.kind === 'uses')
    .map((e) => e.from);
  const body = users
    .map((id) => c.graph.nodes.get(id))
    .map((n) =>
      n?.kind === 'action' && n.action.kind === 'emailNotification'
        ? n.action.template?.bodyText
        : null,
    )
    .find((t): t is string => !!t);
  const kv = el('dl', { className: 'kv wide' }, [
    el('dt', { text: 'Subject' }),
    el('dd', { text: node.subject ?? '—' }),
    el('dt', { text: 'Body' }),
    el('dd', { text: body ? (body.length > 280 ? `${body.slice(0, 280)}…` : body) : '—' }),
  ]);
  return [section('Template', [kv]), section('Used by', linkList(c, users))];
}

function externalBody(
  c: Ctx,
  node: Extract<MapNode, { kind: 'external' }>,
): Array<HTMLElement | null> {
  const labels = {
    webhookHost: 'Webhook host',
    urlHost: 'URL host',
    connection: 'Connection',
    zohoService: 'Zoho service',
    email: 'Email (sendmail)',
  } as const;
  return [
    section('Endpoint', [
      el('div', { className: 'trg col' }, [
        el('div', {}, [el('b', { text: labels[node.externalKind] })]),
        el('div', {
          className: 'mono url',
          text: node.key === '*' ? 'Unknown at analysis time' : node.key,
        }),
      ]),
      note('Configuration only. Nothing is called from here.'),
    ]),
    section(
      'Called by',
      linkList(
        c,
        (c.graph.incoming.get(node.id) ?? []).filter((e) => e.kind === 'calls').map((e) => e.from),
      ),
    ),
  ];
}

function entryBody(c: Ctx, node: MapNode): Array<HTMLElement | null> {
  const out: Array<HTMLElement | null> = [];
  if (node.kind === 'button')
    out.push(
      section('Placement', [
        el('div', { className: 'trg' }, [
          el('span', { className: 'tic' }, [mapIcon('cursor', 16)]),
          el('div', {
            text: `${placementLabel(node.placements)} · ${node.actionType.replace(/_/g, ' ')}`,
          }),
        ]),
      ]),
    );
  else if (node.kind === 'schedule')
    out.push(
      section('Runs', [
        el('div', { className: 'trg' }, [
          el('span', { className: 'tic' }, [mapIcon('clock', 16)]),
          el('div', { text: node.recurrenceLabel ?? 'Schedule details are not available.' }),
        ]),
      ]),
    );
  else if (node.kind === 'transition')
    out.push(
      section('Blueprint', [
        el('div', { className: 'trg' }, [
          el('span', { className: 'tic' }, [mapIcon('transition', 16)]),
          el('div', {}, [
            text(node.blueprintName),
            el('div', { className: 'sub', text: 'A user runs this transition from the record.' }),
          ]),
        ]),
      ]),
    );
  else if (node.kind === 'approval')
    out.push(
      section('Approval process', [
        el('div', { className: 'trg' }, [
          el('span', { className: 'tic' }, [mapIcon('approval', 16)]),
          el('div', { text: 'Runs when the approval process reaches an outcome.' }),
        ]),
      ]),
    );
  const outgoing = c.graph.outgoing.get(node.id) ?? [];
  const direct = outgoing.filter((e) => e.kind === 'starts').map((e) => e.to);
  if (node.kind === 'button' || node.kind === 'schedule')
    out.push(section('Runs function', linkList(c, direct)));
  else out.push(section('Actions', linkList(c, direct)));
  const writes = reachedWrites(c.graph, node.id);
  if (writes.length)
    out.push(
      section(
        node.kind === 'transition' || node.kind === 'approval'
          ? 'Writes (declared)'
          : 'Writes (via function)',
        writeRows(c, writes),
      ),
    );
  return out;
}

function actionBody(c: Ctx, node: Extract<MapNode, { kind: 'action' }>): Array<HTMLElement | null> {
  const owner = c.graph.nodes.get(node.ownerId);
  return [
    section('What it does', [note(actionSummary(node.action) || node.label, 'trg plain')]),
    node.timingLabel
      ? section('When', [note(`Scheduled · ${node.timingLabel}`, 'trg plain')])
      : null,
    section('Belongs to', owner ? [linkRow(c, owner.id)] : []),
    section(
      'Target',
      linkList(
        c,
        (c.graph.outgoing.get(node.id) ?? []).map((e) => e.to),
      ),
    ),
  ];
}

function moduleBody(node: Extract<MapNode, { kind: 'module' }>): Array<HTMLElement | null> {
  const k = node.counts;
  return [
    section('In this module', [
      el('dl', { className: 'kv wide' }, [
        el('dt', { text: 'Rules' }),
        el('dd', { text: `${k.rules} (${k.activeRules} active)` }),
        el('dt', { text: 'Functions' }),
        el('dd', { text: String(k.functions) }),
        el('dt', { text: 'Buttons' }),
        el('dd', { text: String(k.buttons) }),
        el('dt', { text: 'Schedules' }),
        el('dd', { text: String(k.schedules) }),
        el('dt', { text: 'Fields written' }),
        el('dd', { text: String(k.fieldsWritten) }),
      ]),
    ]),
  ];
}

/* ---------- build ---------- */

function build(c: Ctx): Node[] {
  const { node, env, graph, teaser } = c;
  const status = statusOf(node);
  const rule = node.kind === 'rule' ? node : null;
  const owner = ownerOf(graph, node);
  const home = node.moduleApiName
    ? moduleLabel(graph, node.moduleApiName, teaser)
    : groupLabel(graph, groupOf(node), teaser);
  const meta: Array<Node | null> = [
    status.tone === 'on' || status.tone === 'off'
      ? el('span', { className: `st ${status.tone}` }, [statusMark(status), text(status.label)])
      : status.label !== '—'
        ? el('span', { className: `st ${status.tone}` }, [statusMark(status), text(status.label)])
        : null,
    node.kind !== 'module' && home && home !== ORG_WIDE && home !== SHARED
      ? badge(home)
      : home === ORG_WIDE
        ? badge(ORG_WIDE)
        : null,
    node.kind === 'function' && node.apiName
      ? el('span', { className: 'mono', text: node.apiName })
      : null,
    node.kind === 'field' && node.bucket === 'field'
      ? el('span', { className: 'mono', text: `${node.moduleApiName}.${node.fieldApiName}` })
      : null,
    rule?.rule.modifiedTime
      ? (() => {
          const d = formatModified(rule.rule.modifiedTime);
          return d ? el('span', { text: `Modified ${d}` }) : null;
        })()
      : null,
  ];
  const acts: Array<HTMLElement | null> = [
    button('wf-btn', 'Trace from here', () => env.actions.trace(node.id), [mapIcon('trace', 13)]),
    node.kind === 'field' && node.bucket === 'field'
      ? button(
          'wf-btn',
          'Show writers',
          () =>
            env.actions.openField({
              moduleApiName: node.moduleApiName as string,
              fieldApiName: node.fieldApiName,
            }),
          [mapIcon('field', 13)],
        )
      : null,
    button('wf-btn', 'Copy link', () => env.actions.copyLink(), [mapIcon('link', 13)]),
    c.m.state.view === 'list'
      ? button('wf-btn', 'Show on board', () => env.actions.showOnBoard(node.id), [
          mapIcon('board', 13),
        ])
      : button('wf-btn', 'Show in list', () => env.actions.showInList(node.id), [
          mapIcon('list', 13),
        ]),
  ];
  const head = el('div', { className: 'ins-head' }, [
    el('span', { className: 'ins-kind' }, [
      nodeIcon(node, 14),
      text(nodeKindLabel(node) + (node.kind === 'function' && node.inDegree >= 8 ? ' · hub' : '')),
    ]),
    closeButton(env),
    el('h2', {
      text:
        node.kind === 'field'
          ? nodeName(graph, node, teaser)
          : node.label || nodeName(graph, node, teaser),
    }),
    el('div', { className: 'dmeta' }, meta),
    el('div', { className: 'ins-acts' }, acts),
  ]);
  head.style.setProperty('--k', `var(${KIND_COLOR[node.kind]})`);

  let body: Array<HTMLElement | null>;
  switch (node.kind) {
    case 'rule':
      body = ruleBody(c, node);
      break;
    case 'function':
      body = functionBody(c, node);
      break;
    case 'field':
      body = fieldBody(c, node);
      break;
    case 'template':
      body = templateBody(c, node);
      break;
    case 'external':
      body = externalBody(c, node);
      break;
    case 'action':
      body = actionBody(c, node);
      break;
    case 'module':
      body = moduleBody(node);
      break;
    default:
      body = entryBody(c, node);
  }

  const zohoRule = owner.kind === 'rule' ? owner : null;
  const footer: Array<HTMLElement | null> = [];
  if (zohoRule)
    footer.push(
      button('fs-edit-button', 'Open in Zoho', () => env.actions.openRule(zohoRule.ruleId), [
        mapIcon('external', 14),
      ]),
    );
  else if (node.kind === 'function')
    footer.push(
      button('fs-edit-button', 'Open in Zoho', () => env.actions.openFunction(node.delugeId), [
        mapIcon('external', 14),
      ]),
    );
  footer.push(
    button(
      `fs-edit-button${footer.length ? ' sec2' : ''}`,
      'Trace from here',
      () => env.actions.trace(node.id),
      [mapIcon('trace', 14)],
    ),
  );

  return [
    head,
    el('div', { className: 'ins-scroll' }, body),
    el('div', { className: 'ins-foot' }, footer),
  ];
}
