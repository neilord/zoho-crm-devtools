/** Fields view (UX spec §7): the start screen and the field lens with its evidence-tier edges. */

import { describeTrigger, formatValue, predicateText } from '../../workflows/view-model';
import type { FieldLens, FieldNode, MapNode } from '../types';
import type { FieldRef, RegionEnv } from './actions';
import type { MostWrittenField } from './context';
import { button, cssEscape, el, marked, observeResize, svgEl, text } from './dom';
import { moduleLabel } from './format';
import { mapIcon } from './icons';
import { KIND_COLOR, kindIcon, OP_LABEL } from './kinds';
import {
  buildLensModel,
  type CatalogueField,
  cascadeText,
  fieldCatalogue,
  type LensModel,
  type PathChip,
  type ReactorEntry,
  type WriterEntry,
  type WriterGroup,
} from './lens-model';
import { coverageView, estateTotals, filtersKey, graphVersion, type ShellModel } from './model';
import { badge, kindTile, note, upgradeButton, warnBox } from './parts';

export interface FieldsView {
  el: HTMLElement;
  update(m: ShellModel): void;
  /** Re-draws connector lines (selection, resize, sticky card moves). */
  redraw(): void;
  reset(): void;
  dispose(): void;
}

export function createFieldsView(env: RegionEnv): FieldsView {
  const host = el('div', {
    className: 'am-view am-lens',
    // Focus lands here after a view switch so the shortcuts keep working; it is not a tab stop.
    attrs: { id: 'am-fields', tabindex: '-1', 'data-focus-target': 'view' },
  });
  let lastSig = '';
  let lastKey = '';
  let drawFrame = 0;
  let stopResize = () => {};
  const catalogueCache: { version: number; teaser: boolean; list: CatalogueField[] } = {
    version: -1,
    teaser: false,
    list: [],
  };
  const catalogue = (m: ShellModel): CatalogueField[] => {
    const version = graphVersion(m.graph);
    if (catalogueCache.version !== version || catalogueCache.teaser !== m.teaser) {
      catalogueCache.version = version;
      catalogueCache.teaser = m.teaser;
      catalogueCache.list = fieldCatalogue(m.graph, m.teaser);
    }
    return catalogueCache.list;
  };
  // One ranking per graph and filter set feeds the chips and the picker, and it is the lens's own
  // writer count, so a chip's number is the number you see after clicking it.
  const rankedCache: { key: string; ranked: readonly MostWrittenField[] } = {
    key: '',
    ranked: [],
  };
  const ranked = (m: ShellModel): readonly MostWrittenField[] => {
    const key = `${graphVersion(m.graph)}|${filtersKey(m.filters)}`;
    if (rankedCache.key !== key) {
      rankedCache.key = key;
      rankedCache.ranked = safeRanking(env, m);
    }
    return rankedCache.ranked;
  };

  const redraw = () => {
    if (drawFrame) return;
    drawFrame = requestAnimationFrame(() => {
      drawFrame = 0;
      drawEdges(host);
    });
  };
  host.addEventListener('scroll', redraw, { passive: true });
  stopResize = observeResize(host, redraw);

  const update = (m: ShellModel) => {
    if (m.access === 'checking') return;
    const ref = activeField(m);
    const query = m.parsed.text;
    const loading = coverageView(m.snapshot).loading;
    const sig = JSON.stringify([
      graphVersion(m.graph),
      ref,
      m.filters.scope,
      query,
      [...env.ui.expandedPaths],
      [...env.ui.expandedGroups],
      filtersKey(m.filters),
      m.snapshot.coverage.gaps,
      env.ui.lensTrail,
      m.teaser,
      loading,
      m.snapshot.coverage.functions.pending,
      m.hitIds ? m.hitIds.size : -1,
    ]);
    if (sig === lastSig) return;
    lastSig = sig;
    const key = ref ? `${ref.moduleApiName}.${ref.fieldApiName}` : '';
    const keepScroll = key === lastKey;
    const scroll = host.scrollTop;
    lastKey = key;
    const focused = env.root.activeElement as HTMLElement | null;
    const refocus = focused && host.contains(focused) ? focused.dataset.fk : undefined;
    host.replaceChildren(
      ref ? renderLens(env, m, ref) : renderStart(env, m, catalogue(m), ranked(m)),
    );
    host.scrollTop = keepScroll ? scroll : 0;
    if (refocus) host.querySelector<HTMLElement>(`[data-fk="${cssEscape(refocus)}"]`)?.focus();
    redraw();
  };

  return {
    el: host,
    update,
    redraw,
    reset: () => {
      lastSig = '';
      lastKey = '';
      host.replaceChildren();
    },
    dispose: () => {
      stopResize();
      if (drawFrame) cancelAnimationFrame(drawFrame);
    },
  };
}

/** The lens target, ignoring a stale target the (teaser) graph does not contain. */
function activeField(m: ShellModel): FieldRef | null {
  const ref = m.state.field;
  if (!ref) return null;
  if (m.teaser && !m.graph.nodes.has(`field:${ref.moduleApiName}.${ref.fieldApiName}`)) return null;
  return ref;
}

/* ====================================================================== start screen */

function estateLine(m: ShellModel): HTMLElement {
  const t = m.snapshot.teaser?.totals;
  const parts: Array<[number, string]> =
    m.teaser && t
      ? [
          [t.rules, 'rules'],
          [t.functions, 'functions'],
          [t.modules, 'modules'],
        ]
      : (() => {
          const e = estateTotals(m.graph, m.snapshot.coverage.modules);
          return [
            [e.rules, `rules (${e.activeRules} active)`],
            [e.functions, 'functions'],
            [e.buttons, 'buttons'],
            [e.schedules, 'schedules'],
            [e.apiFunctions, 'API functions'],
            [e.modules, 'modules'],
          ] as Array<[number, string]>;
        })();
  const nodes: Node[] = [];
  parts.forEach(([n, label], i) => {
    if (i) nodes.push(text(' · '));
    nodes.push(el('b', { text: String(n) }), text(` ${label}`));
  });
  return el('div', { className: 'estate' }, nodes);
}

function safeRanking(env: RegionEnv, m: ShellModel): readonly MostWrittenField[] {
  try {
    // Every ranked field: the picker's counts come from the same call as the chips.
    return env.port.mostWrittenFields(m.filters, Number.MAX_SAFE_INTEGER);
  } catch (error) {
    console.error('Zoho CRM DevTools: Automation Map most-written fields failed', error);
    return [];
  }
}

function renderStart(
  env: RegionEnv,
  m: ShellModel,
  cat: CatalogueField[],
  ranking: readonly MostWrittenField[],
): HTMLElement {
  const root = el('div', { className: 'lens-start' }, [
    el('h1', { text: 'What can change a field?' }),
    el('p', {
      className: 'lead',
      text: 'Pick a field to see every rule, function, button, schedule and API entry point that can write it, and what reacts when it changes.',
    }),
  ]);
  if (m.teaser) {
    const chips = cat.filter((f) => f.writers > 0 || f.reactors > 0).slice(0, 8);
    root.append(
      el('div', { className: 'fpick' }, [
        el('label', { className: 'inp' }, [
          mapIcon('lock', 18),
          el('input', {
            attrs: {
              type: 'text',
              disabled: '',
              placeholder: 'Search every field with Pro',
              'aria-label': 'Field search is a Pro feature',
            },
          }),
        ]),
      ]),
      el('div', { className: 'hot' }, [
        el('span', { className: 'lab', text: 'In your preview' }),
        ...(chips.length
          ? chips.map((f) => hotChip(env, f, false))
          : [
              el('span', {
                className: 'estate',
                text: 'No fields are touched by the preview flow.',
              }),
            ]),
      ]),
      el('div', { className: 'fogtext' }, [
        mapIcon('lock', 14),
        text(' '),
        el('b', { text: 'Every field, writer and reactor is a Pro feature.' }),
        text(
          ' Pro shows which rules, functions, buttons, schedules and API entry points can write each field.',
        ),
        el('br'),
        upgradeButton(env),
      ]),
      estateLine(m),
    );
    return root;
  }
  const counts = new Map(ranking.map((r) => [r.field.id, r.count]));
  const counted = cat.map((f) => ({ ...f, writers: counts.get(f.id) ?? 0 }));
  const hot: CatalogueField[] = ranking.slice(0, 6).map(({ field, count }) => {
    const moduleApiName = field.moduleApiName as string;
    return {
      id: field.id,
      moduleApiName,
      fieldApiName: field.fieldApiName,
      label: field.label,
      moduleName: moduleLabel(m.graph, moduleApiName, false),
      writers: count,
      reactors: 0,
    };
  });
  root.append(
    createFieldPicker(env, m, counted),
    el('div', { className: 'hot' }, [
      el('span', { className: 'lab', text: 'Most-written fields' }),
      ...(hot.length
        ? hot.map((f) => hotChip(env, f, true))
        : [el('span', { className: 'estate', text: 'No field writes found yet.' })]),
    ]),
    el('div', { className: 'qs' }, [
      m.graph.nodes.has('module:Deals')
        ? qcard(
            env,
            'deals-edit',
            'trigger',
            'What runs when a Deal is edited?',
            'Board · Deals · Edit and field-change triggers',
          )
        : null,
      qcard(
        env,
        'external',
        'globe',
        'Which automations call external systems?',
        'List · filtered to "Calls external"',
      ),
      qcard(env, 'loops', 'loop', 'Where could automation loop?', 'List · filtered to "Cascades"'),
      qcard(env, 'map', 'map', 'Show me the whole map', 'Board · overview of every module'),
    ]),
    estateLine(m),
  );
  return root;
}

function qcard(
  env: RegionEnv,
  id: 'deals-edit' | 'external' | 'loops' | 'map',
  icon: Parameters<typeof mapIcon>[0],
  title: string,
  sub: string,
): HTMLElement {
  return el(
    'button',
    { className: 'qcard', type: 'button', onClick: () => env.actions.starter(id) },
    [
      el('span', { className: 'qi' }, [mapIcon(icon, 18)]),
      el('span', {}, [
        el('span', { className: 'qt', text: title }),
        el('span', { className: 'qsub', text: sub }),
      ]),
    ],
  );
}

function hotChip(env: RegionEnv, f: CatalogueField, withCount: boolean): HTMLElement {
  return el(
    'button',
    {
      className: 'hotchip',
      type: 'button',
      onClick: () =>
        env.actions.openField({ moduleApiName: f.moduleApiName, fieldApiName: f.fieldApiName }),
    },
    [
      el('span', { className: 'm', text: `${f.moduleName} ·` }),
      text(` ${f.label} `),
      withCount ? el('span', { className: 'n', text: String(f.writers) }) : null,
    ],
  );
}

/** Combobox over the fields that automation touches (UX spec §7.1). */
function createFieldPicker(env: RegionEnv, m: ShellModel, cat: CatalogueField[]): HTMLElement {
  const input = el('input', {
    attrs: {
      type: 'text',
      placeholder: 'Search fields, e.g. Deals Stage',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-controls': 'am-fdd',
      'aria-autocomplete': 'list',
      'aria-label': 'Pick a field',
      autocomplete: 'off',
      spellcheck: 'false',
      'data-fk': 'field-picker',
    },
  });
  const dd = el('div', {
    className: 'dd',
    attrs: { id: 'am-fdd', role: 'listbox', 'aria-label': 'Fields' },
  });
  dd.hidden = true;
  let list: CatalogueField[] = [];
  let cur = 0;
  const moduleOrder = new Map(m.graph.modules.map((mod, i) => [mod.apiName, i]));

  const close = () => {
    dd.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const choose = (f: CatalogueField) => {
    close();
    env.actions.openField({ moduleApiName: f.moduleApiName, fieldApiName: f.fieldApiName });
  };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    list = cat
      .filter(
        (f) =>
          !q ||
          `${f.moduleName} ${f.label} ${f.fieldApiName}`.toLowerCase().includes(q) ||
          `${f.moduleApiName}.${f.fieldApiName}`.toLowerCase().includes(q),
      )
      .slice(0, q ? 80 : 40)
      .sort(
        (a, b) =>
          (moduleOrder.get(a.moduleApiName) ?? 99) - (moduleOrder.get(b.moduleApiName) ?? 99) ||
          b.writers - a.writers ||
          a.label.localeCompare(b.label),
      );
    cur = Math.min(cur, Math.max(0, list.length - 1));
    const nodes: Node[] = [];
    let lastModule: string | null = null;
    list.forEach((f, i) => {
      if (f.moduleApiName !== lastModule) {
        lastModule = f.moduleApiName;
        nodes.push(
          el('div', { className: 'grp', text: f.moduleName, attrs: { role: 'presentation' } }),
        );
      }
      const opt = el(
        'div',
        {
          className: `opt2${i === cur ? ' cur' : ''}`,
          attrs: { role: 'option', id: `am-fopt-${i}`, 'aria-selected': String(i === cur) },
        },
        [
          mapIcon('field', 15),
          el('b', {}, marked(f.label, input.value.trim())),
          el('span', { className: 'ty', text: f.fieldApiName }),
          el('span', {
            className: 'wc',
            text: f.writers
              ? `${f.writers} writer${f.writers === 1 ? '' : 's'}`
              : 'no known writers',
          }),
        ],
      );
      // mousedown, not click: the input must keep focus until the choice is made.
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(f);
      });
      nodes.push(opt);
    });
    if (!list.length) nodes.push(el('div', { className: 'grp', text: 'No fields match' }));
    dd.replaceChildren(...nodes);
    dd.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (list.length) input.setAttribute('aria-activedescendant', `am-fopt-${cur}`);
    dd.querySelector('.opt2.cur')?.scrollIntoView?.({ block: 'nearest' });
  };
  // Opening on focus would hide the starter content the moment the map opens.
  input.addEventListener('click', () => {
    if (dd.hidden) draw();
  });
  input.addEventListener('input', () => {
    cur = 0;
    draw();
  });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (dd.hidden) cur = 0;
      else cur = Math.min(list.length - 1, cur + 1);
      draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cur = Math.max(0, cur - 1);
      draw();
    } else if (e.key === 'Enter' && list[cur] && !dd.hidden) {
      e.preventDefault();
      e.stopPropagation();
      choose(list[cur]);
    } else if (e.key === 'Escape' && !dd.hidden) {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  });
  return el('div', { className: 'fpick' }, [
    el('label', { className: 'inp' }, [
      mapIcon('field', 18),
      input,
      el('span', { className: 'kbd', text: '↵' }),
    ]),
    dd,
  ]);
}

/* ====================================================================== lens */

const OP_BADGE_CLASS: Record<string, string> = {
  create: 'create',
  upsert: 'upsert',
  convert: 'convert',
};

function chip(c: PathChip): HTMLElement {
  const span = el('span', { className: 'pc', title: c.title }, [
    c.kind === 'trigger'
      ? mapIcon('trigger', 12)
      : c.kind === 'restApi'
        ? mapIcon('plug', 12)
        : kindIcon(c.kind, 12),
    text(c.label),
  ]);
  const color =
    c.kind === 'trigger'
      ? '--am-k-event'
      : c.kind === 'restApi'
        ? '--am-k-api'
        : KIND_COLOR[c.kind];
  span.style.setProperty('--k', `var(${color})`);
  return span;
}

function chipTrail(chips: PathChip[]): Node[] {
  const shown =
    chips.length > 4 ? [chips[0], null, chips[chips.length - 2], chips[chips.length - 1]] : chips;
  const out: Node[] = [];
  shown.forEach((c, i) => {
    if (i) out.push(el('span', { className: 'sep', text: '›' }));
    out.push(c ? chip(c) : el('span', { className: 'sep', text: '…' }));
  });
  return out;
}

function pathBlock(env: RegionEnv, entry: WriterEntry): HTMLElement | null {
  if (!entry.paths.length) {
    return entry.source.kind === 'function'
      ? el('div', { className: 'path' }, [
          el('span', { className: 'muted', text: 'Not called by any indexed automation' }),
        ])
      : null;
  }
  const expanded = env.ui.expandedPaths.has(entry.edge.id);
  const first = entry.paths[0];
  const nodes: Node[] = chipTrail(first);
  const wrap = el('div', { className: 'path' }, nodes);
  if (entry.paths.length > 1) {
    wrap.append(
      el('span', { className: 'sep', text: '·' }),
      el(
        'button',
        {
          className: 'pmore',
          type: 'button',
          attrs: { 'aria-expanded': String(expanded), 'data-fk': `paths:${entry.edge.id}` },
          onClick: (e) => {
            e.stopPropagation();
            if (!env.ui.expandedPaths.delete(entry.edge.id))
              env.ui.expandedPaths.add(entry.edge.id);
            env.actions.refresh();
          },
        },
        [
          text(`${entry.paths.length} entry points`),
          mapIcon(expanded ? 'chevron' : 'chevronR', 11),
        ],
      ),
    );
  }
  if (!expanded) return wrap;
  return el('div', {}, [
    wrap,
    ...entry.paths.slice(1).map((p) => el('div', { className: 'path sub' }, chipTrail(p))),
  ]);
}

function valueText(m: ShellModel, entry: WriterEntry): Node {
  const { source, edge } = entry;
  const target = m.graph.nodes.get(edge.to) as FieldNode | undefined;
  if (source.kind === 'transition')
    return el('span', { text: 'Value entered by the user during the transition' });
  if (source.kind === 'action') {
    const a = source.action;
    let value: unknown;
    if (a.kind === 'fieldUpdate') value = a.value;
    else if (a.kind === 'task' || a.kind === 'convert')
      value = a.fieldMappings.find((x) => x.field.apiName === target?.fieldApiName)?.value;
    const shown = formatValue(value);
    return shown
      ? el('span', {
          className: 'val',
          text: `= ${shown.length > 60 ? `${shown.slice(0, 58)}…` : shown}`,
        })
      : el('span', { text: 'Value set by the action' });
  }
  const line = entry.lines.length
    ? ` · line${entry.lines.length > 1 ? 's' : ''} ${entry.lines.slice(0, 3).join(', ')}`
    : '';
  if (entry.group === 'recordChanges')
    return el('span', { text: `Changes the record without setting field values${line}` });
  if (entry.group === 'unknownFields')
    return el('span', { text: `Fields come from data the analyser cannot read${line}` });
  if (entry.group === 'unresolved')
    return el('span', { text: `Module, record and fields come from input${line}` });
  if (entry.group === 'partial')
    return el('span', {
      text: entry.foreign
        ? `Destination org unknown${line}`
        : `Known key; may also write fields it could not name${line}`,
    });
  return el('span', { text: `Value set in code${line}` });
}

function writerCard(env: RegionEnv, m: ShellModel, entry: WriterEntry): HTMLElement {
  const { source, edge } = entry;
  const owner = source.kind === 'action' ? (m.graph.nodes.get(source.ownerId) ?? source) : source;
  const isInput = source.kind === 'transition';
  const op = isInput ? 'During input' : edge.operation ? OP_LABEL[edge.operation] : 'Update';
  const tierChip =
    entry.group === 'exact'
      ? el('span', { className: 'conf exact', text: 'exact' })
      : entry.group === 'partial'
        ? el('span', { className: 'conf partial', text: 'partial' })
        : entry.group === 'unknownFields' || entry.group === 'unresolved'
          ? el('span', { className: 'conf unknown', text: 'unresolved' })
          : null;
  const cascade = cascadeText(entry.cascade);
  const recordOnly = entry.group === 'recordChanges';
  const query = m.parsed.text;
  const matched = m.hitIds ? m.hitIds.has(entry.selectId) || m.hitIds.has(source.id) : false;
  const card = el(
    'div',
    {
      // A record-only change is listed for context, not wired to the field card as a writer.
      className: `wcard${matched ? ' match' : ''}${recordOnly ? ' nolink' : ''}`,
      attrs: { role: 'button', tabindex: '0', 'data-tier': entry.tier },
      dataset: { sel: entry.selectId, edge: edge.id },
    },
    [
      el('div', { className: 'w1' }, [
        kindTile(source.kind === 'action' ? ({ ...owner } as MapNode) : source),
        el('span', { className: 'nm', title: owner.label }, marked(owner.label, query)),
        el('span', { className: 'sp' }),
        el('span', { className: `op ${OP_BADGE_CLASS[edge.operation ?? ''] ?? ''}`, text: op }),
        tierChip,
      ]),
      pathBlock(env, entry),
      el('div', { className: 'w3' }, [
        valueText(m, entry),
        owner.active === false ? badge('Inactive') : null,
        m.filters.scope === 'everything' && !entry.reached
          ? badge('Not reached by active automation')
          : null,
        recordOnly
          ? null
          : el('span', { className: `cascnote ${cascade.tone}` }, [
              cascade.tone === 'muted' ? null : mapIcon('loop', 12),
              text(cascade.text),
            ]),
      ]),
    ],
  );
  card.style.setProperty(
    '--k',
    `var(${KIND_COLOR[source.kind === 'action' ? owner.kind : source.kind]})`,
  );
  const activate = () =>
    env.actions.select(entry.selectId, { evidence: { nodeId: source.id, edgeId: edge.id } });
  card.addEventListener('click', activate);
  card.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === card) {
      e.preventDefault();
      activate();
    }
  });
  return card;
}

function criteriaSnippet(entry: ReactorEntry, fieldApiName: string): string | null {
  const rule = entry.rule.rule;
  if (entry.group === 'trigger') return rule.trigger ? describeTrigger(rule.trigger, rule) : null;
  for (const cond of rule.conditions) {
    const leaf = flattenLeaves(cond.criteria).find((l) => l.field.apiName === fieldApiName);
    if (leaf) return predicateText(leaf);
  }
  return null;
}

function flattenLeaves(
  c: import('../../workflows/types').WorkflowCriteria | null,
): Array<Extract<import('../../workflows/types').WorkflowCriteria, { kind: 'predicate' }>> {
  if (!c) return [];
  if (c.kind === 'predicate') return [c];
  return c.kind === 'group' ? c.children.flatMap(flattenLeaves) : [];
}

function reactorCard(
  env: RegionEnv,
  m: ShellModel,
  entry: ReactorEntry,
  lens: LensModel,
): HTMLElement {
  const query = m.parsed.text;
  const snippet = criteriaSnippet(entry, lens.fieldApiName);
  const matched = m.hitIds ? m.hitIds.has(entry.rule.id) : false;
  const chips = entry.effects.map((fx) => {
    const cls = fx.loop
      ? 'eff loop'
      : fx.cascade === 'possible' && fx.cross
        ? 'eff casc'
        : fx.cascade === 'unknown'
          ? 'eff unk'
          : 'eff';
    const label = `${fx.loop ? '↻ ' : '→ '}${fx.cross ? `${moduleOf(m, fx)} · ` : ''}${fx.label}${fx.loop ? ' (loop)' : ''}`;
    if (!fx.pivot)
      return el('span', {
        className: 'eff x',
        title: 'Fields the analyser could not name',
        text: `→ ${fx.label}`,
      });
    const pivot = fx.pivot;
    return el('button', {
      className: cls,
      type: 'button',
      title:
        fx.cascade === 'unknown'
          ? `${fx.via ?? 'Declared write'} · re-trigger behaviour unverified`
          : `Open the field lens for ${fx.label}`,
      text: label,
      onClick: (e) => {
        e.stopPropagation();
        env.actions.openField(pivot, { pivot: true });
      },
    });
  });
  const card = el(
    'div',
    {
      className: `wcard rcard${matched ? ' match' : ''}`,
      attrs: {
        role: 'button',
        tabindex: '0',
        'data-tier': entry.group === 'criteria' ? 'crit' : 'declared',
      },
      dataset: { sel: entry.rule.id },
    },
    [
      el('div', { className: 'w1' }, [
        kindTile(entry.rule),
        el('span', { className: 'nm', title: entry.rule.label }, marked(entry.rule.label, query)),
        el('span', { className: 'sp' }),
        entry.rule.active === false ? badge('Inactive') : null,
      ]),
      snippet
        ? el('div', { className: 'path' }, [
            el('span', { className: 'pc', title: snippet }, [
              mapIcon('trigger', 12),
              text(snippet.length > 56 ? `${snippet.slice(0, 54)}…` : snippet),
            ]),
          ])
        : null,
      el(
        'div',
        { className: 'effects' },
        chips.length
          ? [
              ...chips,
              entry.extraEffects
                ? el('span', { className: 'eff none', text: `+${entry.extraEffects} more` })
                : null,
            ]
          : [
              el('span', {
                className: 'eff none',
                text: m.teaser ? 'Effects are in the fog' : 'No field writes',
              }),
            ],
      ),
    ],
  );
  card.style.setProperty('--k', 'var(--am-k-rule)');
  const activate = () => env.actions.select(entry.rule.id);
  card.addEventListener('click', activate);
  card.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === card) {
      e.preventDefault();
      activate();
    }
  });
  return card;
}

function moduleOf(m: ShellModel, fx: { targetId: string }): string {
  const node = m.graph.nodes.get(fx.targetId);
  return node?.kind === 'field' && node.moduleApiName
    ? (m.graph.nodes.get(`module:${node.moduleApiName}`)?.label ??
        (m.teaser ? 'Another module' : node.moduleApiName))
    : 'Unknown module';
}

const TIER_SVG = {
  declared: () =>
    svgEl('svg', { width: 26, height: 8, 'aria-hidden': 'true' }, [
      svgEl('path', { d: 'M1 4h24', stroke: '#8b94a8', 'stroke-width': 1.6 }),
    ]),
  inferred: () =>
    svgEl('svg', { width: 26, height: 8, 'aria-hidden': 'true' }, [
      svgEl('path', {
        d: 'M1 4h24',
        stroke: '#8b94a8',
        'stroke-width': 1.6,
        'stroke-dasharray': '5 3',
      }),
    ]),
  unresolved: () =>
    svgEl('svg', { width: 26, height: 8, 'aria-hidden': 'true' }, [
      svgEl('path', { d: 'M1 4h24', stroke: '#a9b2c3', 'stroke-width': 4.5 }),
      svgEl('path', { d: 'M1 4h24', stroke: '#fff', 'stroke-width': 2.5 }),
    ]),
};

const TIER_LABEL_TEXT = {
  declared: 'declared',
  inferred: 'inferred',
  unresolved: 'unresolved',
  record: 'record only',
} as const;

function groupBlock(env: RegionEnv, m: ShellModel, group: WriterGroup): HTMLElement {
  // Entities, not cards: the group labels add up to the writer count in the summary row. A rule
  // with two actions that write this field has two cards and counts once.
  const count = group.sources;
  const writes = group.collapsible ? 0 : group.items.length;
  const toggle = () => {
    if (!env.ui.expandedGroups.delete(group.key)) env.ui.expandedGroups.add(group.key);
    env.actions.refresh();
  };
  return el('div', { className: 'lgrp', dataset: { g: group.key } }, [
    el('div', { className: 'lgrp-h' }, [
      text(group.title),
      el('span', { className: 'n', text: String(count) }),
      el('span', { className: 'tier' }, [
        group.tier === 'record' ? null : TIER_SVG[group.tier](),
        text(TIER_LABEL_TEXT[group.tier]),
      ]),
    ]),
    group.sub ? el('div', { className: 'lgrp-sub', text: group.sub }) : null,
    // The label counts writers; a writer with several writes has a card for each.
    writes > count
      ? el('div', {
          className: 'lgrp-sub',
          text: `${writes} writes · one card each`,
          attrs: { 'data-fk': 'sites' },
        })
      : null,
    group.collapsible
      ? el('div', { className: 'lgrp-sum' }, [
          el('span', { text: group.summary ?? '' }),
          el(
            'button',
            {
              className: 'lgrp-toggle',
              type: 'button',
              attrs: {
                'aria-expanded': String(group.expanded),
                'data-fk': `group:${group.key}`,
              },
              onClick: toggle,
            },
            [
              mapIcon(group.expanded ? 'chevron' : 'chevronR', 11),
              text(
                group.expanded
                  ? ' Hide'
                  : ` Show ${count} ${count === 1 ? 'function' : 'functions'}`,
              ),
            ],
          ),
        ])
      : null,
    ...group.items.map((entry) => writerCard(env, m, entry)),
  ]);
}

function silhouettes(n: number): HTMLElement[] {
  return Array.from({ length: n }, () =>
    el('div', { className: 'silh', attrs: { 'aria-hidden': 'true' } }),
  );
}

function crumb(env: RegionEnv, label: string, ref: FieldRef, current: boolean): HTMLElement {
  return el('button', {
    className: current ? 'cur' : '',
    type: 'button',
    text: label,
    attrs: current ? { 'aria-current': 'true' } : {},
    onClick: () => env.actions.openField(ref, { pivot: true }),
  });
}

function safeFieldLens(env: RegionEnv, m: ShellModel, ref: FieldRef): FieldLens {
  try {
    // The user's filters apply to the lens, so its numbers match the ranking that led here.
    return env.port.fieldLens(ref.moduleApiName, ref.fieldApiName, m.filters);
  } catch (error) {
    console.error('Zoho CRM DevTools: Automation Map field lens failed', error);
    return {
      field: null,
      writers: [],
      possibleWriters: [],
      unresolvedWriters: [],
      otherRecordChanges: [],
      reactors: [],
      coverageGaps: 0,
    };
  }
}

function renderLens(env: RegionEnv, m: ShellModel, ref: FieldRef): HTMLElement {
  const lens = buildLensModel(
    m.graph,
    safeFieldLens(env, m, ref),
    ref.moduleApiName,
    ref.fieldApiName,
    { scope: m.filters.scope, teaser: m.teaser, expanded: env.ui.expandedGroups },
  );
  const cov = m.snapshot.coverage;
  const covView = coverageView(m.snapshot);
  const trail = env.ui.lensTrail.length ? env.ui.lensTrail : [ref];
  const fieldNode = lens.field;
  const crumbLabel = (r: FieldRef) => {
    const node = m.graph.nodes.get(`field:${r.moduleApiName}.${r.fieldApiName}`);
    const module =
      m.graph.nodes.get(`module:${r.moduleApiName}`)?.label ??
      (m.teaser ? 'Another module' : r.moduleApiName);
    return `${module} › ${node?.label ?? r.fieldApiName}`;
  };

  const bar = el('div', { className: 'lens-bar' }, [
    el(
      'button',
      {
        className: 'fs-icon-button',
        type: 'button',
        title: 'All fields',
        attrs: { 'aria-label': 'Back to field picker', 'data-fk': 'lens-back' },
        onClick: () => env.actions.closeField(),
      },
      [mapIcon('back', 16)],
    ),
    el(
      'nav',
      { className: 'crumbs', attrs: { 'aria-label': 'Field trail' } },
      trail.flatMap((r, i) => [
        i ? el('span', { className: 'sep', text: '›' }) : null,
        crumb(env, crumbLabel(r), r, i === trail.length - 1),
      ]),
    ),
    el('span', { className: 'am-sp' }),
    m.teaser ? upgradeButton(env, 'See every writer with Pro') : null,
    fieldNode
      ? button('wf-btn', 'Show on board', () => env.actions.showOnBoard(fieldNode.id), [
          mapIcon('board', 14),
        ])
      : null,
    fieldNode
      ? button('wf-btn', 'Trace', () => env.actions.trace(fieldNode.id), [mapIcon('trace', 14)])
      : null,
    m.teaser
      ? null
      : button('wf-btn', 'Copy link', () => env.actions.copyLink(), [mapIcon('link', 14)]),
  ]);

  const f = cov.functions;
  const pending = f.pending;
  // The store's one gap count, the same number the pill and banner show.
  const gapCount = cov.gaps;

  const summary = el('div', { className: 'lens-sum' }, [
    m.teaser
      ? el('span', {}, [
          text('Preview: '),
          el('b', { text: String(lens.writerCount) }),
          text(` writer${lens.writerCount === 1 ? '' : 's'} and `),
          el('b', { text: String(lens.reactorCount) }),
          text(
            ` reactor${lens.reactorCount === 1 ? '' : 's'} shown from ${m.flowsShown === 1 ? 'one flow' : 'the flows read in full'}`,
          ),
        ])
      : el('span', {}, [el('b', { text: String(lens.writerCount) }), text(' possible writers')]),
    m.teaser ? null : el('span', { text: '·' }),
    m.teaser
      ? null
      : el('span', {}, [el('b', { text: String(lens.reactorCount) }), text(' reactors')]),
    m.teaser ? null : el('span', { text: '·' }),
    m.teaser
      ? null
      : el('span', {}, [el('b', { text: String(lens.cascades) }), text(' possible cascades')]),
    lens.hasLoop
      ? el('span', { className: 'fs-badge loopbadge' }, [
          mapIcon('loop', 11),
          text(' possible loop'),
        ])
      : null,
    // The coverage statement sits below every writer and reactor card: say it up here too.
    !m.teaser && gapCount > 0
      ? button(
          'fs-badge gapbadge',
          '',
          () =>
            root
              .querySelector('.lens-foot')
              ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }),
          [mapIcon('warn', 11), text(` ${gapCount} gap${gapCount === 1 ? '' : 's'} in the map`)],
          {
            title:
              'Functions not fully analysed or configuration Zoho did not return. Their writes may be missing. Jump to the coverage statement.',
            attrs: { 'data-fk': 'lens-gap-chip' },
          },
        )
      : null,
    el('span', { className: 'evlegend', attrs: { 'aria-label': 'Evidence legend' } }, [
      el('span', {}, [TIER_SVG.declared(), text('Declared')]),
      el('span', {}, [TIER_SVG.inferred(), text('Inferred from code')]),
      el('span', {}, [TIER_SVG.unresolved(), text('Unresolved')]),
    ]),
  ]);

  const loadingBox =
    !m.teaser && covView.loading
      ? el('div', { className: 'lens-box' }, [
          warnBox(
            'refresh',
            [
              el('b', {
                text:
                  pending > 0
                    ? `${f.listed - pending} of ${f.listed} functions analysed so far. `
                    : 'Still loading automation details. ',
              }),
              text('More writers may appear.'),
            ],
            '',
            true,
          ),
        ])
      : null;

  const writersCol: Node[] = [
    el('div', { className: 'lcol-h' }, [mapIcon('arrowR', 13), text(' Writers')]),
  ];
  // "May write … fields unknown" and "Unresolved module" are possibilities, not named writers,
  // so a field only they reach still gets the honest "no known writers" statement first.
  const named = lens.groups.some(
    (g) => g.key === 'declared' || g.key === 'exact' || g.key === 'partial',
  );
  if (!named && !m.teaser) {
    writersCol.push(
      covView.loading
        ? el('div', { className: 'lens-empty' }, [
            el('b', { text: 'No writers found yet.' }),
            el('br'),
            text(
              `${pending > 0 ? `${pending} functions are` : 'Some automation is'} still being analysed. Workflow field updates and function writes appear here as they load.`,
            ),
          ])
        : el('div', { className: 'lens-empty' }, [
            el('b', { text: 'No known writers in analysed automation.' }),
            el('br'),
            text(
              `That is not proof that nothing writes ${lens.fieldLabel}${gapCount ? `: ${gapCount} gap${gapCount === 1 ? '' : 's'} in the map (functions not fully analysed or configuration not read), and` : ':'} people, imports and integrations can change it too.`,
            ),
          ]),
    );
  }
  writersCol.push(...lens.groups.map((g) => groupBlock(env, m, g)));
  if (m.teaser) {
    const fogged = (m.snapshot.teaser?.fogged ?? []).reduce((n, i) => n + i.recordWrites, 0);
    writersCol.push(
      ...silhouettes(4),
      el('div', { className: 'fogtext' }, [
        mapIcon('lock', 14),
        text(' '),
        el('b', { text: 'More writers are in the fog.' }),
        text(
          ` ${fogged > 0 ? `Your function catalogue lists ${fogged} record writes outside this preview. ` : ''}Pro shows which ones can write ${lens.fieldLabel}.`,
        ),
        el('br'),
        upgradeButton(env),
      ]),
    );
  }

  const reactorGroup = (title: string, items: ReactorEntry[], sub?: string) =>
    el('div', { className: 'lgrp' }, [
      el('div', { className: 'lgrp-h' }, [
        text(title),
        el('span', { className: 'n', text: String(items.length) }),
      ]),
      sub ? el('div', { className: 'lgrp-sub', text: sub }) : null,
      ...(items.length
        ? items.map((r) => reactorCard(env, m, r, lens))
        : [note('None in this scope.')]),
    ]);
  const reactorsCol: Node[] = [
    el('div', { className: 'lcol-h' }, [text('Reactors '), mapIcon('arrowR', 13)]),
    reactorGroup(`Run when ${lens.fieldLabel} changes`, lens.triggerReactors),
    reactorGroup(
      `Check ${lens.fieldLabel} in their criteria`,
      lens.criteriaReactors,
      `These run on their own trigger. ${lens.fieldLabel} decides whether their actions fire.`,
    ),
  ];
  if (m.teaser)
    reactorsCol.push(
      ...silhouettes(2),
      el('div', { className: 'fogtext' }, [
        mapIcon('lock', 14),
        text(` More rules may react to ${lens.fieldLabel}. They're in the fog.`),
      ]),
    );

  const fieldCard = el('div', { className: 'fcard', attrs: { id: 'am-fcard' } }, [
    el('div', { className: 'fh' }, [
      el('span', { className: 'fm' }, [mapIcon('module', 12), text(lens.moduleName)]),
      el('div', { className: 'fn', text: lens.fieldLabel }),
      el('div', { className: 'fa', text: `${ref.moduleApiName}.${ref.fieldApiName}` }),
    ]),
    el('div', { className: 'fstats' }, [
      el('div', { className: 'fstat' }, [
        el('b', { text: `${lens.writerCount}${m.teaser ? '+' : ''}` }),
        text('writers'),
      ]),
      el('div', { className: 'fstat' }, [
        el('b', { text: `${lens.reactorCount}${m.teaser ? '+' : ''}` }),
        text('reactors'),
      ]),
    ]),
    fieldNode
      ? el('div', { className: 'fbtns' }, [
          button('wf-btn', 'Show on board', () => env.actions.showOnBoard(fieldNode.id), [
            mapIcon('board', 14),
          ]),
          button('wf-btn', 'Trace from field', () => env.actions.trace(fieldNode.id), [
            mapIcon('trace', 14),
          ]),
        ])
      : null,
  ]);

  const grid = el('div', { className: 'lens-grid' }, [
    svgEl('svg', { 'aria-hidden': 'true' }),
    el('div', { className: 'lcol', dataset: { col: 'w' } }, writersCol),
    el('div', { className: 'lcol', dataset: { col: 'f' } }, [fieldCard]),
    el('div', { className: 'lcol', dataset: { col: 'r' } }, reactorsCol),
  ]);

  const total = cov.rules.total ?? cov.rules.listed;
  const analysed = f.analyzed;
  const footer = el('div', { className: 'lens-foot' }, [
    el('div', { className: 'cov-box' }, [
      el('span', { className: 'ico' }, [mapIcon(m.teaser ? 'lock' : 'info', 15)]),
      el(
        'div',
        {},
        m.teaser
          ? [
              el('p', {}, [
                el('b', { text: 'Preview coverage: ' }),
                text(
                  `${
                    m.flowsShown === 1
                      ? 'only one flow has'
                      : m.flowsShown
                        ? `only ${m.flowsShown} flows have`
                        : 'no flow has'
                  } been read in full, so most writers and reactors are not shown. Pro reads everything.`,
                ),
              ]),
              el('p', {
                text: `People, manual edits, imports, integrations and API clients, client scripts and other automation the map does not index can also change ${lens.fieldLabel}. This is a list of possible writers, not a guarantee that each one runs.`,
              }),
            ]
          : [
              el('p', {}, [
                el('b', { text: 'Coverage: ' }),
                text(
                  `${cov.rules.detailed} of ${total} rules and ${analysed} of ${f.listed} functions analysed. `,
                ),
                gapCount > 0
                  ? el('b', {
                      text: `${gapCount} gap${gapCount === 1 ? '' : 's'} in the map`,
                    })
                  : null,
                gapCount > 0
                  ? text(
                      ` (functions not fully analysed or configuration Zoho did not return) could also write ${lens.fieldLabel}. `,
                    )
                  : null,
                gapCount > 0
                  ? button(
                      'wf-btn link',
                      'View gaps',
                      () => env.actions.setCoverageOpen(true),
                      [],
                      { attrs: { 'data-fk': 'view-gaps' } },
                    )
                  : null,
              ]),
              el('p', {
                text: `People, manual edits, imports, integrations and API clients, client scripts and other automation this map does not index can also change ${lens.fieldLabel}. This is a list of possible writers, not a guarantee that each one runs.`,
              }),
            ],
      ),
    ]),
  ]);

  const root = el('div', { className: 'lens-in' }, [bar, summary, loadingBox, grid, footer]);
  return root;
}

/* ====================================================================== connectors */

function defs(): SVGElement {
  const marker = (id: string, fill: string, extra: Record<string, string | number> = {}) =>
    svgEl(
      'marker',
      {
        id,
        viewBox: '0 0 10 10',
        refX: 9,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: 'auto',
        ...extra,
      },
      [svgEl('path', { d: 'M1,1 L9,5 L1,9 z', fill })],
    );
  return svgEl('defs', {}, [
    marker('lens-arr', '#b3bccb'),
    marker('lens-arr-hl', '#2f6df0'),
    svgEl(
      'marker',
      {
        id: 'lens-arr-open',
        viewBox: '0 0 10 10',
        refX: 9,
        refY: 5,
        markerWidth: 8,
        markerHeight: 8,
        orient: 'auto',
      },
      [
        svgEl('path', {
          d: 'M1,1.5 L9,5 L1,8.5',
          fill: 'none',
          stroke: '#9aa3b5',
          'stroke-width': 1.5,
        }),
      ],
    ),
    svgEl(
      'marker',
      {
        id: 'lens-ring',
        viewBox: '0 0 10 10',
        refX: 8,
        refY: 5,
        markerWidth: 8,
        markerHeight: 8,
        orient: 'auto',
      },
      [
        svgEl('circle', {
          cx: 5,
          cy: 5,
          r: 3.2,
          fill: '#fff',
          stroke: '#a9b2c3',
          'stroke-width': 1.6,
        }),
      ],
    ),
  ]);
}

const curve = (x1: number, y1: number, x2: number, y2: number): string => {
  const dx = Math.max(30, (x2 - x1) * 0.45);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
};

/** Connectors from each writer to the field card and from it to each reactor. */
export function drawEdges(host: HTMLElement): void {
  const grid = host.querySelector<HTMLElement>('.lens-grid');
  const fcard = host.querySelector<HTMLElement>('#am-fcard');
  const svg = grid?.querySelector<SVGSVGElement>(':scope > svg');
  if (!grid || !fcard || !svg) return;
  const g = grid.getBoundingClientRect();
  const f = fcard.getBoundingClientRect();
  svg.replaceChildren();
  if (g.width === 0) return; // no layout (hidden view or jsdom)
  // The part of the grid you can actually see: below the sticky bar, above the bottom edge.
  const view = host.getBoundingClientRect();
  const bar = host.querySelector('.lens-bar')?.getBoundingClientRect();
  const visTop = Math.max(view.top, bar?.bottom ?? view.top) - g.top + 14;
  const visBottom = view.bottom - g.top - 14;
  /** A card scrolled out of view keeps a short stub at the edge of the view, not a rope. */
  const clampY = (y: number): { y: number; off: boolean } =>
    y < visTop
      ? { y: visTop, off: true }
      : y > visBottom
        ? { y: visBottom, off: true }
        : { y, off: false };
  svg.setAttribute('width', String(g.width));
  svg.setAttribute('height', String(g.height));
  svg.append(defs());
  const top = f.top - g.top + 36;
  const bottom = f.bottom - g.top - 36;
  const spread = (i: number, n: number) =>
    n > 1 ? top + (i / (n - 1)) * (bottom - top) : f.top - g.top + 56;
  const left = f.left - g.left;
  const right = f.right - g.left;
  const lit = (card: Element) => card.classList.contains('sel');

  const writers = [...grid.querySelectorAll<HTMLElement>('[data-col="w"] .wcard:not(.nolink)')];
  writers.forEach((card, i) => {
    const r = card.getBoundingClientRect();
    const x1 = r.right - g.left;
    const { y: y1, off } = clampY(r.top - g.top + Math.min(26, r.height / 2));
    const y2 = spread(i, writers.length);
    const tier = card.dataset.tier;
    const d = curve(x1, y1, left - 2, y2);
    const on = `${lit(card) ? ' lit' : ''}${off ? ' off' : ''}`;
    if (tier === 'unresolved') {
      svg.append(
        svgEl('path', { d, class: `le ur-o${on}` }),
        svgEl('path', { d, class: `le ur-i${on}`, 'marker-end': 'url(#lens-ring)' }),
      );
    } else {
      svg.append(
        svgEl('path', {
          d,
          class: `le ${tier === 'exact' || tier === 'partial' ? 'ex' : ''}${on}`,
          'marker-end':
            tier === 'declared'
              ? on
                ? 'url(#lens-arr-hl)'
                : 'url(#lens-arr)'
              : 'url(#lens-arr-open)',
        }),
      );
    }
    if (tier === 'partial') {
      const label = svgEl('text', { x: left - 24, y: y2 - 6, class: 'le-badge' });
      label.textContent = '+?';
      svg.append(label);
    }
  });
  const reactors = [...grid.querySelectorAll<HTMLElement>('[data-col="r"] .wcard')];
  reactors.forEach((card, i) => {
    const r = card.getBoundingClientRect();
    const { y: y2, off } = clampY(r.top - g.top + 20);
    const d = curve(right + 2, spread(i, reactors.length), r.left - g.left, y2);
    svg.append(
      svgEl('path', {
        d,
        class: `le arrowed${card.dataset.tier === 'crit' ? ' crit' : ''}${lit(card) ? ' lit' : ''}${off ? ' off' : ''}`,
        'marker-end': lit(card) ? 'url(#lens-arr-hl)' : 'url(#lens-arr)',
      }),
    );
  });
}
