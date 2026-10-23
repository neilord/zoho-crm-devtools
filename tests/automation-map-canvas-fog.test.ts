import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAutomationGraph, traceFrom } from '../src/content/automation-map/graph';
import type {
  AutomationGraph,
  FoggedIsland,
  MapEdge,
  MapNode,
  TeaserFog,
} from '../src/content/automation-map/types';
import {
  boardControllerFor,
  mountBoardView,
  mountTraceView,
  traceControllerFor,
} from '../src/content/automation-map/ui/canvas';
import {
  fogChipText,
  fogGeometry,
  fogLobes,
  fogOutline,
  isOrgLike,
  paintFogSilhouettes,
} from '../src/content/automation-map/ui/canvas/fog';
import {
  ACTION_LABEL,
  EXTERNAL_LABEL,
  KIND_LABEL,
  TRIGGER_LABEL,
} from '../src/content/automation-map/ui/canvas/kinds';
import type { MapDataPort } from '../src/content/automation-map/ui/context';
import { quietNote, summarizeFog } from '../src/content/automation-map/ui/fog-model';
import {
  attach,
  fire,
  installDomStubs,
  makeContext,
  portFor,
} from './automation-map-canvas-fixtures';
import { canvasCssSource } from './automation-map-css-source';
import { fixtureInputs } from './fixtures/automation-map';
import { createFixturePort, skewedFog, withSkewedFog } from './fixtures/automation-map-port';

beforeEach(() => installDomStubs());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.textContent = '';
});

/** Every string a node can print: ids, labels and the API names behind them. */
function stringsOf(node: MapNode, withModule: boolean): string[] {
  const out = [node.id, node.label];
  if (withModule && node.moduleApiName) out.push(node.moduleApiName);
  switch (node.kind) {
    case 'module':
      out.push(node.apiName);
      break;
    case 'field':
      out.push(node.fieldApiName);
      break;
    case 'function':
      if (node.apiName) out.push(node.apiName);
      out.push(node.delugeId);
      break;
    case 'rule':
      out.push(node.ruleId);
      break;
    case 'template':
      out.push(node.templateId);
      if (node.subject) out.push(node.subject);
      break;
    case 'external':
      out.push(node.key);
      break;
    case 'button':
      out.push(node.buttonId);
      break;
    case 'schedule':
      out.push(node.scheduleId);
      break;
    case 'transition':
      out.push(node.transitionId, node.blueprintName);
      break;
    case 'approval':
      out.push(node.approvalId);
      break;
    default:
  }
  return out.filter((s) => s.length >= 4);
}

/** Generic words the UI itself prints (kind and action names, fog copy): not configuration. */
const UI_WORDS = new Set<string>(
  [
    ...Object.values(KIND_LABEL),
    ...Object.values(ACTION_LABEL),
    ...Object.values(EXTERNAL_LABEL),
    ...Object.values(TRIGGER_LABEL),
    'rules functions buttons schedule schedules module function',
  ].flatMap((label) => label.toLowerCase().split(/\W+/)),
);

function leakable(full: AutomationGraph, revealed: AutomationGraph): string[] {
  const allowed = new Set<string>();
  // A revealed node's own module is not thereby revealed: its API name stays forbidden.
  for (const n of revealed.nodes.values())
    for (const s of stringsOf(n, false)) allowed.add(s.toLowerCase());
  const out = new Set<string>();
  for (const n of full.nodes.values())
    for (const s of stringsOf(n, true)) {
      const lower = s.toLowerCase();
      if (!allowed.has(lower) && !UI_WORDS.has(lower)) out.add(s);
    }
  return [...out];
}

/**
 * Every text node and attribute value under `root`. Class names, inline styles and the SVG
 * icon sprite (symbol ids such as "emailNotification") are presentation, not data.
 */
function domText(root: Element): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) out.push(node.textContent ?? '');
    if (!(node instanceof Element)) {
      for (const child of node.childNodes) walk(child);
      return;
    }
    if (node.namespaceURI === 'http://www.w3.org/2000/svg') {
      // Icons and edges: only an accessible name could carry text.
      for (const name of ['aria-label', 'title']) {
        const v = node.getAttribute(name);
        if (v) out.push(v);
      }
    } else {
      for (const attr of node.attributes)
        if (
          ![
            'class',
            'style',
            'role',
            'aria-hidden',
            'aria-live',
            'aria-atomic',
            'tabindex',
            'hidden',
          ].includes(attr.name)
        )
          out.push(attr.value);
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return out.join('\n').toLowerCase();
}

/**
 * A teaser whose revealed flow writes into a *locked* module: Deals rule-003 reaches f-001, which
 * writes Accounts.Health_Score. The fixture's own teaser stays inside Deals, so this is the case
 * the redaction exists for.
 */
function crossModuleTeaser(full: AutomationGraph) {
  const keep = new Set<string>([
    'module:Deals',
    ...traceFrom(full, 'rule:rule-003', {
      upstream: 0,
      downstream: 6,
      maxNodes: 80,
      includeInactive: true,
    }).nodeIds,
  ]);
  const nodes = new Map([...full.nodes].filter(([id]) => keep.has(id)));
  const edges = full.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  const outgoing = new Map<string, MapEdge[]>();
  const incoming = new Map<string, MapEdge[]>();
  for (const e of edges) {
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e]);
    incoming.set(e.to, [...(incoming.get(e.to) ?? []), e]);
  }
  const revealed: AutomationGraph = {
    nodes,
    edges,
    outgoing,
    incoming,
    modules: full.modules.filter((m) => keep.has(m.id)),
  };
  const base = createFixturePort('teaser').port.snapshot();
  return { revealed, snapshot: { ...base, graph: revealed } };
}

describe('fog teaser with a cross-module revealed write', () => {
  const full = buildAutomationGraph(fixtureInputs());
  const { revealed, snapshot } = crossModuleTeaser(full);
  const lockedModules = full.modules.map((m) => m.apiName).filter((m) => m !== 'Deals');

  it('really writes into a locked module', () => {
    expect(revealed.nodes.has('field:Accounts.Health_Score')).toBe(true);
    expect(revealed.nodes.has('module:Accounts')).toBe(false);
  });

  it('never prints a locked module name, in the board or the trace', async () => {
    const forbidden = [...leakable(full, revealed), ...lockedModules];
    expect(forbidden).toContain('Accounts');
    const port = portFor(revealed);
    port.publish(snapshot);
    const { ctx } = makeContext(port);
    const container = attach();
    const dispose = mountBoardView(container, ctx);
    const board = boardControllerFor(container);
    board?.flush();
    const deals = board?.model().islands.find((I) => I.id === 'Deals');
    board?.setCamera({ x: (deals?.x ?? 0) - 40, y: (deals?.y ?? 0) - 40, zoom: 1 });
    board?.flush();
    const text = domText(container);
    // The portal stub exists and says so, without naming the module.
    expect(board?.model().byIid.size).toBeGreaterThan(0);
    const stubs = [...(board?.model().byIid.values() ?? [])].filter((i) => i.portal?.dir === 'out');
    expect(stubs.length).toBeGreaterThan(0);
    for (const stub of stubs) expect(stub.title).toContain('Locked module');
    expect(text).toContain('locked module');
    expect(forbidden.filter((s) => text.includes(s.toLowerCase()))).toEqual([]);
    dispose();

    // The same flow as a trace: the field card is "Locked module · Health Score".
    const trace = makeContext(port, {
      view: 'trace',
      traceRootId: 'rule:rule-003',
      traceDepth: { upstream: 0, downstream: 6 },
    });
    const traceContainer = attach();
    const disposeTrace = mountTraceView(traceContainer, trace.ctx);
    await traceControllerFor(traceContainer)?.ready;
    const traceText = domText(traceContainer);
    expect(traceText).toContain('locked module · health score');
    expect(forbidden.filter((s) => traceText.includes(s.toLowerCase()))).toEqual([]);
    disposeTrace();
  });
});

/** Every word the fog subtree may contain: counts vocabulary and the chip weight bucket. */
const FOG_WORDS: readonly string[] = [
  'rules',
  'rule',
  'functions',
  'function',
  'buttons',
  'button',
  'schedules',
  'schedule',
  'api',
  'in',
  'the',
  'fog',
  'upgrade',
  'to',
  'pro',
  'see',
  'this',
  'module',
  'area',
  'locked',
  'no',
  'or',
  'it',
  // The chip weight bucket (data-tier): a count class, not a name.
  'xl',
  'lg',
  'md',
  'sm',
  'tiny',
];

describe('fog teaser', () => {
  const full = buildAutomationGraph(fixtureInputs());

  it('renders the revealed flow and a text-free fog island per fogged slot', () => {
    const { port } = createFixturePort('teaser');
    const snap = port.snapshot();
    expect(snap.access.level).toBe('teaser');
    const { ctx } = makeContext(port);
    const container = attach();
    const dispose = mountBoardView(container, ctx);
    const board = boardControllerFor(container);
    board?.flush();
    const fogs = container.querySelectorAll('.amc-fog');
    // Modules without automation are one note, not islands.
    const { areas, quiet } = summarizeFog(snap.teaser as TeaserFog);
    expect(quiet).toBeGreaterThan(0);
    expect(fogs.length).toBe(areas.length);
    expect(container.querySelector('.amc-quiet')?.textContent).toBe(quietNote(quiet));
    // Opaque slot ids and counts only.
    for (const fog of fogs) {
      expect(fog.id).toMatch(/^fog-\d+$/);
      expect(fog.getAttribute('aria-label')).toMatch(
        /^Locked area: [\d\sA-Za-z·]+\. Upgrade to Pro to see it\.$/,
      );
    }
    // The revealed island is real and interactive.
    expect(board?.model().islands.map((I) => I.id)).toEqual(['Deals']);
    dispose();
  });

  it("contains none of the fogged modules' names, labels or ids anywhere in the DOM", () => {
    const { port } = createFixturePort('teaser');
    const revealed = port.snapshot().graph;
    const forbidden = leakable(full, revealed);
    expect(forbidden.length).toBeGreaterThan(50);
    expect(forbidden).toContain('Partner_Reviews');
    expect(forbidden).toContain('module:Leads');

    const { ctx } = makeContext(port);
    const container = attach();
    const dispose = mountBoardView(container, ctx);
    const board = boardControllerFor(container);
    // See the whole estate, then the revealed flow up close.
    board?.flush();
    const check = (label: string, root: Element) => {
      const text = domText(root);
      const hits = forbidden.filter((s) => text.includes(s.toLowerCase()));
      expect(hits, `${label} leaks ${hits.slice(0, 5).join(', ')}`).toEqual([]);
    };
    check('overview', container);
    const deals = board?.model().islands.find((I) => I.id === 'Deals');
    board?.setCamera({ x: (deals?.x ?? 0) - 40, y: (deals?.y ?? 0) - 40, zoom: 1 });
    board?.flush();
    expect(container.querySelectorAll('.amc-nd').length).toBeGreaterThan(5);
    check('revealed island close up', container);
    // The fog subtree itself holds no letters beyond the counts vocabulary.
    for (const fog of container.querySelectorAll('.amc-fog')) {
      const words = domText(fog).match(/[a-z]+/g) ?? [];
      for (const w of words) expect(FOG_WORDS.includes(w), `fog word "${w}"`).toBe(true);
    }
    dispose();
  });

  it('keeps locked modules unnamed in the revealed trace too', async () => {
    const { port } = createFixturePort('teaser');
    const revealed = port.snapshot().graph;
    const forbidden = leakable(full, revealed);
    const rule = [...revealed.nodes.values()].find((n) => n.kind === 'rule');
    const { ctx } = makeContext(port, { view: 'trace', traceRootId: rule?.id ?? null });
    const container = attach();
    const dispose = mountTraceView(container, ctx);
    await traceControllerFor(container)?.ready;
    const text = domText(container);
    expect(forbidden.filter((s) => text.includes(s.toLowerCase()))).toEqual([]);
    dispose();
  });

  describe('a lopsided estate', () => {
    const skewed = () => withSkewedFog(createFixturePort('teaser').port, 9);
    const mount = (port: MapDataPort = skewed()) => {
      const { ctx } = makeContext(port);
      const container = attach();
      const dispose = mountBoardView(container, ctx);
      boardControllerFor(container)?.flush();
      return { container, dispose };
    };

    it('varies the chips by counts and keeps tiny islands quiet until hovered', () => {
      const { container, dispose } = mount();
      const { areas } = summarizeFog(skewedFog(9));
      const fogs = [...container.querySelectorAll<HTMLElement>('.amc-fog')];
      expect(fogs).toHaveLength(areas.length);
      const tiers = new Set(fogs.map((f) => f.dataset.tier));
      expect(tiers.size).toBeGreaterThanOrEqual(4);
      // The chip a tiny island carries rests at opacity 0 and comes up on hover or focus (CSS).
      const tiny = fogs.filter((f) => f.dataset.tier === 'tiny');
      expect(tiny.length).toBeGreaterThan(5);
      for (const f of tiny) expect(f.style.getPropertyValue('--lo')).toBe('0');
      const big = fogs.filter((f) => f.dataset.tier === 'xl');
      expect(big.length).toBeGreaterThan(0);
      expect(Number(big[0].style.getPropertyValue('--lk'))).toBeGreaterThan(1);
      const scales = new Set(fogs.map((f) => f.style.getPropertyValue('--lk')));
      expect(scales.size).toBeGreaterThanOrEqual(3);
      // Hidden or not, a tiny island is still reachable and still says what it is.
      for (const f of tiny) {
        expect(f.getAttribute('role')).toBe('button');
        expect(f.getAttribute('tabindex')).toBe('0');
        expect(f.getAttribute('aria-label')).toMatch(/^Locked area: \d+ (rule|function)/);
      }
      dispose();
    });

    it('shows one note for modules without automation, never an empty island', () => {
      const { container, dispose } = mount();
      const notes = container.querySelectorAll('.amc-quiet');
      expect(notes).toHaveLength(1);
      expect(notes[0].textContent).toBe('9 other modules without automation');
      for (const fog of container.querySelectorAll('.amc-fog'))
        expect(fog.getAttribute('aria-label')).not.toMatch(/No rules or functions/);
      dispose();
    });

    it('counts the empty slots of an older snapshot instead, and never both', () => {
      const base = skewed();
      const snapshot = base.snapshot();
      const fog = snapshot.teaser as TeaserFog;
      const empty = (slot: number): FoggedIsland => ({
        slot,
        counts: { rules: 0, functions: 0, buttons: 0, schedules: 0 },
        recordWrites: 0,
      });
      const old = {
        ...fog,
        quietModules: undefined,
        fogged: [...fog.fogged, empty(90), empty(91)],
      };
      const { container, dispose } = mount({
        ...base,
        snapshot: () => ({ ...snapshot, teaser: old }),
      });
      expect(container.querySelector('.amc-quiet')?.textContent).toBe(
        '2 other modules without automation',
      );
      expect(container.querySelectorAll('.amc-fog')).toHaveLength(summarizeFog(fog).areas.length);
      dispose();
    });

    it('draws no quiet note when the store reports none', () => {
      const base = skewed();
      const snapshot = base.snapshot();
      const fog = { ...(snapshot.teaser as TeaserFog), quietModules: 0 };
      const { container, dispose } = mount({
        ...base,
        snapshot: () => ({ ...snapshot, teaser: fog }),
      });
      expect(container.querySelector('.amc-quiet')).toBeNull();
      dispose();
    });

    it('still names nothing: the fog holds only counts words and the weight bucket', () => {
      const { container, dispose } = mount();
      const text = domText(container);
      const forbidden = leakable(full, createFixturePort('teaser').port.snapshot().graph);
      expect(forbidden.filter((s) => text.includes(s.toLowerCase()))).toEqual([]);
      for (const fog of container.querySelectorAll('.amc-fog'))
        for (const w of domText(fog).match(/[a-z]+/g) ?? [])
          expect(FOG_WORDS.includes(w), `fog word "${w}"`).toBe(true);
      expect(domText(container.querySelector('.amc-quiet') as Element)).toMatch(
        /^\d+ other modules? without automation$/,
      );
      dispose();
    });
  });

  it('clears the full DOM when access changes to teaser', () => {
    const port = portFor(full);
    const { ctx } = makeContext(port, { focusModuleApiName: 'Deals' });
    const container = attach();
    const dispose = mountBoardView(container, ctx);
    boardControllerFor(container)?.flush();
    const fullText = domText(container);
    expect(fullText).toContain('partner_reviews');
    const teaser = createFixturePort('teaser').port.snapshot();
    port.publish(teaser);
    const forbidden = leakable(full, teaser.graph);
    const text = domText(container);
    expect(forbidden.filter((s) => text.includes(s.toLowerCase()))).toEqual([]);
    expect(container.querySelectorAll('.amc-fog').length).toBe(
      summarizeFog(teaser.teaser as TeaserFog).areas.length,
    );
    // ...and back: the fog disappears with the entitlement.
    port.publish({ ...teaser, access: { level: 'full' }, teaser: null, graph: full });
    expect(container.querySelectorAll('.amc-fog').length).toBe(0);
    dispose();
  });

  it('opens the upgrade modal from a fog island and from the lock chip', () => {
    const { port } = createFixturePort('teaser');
    const { ctx } = makeContext(port);
    const spy = vi.spyOn(port, 'requestUpgrade');
    const container = attach();
    const dispose = mountBoardView(container, ctx);
    boardControllerFor(container)?.flush();
    const fog = container.querySelector('.amc-fog') as HTMLElement;
    fire(fog, 'click');
    expect(spy).toHaveBeenCalledTimes(1);
    fog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('pauses drift for reduced motion and a hidden tab', () => {
    const { port } = createFixturePort('teaser');
    const { ctx } = makeContext(port);
    const container = attach();
    const dispose = mountBoardView(container, ctx);
    boardControllerFor(container)?.flush();
    const layer = container.querySelector('.amc-fog-layer') as HTMLElement;
    // The matchMedia stub reports reduced motion.
    expect(layer.classList.contains('amc-fog-still')).toBe(true);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(layer.classList.contains('amc-fog-paused')).toBe(true);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(layer.classList.contains('amc-fog-paused')).toBe(false);
    dispose();
  });

  it('reads as soft fog: no dot grid, a continuous haze, outlines that differ per island', () => {
    const { port } = createFixturePort('teaser');
    const { ctx } = makeContext(port);
    const container = attach();
    const dispose = mountBoardView(container, ctx);
    boardControllerFor(container)?.flush();
    // The dot grid is gone under fog (it showed through the mist like a texture glitch).
    expect(container.querySelector('.amc-canvas')?.classList.contains('amc-nogrid')).toBe(true);
    // One static sheet and a bounded handful of drifting puffs, however many islands there are.
    expect(container.querySelectorAll('.amc-fog-sheet').length).toBe(1);
    const puffs = container.querySelectorAll('.amc-haze').length;
    expect(puffs).toBeGreaterThanOrEqual(5);
    expect(puffs).toBeLessThanOrEqual(12);
    expect(container.querySelector('.amc-mist')).toBeNull();
    // Every island has its own outline, made only of numbers and CSS keywords.
    const outlines = new Set([1, 2, 3, 4, 5].map((slot) => fogOutline(slot, 1296, 700)));
    expect(outlines.size).toBe(5);
    for (const outline of outlines) expect(outline).toMatch(/^[\d\s.%,()a-z-]+$/);
    dispose();
  });

  it('draws each island from its own outline, with no mask or clip to hide a rectangle', () => {
    // Live: the backdrop showed straight-edged panels at overview, the island boxes with their
    // masks missing. Every layer must now fade to nothing before its own box edge.
    const { port } = createFixturePort('teaser');
    const { ctx } = makeContext(port);
    const container = attach();
    const dispose = mountBoardView(container, ctx);
    boardControllerFor(container)?.flush();
    const bodies = [...container.querySelectorAll<HTMLElement>('.amc-fog-body')];
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body.style.background).toContain('radial-gradient');
      expect(body.style.getPropertyValue('mask-image')).toBe('');
      expect(body.style.getPropertyValue('-webkit-mask-image')).toBe('');
    }
    // The stylesheet does not bring the mask or the clip back (vitest hands `?inline` CSS back
    // empty, so read the source).
    const fogCss = canvasCssSource('fog');
    const fogRules = fogCss
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .filter((rule) => /\.amc-fog-body|\.amc-clouds|\.amc-fog-sil/.test(rule.split('{')[0]));
    expect(fogRules.length).toBeGreaterThan(0);
    for (const rule of fogRules) {
      expect(rule).not.toMatch(/mask/);
      expect(rule).not.toMatch(/overflow\s*:\s*hidden/);
    }
    // Every cloud gradient ends inside its own box: no ellipse is wider than its distance to an
    // edge allows (centre +/- 0.76 radius stays within 0-100%).
    const clouds = fogCss.match(/\.amc-c[12] \{[^}]*\}/g) ?? [];
    expect(clouds.length).toBe(2);
    for (const rule of clouds)
      for (const m of rule.matchAll(
        /ellipse\s+([\d.]+)%\s+([\d.]+)%\s+at\s+([\d.]+)%\s+([\d.]+)%/g,
      )) {
        const [rx, ry, cx, cy] = m.slice(1).map(Number);
        expect(cx - rx * 0.76, m[0]).toBeGreaterThanOrEqual(0);
        expect(cx + rx * 0.76, m[0]).toBeLessThanOrEqual(100);
        expect(cy - ry * 0.76, m[0]).toBeGreaterThanOrEqual(0);
        expect(cy + ry * 0.76, m[0]).toBeLessThanOrEqual(100);
      }
    dispose();
  });

  it('keeps every outline lobe inside its island and rounds wide, flat islands into banks', () => {
    for (const [w, h] of [
      [1296, 370],
      [960, 3900],
      [1296, 3900],
      [1296, 1296],
    ] as const)
      for (const slot of [1, 2, 3, 9, 41]) {
        const lobes = fogLobes(slot, w, h);
        expect(lobes.length).toBeGreaterThanOrEqual(3);
        for (const l of lobes) {
          expect(l.cx - l.rx, `${slot} ${w}x${h} left`).toBeGreaterThanOrEqual(0);
          expect(l.cx + l.rx, `${slot} ${w}x${h} right`).toBeLessThanOrEqual(w);
          expect(l.cy - l.ry, `${slot} ${w}x${h} top`).toBeGreaterThanOrEqual(0);
          expect(l.cy + l.ry, `${slot} ${w}x${h} bottom`).toBeLessThanOrEqual(h);
        }
        // Round lobes along the long axis (the broad joining lobe is the last one).
        for (const l of lobes.slice(0, -1)) expect(l.rx).toBeCloseTo(l.ry, 5);
      }
  });

  it('fades every silhouette puff to nothing inside the canvas', () => {
    const puffs: Array<{ x: number; y: number; reach: number; squash: number }> = [];
    let at = { x: 0, y: 0 };
    let squash = 1;
    const gradient = { addColorStop: () => {} };
    const fake = {
      save: () => {},
      restore: () => {},
      translate: (x: number, y: number) => {
        at = { x, y };
      },
      scale: (_x: number, y: number) => {
        squash = y;
      },
      beginPath: () => {},
      arc: (_x: number, _y: number, reach: number) => {
        puffs.push({ ...at, reach, squash });
      },
      fill: () => {},
      createRadialGradient: () => gradient,
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake);
    for (const flat of [false, true]) {
      puffs.length = 0;
      const f = {
        slot: 11,
        counts: { rules: 40, functions: 60, buttons: 2, schedules: 0 },
        recordWrites: 20,
      };
      const cv = document.createElement('canvas');
      paintFogSilhouettes(cv, f, { w: 1296, h: fogGeometry(f).h, top: 0, flat });
      expect(puffs.length).toBeGreaterThan(10);
      for (const p of puffs) {
        expect(p.x - p.reach).toBeGreaterThanOrEqual(-0.51);
        expect(p.x + p.reach).toBeLessThanOrEqual(cv.width + 0.51);
        expect(p.y - p.reach * p.squash).toBeGreaterThanOrEqual(-0.51);
        expect(p.y + p.reach * p.squash).toBeLessThanOrEqual(cv.height + 0.51);
      }
    }
  });

  it('paints a few soft masses per lane, never one blob per row', () => {
    const calls = { puffs: 0, fills: 0 };
    const gradient = { addColorStop: () => {} };
    const fake = {
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      beginPath: () => {},
      arc: () => {
        calls.puffs++;
      },
      fill: () => {
        calls.fills++;
      },
      createRadialGradient: () => gradient,
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake);
    const huge = {
      slot: 7,
      counts: { rules: 60, functions: 90, buttons: 3, schedules: 0 },
      recordWrites: 40,
    };
    paintFogSilhouettes(document.createElement('canvas'), huge, {
      w: 1296,
      h: fogGeometry(huge).h,
      top: 0,
    });
    // Five lanes, at most 8 masses of at most 5 puffs each, plus two shading puffs.
    expect(calls.puffs).toBeGreaterThan(10);
    expect(calls.puffs).toBeLessThanOrEqual(5 * 8 * 5 + 2);
    expect(calls.fills).toBe(calls.puffs);
  });

  it('sizes fog from counts only', () => {
    const small = {
      slot: 1,
      counts: { rules: 2, functions: 3, buttons: 0, schedules: 0 },
      recordWrites: 0,
    };
    const large = {
      slot: 2,
      counts: { rules: 30, functions: 50, buttons: 2, schedules: 0 },
      recordWrites: 9,
    };
    const org = {
      slot: 3,
      counts: { rules: 0, functions: 12, buttons: 0, schedules: 3 },
      recordWrites: 0,
    };
    expect(fogGeometry(large).h).toBeGreaterThan(fogGeometry(small).h);
    expect(isOrgLike(org)).toBe(true);
    expect(fogGeometry(org).w).toBeLessThan(fogGeometry(small).w);
    expect(fogChipText(large)).toBe('30 rules · 50 functions · 2 buttons');
    expect(fogChipText(org)).toBe('3 schedules · 12 API functions');
  });
});
