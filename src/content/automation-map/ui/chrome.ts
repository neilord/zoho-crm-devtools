/** Shell chrome around the views: filter chips, banners, cover states, fog card, footer, shortcuts. */
import { TRIGGER_LABELS } from '../../workflows/view-model';
import type { MapFilters } from '../types';
import type { RegionEnv } from './actions';
import { button, el, kbdKeys, text } from './dom';
import { flowsText } from './format';
import { mapIcon } from './icons';
import { KIND_PLURAL, LEGEND_ORDER } from './kinds';
import { allKinds, coverageView, estateTotals, type ShellModel, shownKinds } from './model';
import { emptyState, upgradeButton, warnBox } from './parts';

/* ---------- active filter chips ---------- */

const FLAG_LABEL: Record<string, string> = {
  writesFields: 'Writes fields',
  callsExternal: 'Calls external',
  cascades: 'Cascades',
  restApi: 'REST API functions',
  gaps: 'Has gaps',
};

export function filterChips(env: RegionEnv, m: ShellModel): HTMLElement[] {
  const f = m.state.filters;
  const kinds = allKinds(m.graph);
  const shown = shownKinds(f, kinds);
  const chips: Array<{ label: string; remove(): void }> = [];
  const set =
    <K extends 'modules' | 'kinds' | 'triggerTypes' | 'flags'>(key: K, value: string) =>
    () => {
      const next = new Set(f[key] as ReadonlySet<string>);
      next.delete(value);
      env.actions.setFilters({ [key]: next } as Partial<MapFilters>);
    };
  for (const api of f.modules)
    chips.push({
      label: `Module: ${m.graph.nodes.get(`module:${api}`)?.label ?? api}`,
      remove: set('modules', api),
    });
  for (const kind of LEGEND_ORDER)
    if (kinds.includes(kind) && !shown.has(kind))
      chips.push({
        label: `Hidden: ${KIND_PLURAL[kind]}`,
        remove: () => {
          const next = new Set(shown);
          next.add(kind);
          env.actions.setFilters({ kinds: next.size === kinds.length ? new Set() : next });
        },
      });
  for (const t of f.triggerTypes)
    chips.push({ label: `Trigger: ${TRIGGER_LABELS[t] ?? t}`, remove: set('triggerTypes', t) });
  for (const flag of f.flags)
    chips.push({ label: `Only: ${FLAG_LABEL[flag] ?? flag}`, remove: set('flags', flag) });
  return chips.map((c) =>
    el('span', { className: 'fs-chip' }, [
      text(c.label),
      el(
        'button',
        {
          type: 'button',
          attrs: { 'aria-label': `Remove ${c.label}`, 'data-fk': `chip:${c.label}` },
          onClick: c.remove,
        },
        [mapIcon('close', 11)],
      ),
    ]),
  );
}

/* ---------- banner (mapping progress / gaps) ---------- */

export function banner(env: RegionEnv, m: ShellModel): HTMLElement | null {
  if (m.teaser || m.access !== 'full') return null;
  const cov = coverageView(m.snapshot);
  if (cov.status === 'loading')
    return el('div', { className: 'am-banner' }, [
      warnBox(
        'refresh',
        [
          el('b', { text: `Mapping ${cov.percent}%. ` }),
          text(
            'Rule names and modules are on the map now. Actions, functions and field writes are added as they load.',
          ),
        ],
        '',
        true,
      ),
    ]);
  if (env.ui.bannerDismissed) return null;
  if (cov.status === 'gaps')
    return el('div', { className: 'am-banner' }, [
      warnBox('warn', [
        el('b', { text: `${cov.gaps} gap${cov.gaps === 1 ? '' : 's'} in the map. ` }),
        text(
          'Some functions could not be fully analysed, or Zoho configuration could not be read. Their nodes show a warning, and inferred writes may be missing. ',
        ),
        button('wf-btn link', 'View gaps', () => env.actions.setCoverageOpen(true), [], {
          attrs: { 'data-fk': 'banner-gaps' },
        }),
        button(
          'wf-btn link dismiss',
          '',
          () => {
            env.ui.bannerDismissed = true;
            env.actions.refresh();
          },
          [mapIcon('close', 13)],
          { title: 'Dismiss', attrs: { 'aria-label': 'Dismiss', 'data-fk': 'banner-x' } },
        ),
      ]),
    ]);
  if (cov.status === 'stopped')
    return el('div', { className: 'am-banner' }, [
      warnBox('warn', [
        el('b', { text: 'Mapping stopped. ' }),
        text('What is shown may be incomplete. '),
        button('wf-btn link', 'Retry', () => env.actions.retry(), [], {
          attrs: { 'data-fk': 'banner-retry' },
        }),
      ]),
    ]);
  return null;
}

/* ---------- cover states (checking, failed, empty org) ---------- */

export function cover(env: RegionEnv, m: ShellModel): HTMLElement | null {
  if (m.access === 'checking')
    return emptyState(
      'refresh',
      'Checking your plan…',
      'This takes a moment. Nothing is read from your CRM until the check finishes.',
    );
  const real = [...m.graph.nodes.values()].some((n) => n.kind !== 'module');
  if (m.teaser) return null;
  const phase = m.snapshot.phase;
  if (!real && phase === 'failed')
    return emptyState(
      'warn',
      "Couldn't load your automation",
      "Zoho didn't return the workflow rule list. Nothing was sent anywhere; try again.",
      [
        button('wf-btn primary', 'Retry', () => env.actions.retry(), [mapIcon('refresh', 13)], {
          attrs: { 'data-fk': 'cover-retry' },
        }),
      ],
    );
  if (!real && phase === 'complete')
    return emptyState(
      'map',
      'No automation yet',
      'This org has no workflow rules, buttons, schedules or API functions to map.',
    );
  return null;
}

/* ---------- fog card (teaser) ---------- */

export function fogCard(env: RegionEnv, m: ShellModel): HTMLElement | null {
  if (!m.teaser) return null;
  const access = m.snapshot.access;
  if (access.level !== 'teaser') return null;
  const revealed = access.revealedModuleApiName !== null && m.graph.modules.length > 0;
  if (!env.ui.fogCardOpen)
    return el('div', { className: 'fog-pill' }, [
      mapIcon('lock', 14),
      text(
        revealed
          ? ` ${m.flowsShown ? `${flowsText(m.flowsShown)} shown` : 'Preview'} · the rest is in the fog `
          : ' Your org is in the fog ',
      ),
      upgradeButton(env),
    ]);
  const plan =
    access.reason === 'lower-plan'
      ? 'Your plan includes Search All Workflows. Automation Map needs Pro.'
      : access.reason === 'unavailable'
        ? null
        : 'Sign in and upgrade to Pro to map your whole org.';
  return el('div', { className: 'fog-card', attrs: { role: 'region', 'aria-label': 'Upgrade' } }, [
    el(
      'button',
      {
        className: 'x',
        type: 'button',
        attrs: { 'aria-label': 'Collapse', 'data-fk': 'fog-x' },
        onClick: () => {
          env.ui.fogCardOpen = false;
          env.actions.refresh();
        },
      },
      [mapIcon('close', 14)],
    ),
    access.reason === 'unavailable'
      ? el('div', { className: 'warnline', attrs: { role: 'status' } }, [
          mapIcon('warn', 14),
          el('span', { text: "We couldn't check your plan. Showing a preview." }),
          button('wf-btn', 'Retry', () => env.actions.retry(), [mapIcon('refresh', 12)], {
            attrs: { 'data-fk': 'fog-retry' },
          }),
        ])
      : null,
    el('h3', {}, [
      el('span', { className: 'lk' }, [mapIcon('lock', 16)]),
      text(
        revealed
          ? `You're seeing ${flowsText(m.flowsShown)}. The rest of your org is in the fog.`
          : 'Upgrade to Pro to map your org.',
      ),
    ]),
    el('p', {
      text: "Automation Map shows every rule, function, button, schedule and API entry point, and every way each field can change. It's included in Pro.",
    }),
    plan ? el('p', { className: 'plan', text: plan }) : null,
    el('div', { className: 'row' }, [
      upgradeButton(env),
      button(
        'wf-btn',
        'Not now',
        () => {
          env.ui.fogCardOpen = false;
          env.actions.refresh();
        },
        [],
        { attrs: { 'data-fk': 'fog-later' } },
      ),
    ]),
  ]);
}

/* ---------- footer status ---------- */

export function footerStatus(m: ShellModel): string {
  if (m.access === 'checking') return 'Checking your plan…';
  if (m.teaser) return 'Preview · built from your rule list and function catalogue';
  const cov = coverageView(m.snapshot);
  if (cov.status === 'failed') return 'Could not load your automation';
  if (cov.status === 'loading')
    return `Mapping ${cov.percent}% · the first map takes a minute or two, then it is cached`;
  const e = estateTotals(m.graph, m.snapshot.coverage.modules);
  const base = `${e.rules} rules · ${e.functions} functions · ${e.modules} modules`;
  return m.snapshot.coverage.refreshing ? `${base} · refreshing…` : base;
}

/* ---------- shortcuts sheet ---------- */

export function keysSheet(env: RegionEnv): HTMLElement {
  const rows: Array<[string[], string]> = [
    [['/'], 'Search'],
    [['F', 'B', 'L'], 'Fields · Board · List'],
    [['T'], 'Trace from the selected node'],
    [['W'], 'Show writers of the selected field'],
    [['+', '−', '0', '1'], 'Zoom in · out · fit all · zoom to selection'],
    [['←', '→', '↑', '↓'], 'Move along links (→ downstream, ← upstream) and within a lane'],
    [['Enter'], 'Open node · next search match (Shift for previous)'],
    [['[', ']', '{', '}'], 'Trace depth downstream − + · upstream − +'],
    [['Esc'], 'Close popover, clear search, exit trace, deselect, then close'],
  ];
  const sheet = el(
    'div',
    {
      className: 'am-keys',
      attrs: { role: 'dialog', 'aria-label': 'Keyboard shortcuts', 'aria-modal': 'true' },
    },
    [
      el('div', {}, [
        el('h4', { text: 'Keyboard shortcuts' }),
        el(
          'dl',
          {},
          rows.flatMap(([keys, label]) => [el('dt', {}, kbdKeys(keys)), el('dd', { text: label })]),
        ),
        el('div', { className: 'keys-foot' }, [
          button('wf-btn', 'Close', () => env.actions.toggleKeys(false), [], {
            attrs: { 'data-fk': 'keys-close' },
          }),
        ]),
      ]),
    ],
  );
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) env.actions.toggleKeys(false);
  });
  return sheet;
}
