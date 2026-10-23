/** Left rail (UX spec §5, §9): scope, modules, legend-as-filter, triggers, flags and search results. */
import { TRIGGER_LABELS } from '../../workflows/view-model';
import type { MapFilters, MapNodeId, SearchHit } from '../types';
import type { RegionEnv } from './actions';
import { button, captureFocus, compact, el, marked, markRanges, restoreFocus, text } from './dom';
import { quietNote, summarizeFog } from './fog-model';
import { moduleLabel, nodeName, ORG_WIDE, realFlowsText } from './format';
import { mapIcon } from './icons';
import { KIND_COLOR, KIND_PLURAL, LEGEND_ORDER, legendShape, nodeIcon } from './kinds';
import {
  allKinds,
  graphVersion,
  orderedHits,
  railCounts,
  type ShellModel,
  shownKinds,
  toggleKind,
} from './model';
import { badge, lockRow, upgradeButton } from './parts';

export interface Rail {
  el: HTMLElement;
  update(m: ShellModel): void;
  syncSelection(selectedId: MapNodeId | null): void;
  reset(): void;
}

const RESULT_LIMIT = 30;
const PROVENANCE: Record<SearchHit['matches'][number]['location'], string> = {
  name: 'in name',
  apiName: 'in API name',
  criteria: 'in criteria',
  value: 'in field update value',
  template: 'in template',
  url: 'in webhook URL',
  source: 'in code',
};
const FLAGS: Array<[MapFilters['flags'] extends ReadonlySet<infer F> ? F : never, string]> = [
  ['writesFields', 'Writes fields'],
  ['callsExternal', 'Calls external'],
  ['cascades', 'Cascades'],
  ['restApi', 'REST API functions'],
  ['gaps', 'Has gaps'],
];

const box = (on: boolean): HTMLElement =>
  el('span', { className: `box${on ? ' on' : ''}` }, on ? [mapIcon('check', 10)] : []);

const pressed = (b: HTMLElement) => b.getAttribute('aria-pressed') === 'true';

/** The option buttons of each facet group, in document order (scope, modules, kinds, triggers, flags). */
function rovingGroups(root: HTMLElement): HTMLElement[][] {
  return [...root.querySelectorAll<HTMLElement>('.fac')]
    .map((fac) => [
      ...fac.querySelectorAll<HTMLElement>('.am-scope button, button.opt, .mrow > .mtoggle'),
    ])
    .filter((group) => group.length > 1);
}

function setStop(group: HTMLElement[], stop: HTMLElement): void {
  for (const item of group) item.tabIndex = item === stop ? 0 : -1;
}

export function createRail(env: RegionEnv): Rail {
  const root = el('aside', {
    className: 'am-rail',
    attrs: { 'aria-label': 'Filters and results', id: 'am-rail' },
  });
  let sig = '';

  const apply = (build: () => Node[], key: unknown) => {
    const next = JSON.stringify(key);
    if (next === sig) return;
    sig = next;
    const scroll = root.scrollTop;
    const focused = captureFocus(env.root, root);
    root.replaceChildren(...build());
    root.scrollTop = scroll;
    for (const group of rovingGroups(root)) setStop(group, group.find(pressed) ?? group[0]);
    // Reached with the right arrow from the row's toggle, so the 9 "show on board" buttons are
    // not tab stops of their own.
    for (const fly of root.querySelectorAll<HTMLElement>('.mrow > .fly')) fly.tabIndex = -1;
    restoreFocus(root, focused, env.fallback());
  };

  // Each filter group is one tab stop; arrows move within it (the way a radio group or toolbar
  // does), so Tab crosses the rail in a handful of presses instead of forty.
  root.addEventListener('focusin', (e) => {
    const target = e.target as HTMLElement;
    const group = rovingGroups(root).find((g) => g.includes(target));
    if (group) setStop(group, target);
  });
  root.addEventListener('keydown', (e) => {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    // A module row has two buttons: right reaches "show on board", left comes back to the filter.
    const row = target.closest('.mrow');
    if (row && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const onFly = target.classList.contains('fly');
      const to =
        e.key === 'ArrowRight' && !onFly
          ? row.querySelector<HTMLElement>('.fly')
          : e.key === 'ArrowLeft' && onFly
            ? row.querySelector<HTMLElement>('.mtoggle')
            : null;
      if (to) {
        e.preventDefault();
        to.focus();
      }
      return;
    }
    const group = rovingGroups(root).find((g) => g.includes(target));
    if (!group) return;
    const at = group.indexOf(target);
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? group.length - 1
          : (at + (forward ? 1 : -1) + group.length) % group.length;
    e.preventDefault();
    setStop(group, group[next]);
    group[next].focus();
  });

  const update = (m: ShellModel) => {
    if (m.access === 'checking') {
      apply(
        () => [
          el('div', { className: 'fac' }, [
            el('span', { className: 'skel wide' }),
            el('span', { className: 'skel wide' }),
          ]),
        ],
        'checking',
      );
      return;
    }
    const searching = m.state.query.trim() !== '';
    if (m.teaser) {
      apply(
        () => teaserRail(env, m),
        ['teaser', graphVersion(m.graph), m.state.query, m.hits?.length ?? -1, m.snapshot.access],
      );
      return;
    }
    if (searching && m.hits) {
      apply(
        () => resultsRail(env, m),
        [
          m.parsed.field,
          'results',
          graphVersion(m.graph),
          m.state.query,
          m.hits.length,
          m.filters.scope,
        ],
      );
      return;
    }
    const f = m.state.filters;
    apply(
      () => facetsRail(env, m),
      [
        'facets',
        graphVersion(m.graph),
        f.scope,
        [...f.modules],
        [...f.kinds],
        [...f.triggerTypes],
        [...f.flags],
      ],
    );
  };

  const syncSelection = (selectedId: MapNodeId | null) => {
    for (const item of root.querySelectorAll<HTMLElement>('.ritem')) {
      const on = item.dataset.id === selectedId;
      item.classList.toggle('cur', on);
      if (on) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    }
  };

  return {
    el: root,
    update,
    syncSelection,
    reset: () => {
      sig = '';
      root.replaceChildren();
    },
  };
}

/* ---------- facets ---------- */

function facetsRail(env: RegionEnv, m: ShellModel): Node[] {
  const f = m.state.filters;
  const counts = railCounts(m.graph, f.scope);
  const kinds = allKinds(m.graph);
  const shown = shownKinds(f, kinds);
  const { actions } = env;

  const scope = el('div', { className: 'fac' }, [
    el('h5', { text: 'Scope' }),
    el(
      'div',
      { className: 'am-scope', attrs: { role: 'group', 'aria-label': 'Scope' } },
      (['active', 'everything'] as const).map((s) =>
        el('button', {
          type: 'button',
          text: s === 'active' ? 'Active automation' : 'Everything',
          attrs: { 'aria-pressed': String(f.scope === s), 'data-fk': `scope:${s}` },
          onClick: () => actions.setFilters({ scope: s }),
        }),
      ),
    ),
    el('p', {
      className: 'help',
      text:
        f.scope === 'active'
          ? 'Active rules, buttons, schedules, API functions and everything they reach.'
          : 'Adds inactive rules, unassociated functions and unused templates.',
    }),
  ]);

  const moduleRows = m.graph.modules.map((mod) => {
    const on = f.modules.has(mod.apiName);
    const row = el('div', { className: `opt mrow${f.modules.size && !on ? ' off' : ''}` }, [
      el(
        'button',
        {
          className: 'mtoggle',
          type: 'button',
          attrs: { 'aria-pressed': String(on), 'data-fk': `mod:${mod.apiName}` },
          onClick: () => {
            const next = new Set(f.modules);
            if (!next.delete(mod.apiName)) next.add(mod.apiName);
            actions.setFilters({ modules: next });
          },
        },
        [
          box(on),
          el('span', { className: 't', text: mod.label }),
          el('span', { className: 'n', text: String(counts.modules.get(mod.apiName) ?? 0) }),
        ],
      ),
      el(
        'button',
        {
          className: 'fly',
          type: 'button',
          title: `Fly to ${mod.label}`,
          attrs: {
            'aria-label': `Show ${mod.label} on the board`,
            'data-fk': `fly:${mod.apiName}`,
          },
          onClick: () => actions.flyToModule(mod.apiName),
        },
        [mapIcon('arrowR', 13)],
      ),
    ]);
    return row;
  });
  const modules = el('div', { className: 'fac' }, [
    el('h5', {}, [
      text('Modules'),
      f.modules.size
        ? button('wf-btn link clr', 'Clear', () => actions.setFilters({ modules: new Set() }), [], {
            attrs: { 'data-fk': 'clr:mods' },
          })
        : null,
    ]),
    ...moduleRows,
    counts.orgWide
      ? el(
          'div',
          {
            className: 'opt static',
            title: 'Entry points and shared resources that belong to no module',
          },
          [
            el('span', { className: 'box ghost' }),
            el('span', { className: 't', text: ORG_WIDE }),
            el('span', { className: 'n', text: String(counts.orgWide) }),
          ],
        )
      : null,
  ]);

  const legend = el('div', { className: 'fac' }, [
    el('h5', {}, [text('Show'), el('span', { className: 'sub', text: 'legend' })]),
    ...LEGEND_ORDER.filter((k) => kinds.includes(k)).map((k) => {
      const on = shown.has(k);
      const row = el(
        'button',
        {
          className: `opt${on ? '' : ' off'}`,
          type: 'button',
          attrs: { 'aria-pressed': String(on), 'data-fk': `kind:${k}` },
          onClick: () => {
            const next = toggleKind(f, k, kinds);
            if (next) actions.setFilters({ kinds: next });
            else actions.toast('At least one kind has to stay visible.');
          },
        },
        [
          legendShape(k),
          el('span', { className: 't', text: KIND_PLURAL[k] }),
          el('span', { className: 'n', text: String(counts.kinds.get(k) ?? 0) }),
        ],
      );
      return row;
    }),
  ]);

  const triggerTypes = [...counts.triggers.keys(), ...f.triggerTypes].filter(
    (t, i, all) => all.indexOf(t) === i,
  );
  const triggers = triggerTypes.length
    ? el('div', { className: 'fac' }, [
        el('h5', {}, [
          text('Triggers'),
          f.triggerTypes.size
            ? button(
                'wf-btn link clr',
                'Clear',
                () => actions.setFilters({ triggerTypes: new Set() }),
                [],
                { attrs: { 'data-fk': 'clr:trig' } },
              )
            : null,
        ]),
        ...triggerTypes.map((t) => {
          const on = f.triggerTypes.has(t as never);
          return el(
            'button',
            {
              className: 'opt',
              type: 'button',
              attrs: { 'aria-pressed': String(on), 'data-fk': `trig:${t}` },
              onClick: () => {
                const next = new Set(f.triggerTypes);
                if (!next.delete(t as never)) next.add(t as never);
                actions.setFilters({ triggerTypes: next });
              },
            },
            [
              box(on),
              el('span', {
                className: 't',
                text: TRIGGER_LABELS[t as keyof typeof TRIGGER_LABELS] ?? t,
              }),
              el('span', { className: 'n', text: String(counts.triggers.get(t) ?? 0) }),
            ],
          );
        }),
      ])
    : null;

  const flags = el('div', { className: 'fac' }, [
    el('h5', { text: 'Only' }),
    ...FLAGS.map(([flag, label]) => {
      const on = f.flags.has(flag);
      return el(
        'button',
        {
          className: 'opt',
          type: 'button',
          attrs: { 'aria-pressed': String(on), 'data-fk': `flag:${flag}` },
          onClick: () => {
            const next = new Set(f.flags);
            if (!next.delete(flag)) next.add(flag);
            actions.setFilters({ flags: next });
          },
        },
        [box(on), el('span', { className: 't', text: label })],
      );
    }),
  ]);
  const empty = m.graph.modules.length === 0 && kinds.length === 0;
  return compact([scope, empty ? null : modules, empty ? null : legend, triggers, flags]);
}

/* ---------- results ---------- */

function provenance(hit: SearchHit): Node {
  const match = hit.matches[0];
  const where =
    match.location === 'source' && match.line
      ? `in code · line ${match.line}`
      : PROVENANCE[match.location];
  const nodes: Node[] = [el('span', { className: 'where', text: where })];
  if (match.location !== 'name' && match.snippet) {
    const snippet = match.snippet.trim();
    const lead = match.snippet.length - match.snippet.trimStart().length;
    const ranges = match.highlights
      .map((h) => ({ start: h.start - lead, end: h.end - lead }))
      .filter((h) => h.end > 0);
    nodes.push(...markRanges(snippet, ranges));
  }
  return el('span', { className: 'prov' }, nodes);
}

function resultItem(
  env: RegionEnv,
  m: ShellModel,
  hit: SearchHit,
  selectedId: MapNodeId | null,
): HTMLElement | null {
  const node = m.graph.nodes.get(hit.nodeId);
  if (!node) return null;
  const query = m.parsed.text;
  const item = el(
    'button',
    {
      className: `ritem${selectedId === node.id ? ' cur' : ''}`,
      type: 'button',
      dataset: { id: node.id },
      onClick: () => env.actions.openResult(node.id),
    },
    [
      el('span', { className: 'r1' }, [
        (() => {
          const ic = el('span', { className: 'ric' }, [nodeIcon(node, 15)]);
          ic.style.setProperty('--k', `var(${KIND_COLOR[node.kind]})`);
          return ic;
        })(),
        el('span', { className: 'rnm' }, marked(nodeName(m.graph, node, m.teaser), query)),
        node.moduleApiName && node.kind !== 'field'
          ? badge(moduleLabel(m.graph, node.moduleApiName, m.teaser))
          : null,
      ]),
      provenance(hit),
    ],
  );
  item.addEventListener('keydown', (e) => {
    const all = [...(item.closest('.am-rail')?.querySelectorAll<HTMLElement>('.ritem') ?? [])];
    const i = all.indexOf(item);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (all[i + 1] ?? item).focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i <= 0) env.actions.focusSearch();
      else all[i - 1].focus();
    }
  });
  return item;
}

function resultsRail(env: RegionEnv, m: ShellModel): Node[] {
  const hits = orderedHits(m.graph, m.hits ?? []);
  const groups = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const kind = m.graph.nodes.get(hit.nodeId)?.kind;
    if (!kind) continue;
    groups.set(kind, [...(groups.get(kind) ?? []), hit]);
  }
  const header = el('div', { className: 'rail-results' }, [
    button('wf-btn link back', 'Filters', () => env.actions.setQuery(''), [mapIcon('back', 12)], {
      attrs: { 'data-fk': 'results-back' },
    }),
    el('h4', {}, [text(`Results for "${m.state.query.trim()}" `), badge(String(hits.length))]),
  ]);
  if (m.parsed.field) {
    const ref = m.parsed.field;
    const node = m.graph.nodes.get(`field:${ref.moduleApiName}.${ref.fieldApiName}`);
    header.append(
      el(
        'button',
        {
          className: 'ritem field-open',
          type: 'button',
          onClick: () => env.actions.openField(ref),
          attrs: { 'data-fk': 'open-lens' },
        },
        [
          el('span', { className: 'r1' }, [
            mapIcon('field', 15),
            el('span', {
              className: 'rnm',
              text: `Open field lens · ${moduleLabel(m.graph, ref.moduleApiName, false)} › ${node?.kind === 'field' ? node.label : ref.fieldApiName}`,
            }),
          ]),
          el('span', { className: 'prov' }, [
            el('span', { className: 'where', text: 'field: prefix' }),
            text('Enter opens it'),
          ]),
        ],
      ),
    );
  }
  if (hits.length === 0) {
    const cov = m.snapshot.coverage;
    const unreadable = cov.functions.sourceUnavailable + cov.functions.failed;
    const incomplete = !cov.isComplete || unreadable > 0;
    header.append(
      el('div', { className: 'lens-empty' }, [
        text(
          m.parsed.unresolved
            ? `No module or kind matches that prefix in "${m.state.query.trim()}".`
            : `No matches for "${m.state.query.trim()}" in the mapped automation.`,
        ),
        incomplete
          ? text(
              unreadable
                ? ` ${unreadable} function${unreadable === 1 ? '' : 's'} could not be read, so their code is not searchable.`
                : ' Mapping is not complete yet, so more matches may appear.',
            )
          : null,
      ]),
    );
    return [header];
  }
  const out: Node[] = [header];
  const order = ['field', ...LEGEND_ORDER.filter((k) => k !== 'field'), 'module'];
  for (const kind of order) {
    const list = groups.get(kind);
    if (!list) continue;
    const label = kind === 'module' ? 'Modules' : KIND_PLURAL[kind as keyof typeof KIND_PLURAL];
    out.push(
      el('div', { className: 'rgroup' }, [
        el('h5', {}, [
          kind === 'module' ? null : legendShape(kind as never),
          text(label),
          el('span', { className: 'n', text: String(list.length) }),
        ]),
        ...compact(
          list.slice(0, RESULT_LIMIT).map((h) => resultItem(env, m, h, m.state.selectedId)),
        ),
        list.length > RESULT_LIMIT
          ? el('div', {
              className: 'lens-empty small',
              text: `+${list.length - RESULT_LIMIT} more — narrow the search`,
            })
          : null,
      ]),
    );
  }
  return out;
}

/* ---------- teaser ---------- */

function teaserRail(env: RegionEnv, m: ShellModel): Node[] {
  const t = m.snapshot.teaser;
  const searching = m.state.query.trim() !== '';
  if (searching) {
    const hits = orderedHits(m.graph, m.hits ?? []);
    const header = el('div', { className: 'rail-results' }, [
      button('wf-btn link back', 'Preview', () => env.actions.setQuery(''), [mapIcon('back', 12)], {
        attrs: { 'data-fk': 'results-back' },
      }),
      el('h4', { text: `Results for "${m.state.query.trim()}"` }),
      // A constant message: any count of fogged matches would let names be rebuilt keystroke by keystroke.
      el('p', {
        className: 'help flat',
        text: `${hits.length} match${hits.length === 1 ? '' : 'es'} in your preview`,
      }),
      ...compact(hits.slice(0, RESULT_LIMIT).map((h) => resultItem(env, m, h, m.state.selectedId))),
      lockRow(env, [
        el('b', {
          text: `Pro searches all ${t?.totals.rules ?? 0} rules and ${t?.totals.functions ?? 0} functions`,
        }),
        el('br'),
        text('Names, criteria, templates, webhooks and every line of code.'),
      ]),
    ]);
    return [header];
  }
  const revealed = m.graph.modules;
  // Largest first; modules without automation are one note, not rows of zeros.
  const { areas: fogged, quiet } = t ? summarizeFog(t) : { areas: [], quiet: 0 };
  const shownFog = fogged.slice(0, 10);
  const out: Node[] = compact([
    el('div', { className: 'fac' }, [
      el('h5', { text: 'Preview' }),
      el('p', {
        className: 'help flat',
        text: revealed.length
          ? `You're seeing ${realFlowsText(m.flowsShown)}, built from a handful of reads. Everything else is in the fog.`
          : 'Upgrade to Pro to map your org.',
      }),
      upgradeButton(env),
    ]),
    el('div', { className: 'fac' }, [
      el('h5', { text: 'Modules' }),
      ...revealed.map((mod) =>
        el('div', { className: 'opt mrow' }, [
          el(
            'button',
            {
              className: 'mtoggle',
              type: 'button',
              onClick: () => env.actions.flyToModule(mod.apiName),
              attrs: { 'data-fk': `fly:${mod.apiName}` },
            },
            [
              box(true),
              el('span', { className: 't', text: mod.label }),
              el('span', { className: 'n', text: 'preview' }),
            ],
          ),
        ]),
      ),
      ...shownFog.map((island, i) =>
        el(
          'button',
          {
            className: 'opt locked',
            type: 'button',
            title: 'Upgrade to Pro to see this module',
            onClick: () => env.actions.upgrade(),
            attrs: { 'data-fk': `fog:${i}` },
          },
          [
            mapIcon('lock', 13),
            el('span', { className: 't', text: `Module ${i + 1}` }),
            el('span', {
              className: 'n',
              text: `${island.counts.rules + island.counts.functions}`,
            }),
          ],
        ),
      ),
      fogged.length > shownFog.length
        ? el('div', {
            className: 'lens-empty small',
            text: `+${fogged.length - shownFog.length} more modules in the fog`,
          })
        : null,
      quiet > 0 ? el('div', { className: 'lens-empty small', text: quietNote(quiet) }) : null,
    ]),
    el('div', { className: 'fac' }, [
      el('h5', { text: 'In this org' }),
      ...(
        [
          ['rule', t?.totals.rules ?? 0, KIND_PLURAL.rule],
          ['function', t?.totals.functions ?? 0, KIND_PLURAL.function],
        ] as const
      ).map(([kind, n, label]) =>
        el('div', { className: 'opt static' }, [
          legendShape(kind),
          el('span', { className: 't', text: label }),
          el('span', { className: 'n', text: String(n) }),
        ]),
      ),
      el('div', { className: 'opt static' }, [
        mapIcon('module', 14),
        el('span', { className: 't', text: 'Modules' }),
        el('span', { className: 'n', text: String(t?.totals.modules ?? 0) }),
      ]),
      el('p', {
        className: 'help',
        text: 'Totals come from your rule list and function catalogue. Filters, triggers and flags unlock with Pro.',
      }),
    ]),
  ]);
  return out;
}
