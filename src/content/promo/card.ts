import { closeIcon, el } from '../functions/dom';
import promoCss from './card.css?inline';
import { AI_ASSISTANT_ICON_DATA_URL } from './icon';

/**
 * The Zoho CRM AI Assistant promo card: a non-blocking corner card rendered in
 * its own shadow root. It owns no policy; the caller decides when to show it and
 * what each outcome means.
 */

export const PROMO_HOST_ID = 'zcdt-ai-assistant-promo';

export const AI_ASSISTANT_STORE_URL =
  'https://chromewebstore.google.com/detail/fmkeihieagalignogegiehmcjbflglgk' +
  '?utm_source=zoho-crm-devtools&utm_medium=extension&utm_campaign=ai-assistant-launch&utm_content=corner-card';

/** How long an untouched card stays before it is treated as ignored. */
export const PROMO_AUTO_HIDE_MS = 45_000;

export type PromoOutcome = 'install' | 'later' | 'close' | 'ignored';

export interface PromoCardHandle {
  host: HTMLDivElement;
  close(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Filled green circle with a white check, for the illustration's "done" row. */
function checkIcon(size = 14): SVGSVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('class', 'promo-check');
  root.setAttribute('viewBox', '0 0 20 20');
  root.setAttribute('width', String(size));
  root.setAttribute('height', String(size));
  root.setAttribute('aria-hidden', 'true');
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '10');
  circle.setAttribute('cy', '10');
  circle.setAttribute('r', '10');
  circle.setAttribute('fill', 'currentColor');
  const tick = document.createElementNS(SVG_NS, 'path');
  tick.setAttribute('d', 'M6 10.5l2.5 2.5L14 7.5');
  tick.setAttribute('fill', 'none');
  tick.setAttribute('stroke', '#ffffff');
  tick.setAttribute('stroke-width', '2');
  tick.setAttribute('stroke-linecap', 'round');
  tick.setAttribute('stroke-linejoin', 'round');
  root.append(circle, tick);
  return root;
}

export function showPromoCard(
  onOutcome: (outcome: PromoOutcome) => void,
  autoHideMs = PROMO_AUTO_HIDE_MS,
): PromoCardHandle {
  const existing = document.getElementById(PROMO_HOST_ID);
  existing?.remove();

  const host = document.createElement('div');
  host.id = PROMO_HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = promoCss;
  shadow.appendChild(style);

  let settled = false;
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;

  const close = (): void => {
    if (autoHideTimer !== null) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
    host.remove();
  };

  const settle = (outcome: PromoOutcome): void => {
    if (settled) {
      return;
    }
    settled = true;
    close();
    onOutcome(outcome);
  };

  const installLink = el('a', {
    className: 'promo-install',
    text: 'Install free',
    attrs: { href: AI_ASSISTANT_STORE_URL, target: '_blank', rel: 'noopener noreferrer' },
    // Let the anchor open its tab natively; the card just records the outcome.
    onClick: () => settle('install'),
  });

  const icon = el('img', {
    className: 'promo-icon',
    attrs: { src: AI_ASSISTANT_ICON_DATA_URL, alt: '', width: '32', height: '32' },
  });

  // A DOM-built glimpse of the side panel: crisp at any zoom and a few hundred
  // bytes, where a real screenshot at card width would be unreadable.
  const illustration = el('div', { className: 'promo-hero', attrs: { 'aria-hidden': 'true' } }, [
    el('div', { className: 'promo-panel' }, [
      el('div', {
        className: 'promo-msg promo-msg-user',
        text: 'Move the Acme deal to Negotiation',
      }),
      el('div', { className: 'promo-msg promo-msg-bot' }, [
        checkIcon(),
        el('span', { text: 'Done — Acme is now in Negotiation.' }),
        el('span', { className: 'promo-chip', text: 'Approved by you' }),
      ]),
    ]),
  ]);

  const card = el(
    'section',
    {
      className: 'promo-card',
      attrs: { role: 'complementary', 'aria-label': 'Zoho CRM AI Assistant' },
    },
    [
      el(
        'button',
        {
          className: 'promo-close',
          type: 'button',
          title: 'Close',
          attrs: { 'aria-label': 'Close' },
          onClick: (event) => {
            event.preventDefault();
            settle('close');
          },
        },
        [closeIcon(16)],
      ),
      illustration,
      el('div', { className: 'promo-content' }, [
        el('div', { className: 'promo-header' }, [
          icon,
          el('span', {
            className: 'promo-eyebrow',
            text: 'New from the makers of Zoho CRM DevTools',
          }),
        ]),
        el('h2', { className: 'promo-title', text: 'Meet Zoho CRM AI Assistant' }),
        el('p', {
          className: 'promo-body',
          text:
            'Create leads, update deals, and find records by typing what you need — from a side ' +
            'panel right inside Zoho CRM. You approve every write. Try it yourself, or suggest it ' +
            'to your reps.',
        }),
        el('div', { className: 'promo-actions' }, [
          installLink,
          el('button', {
            className: 'promo-later',
            type: 'button',
            text: 'Remind me later',
            onClick: (event) => {
              event.preventDefault();
              settle('later');
            },
          }),
        ]),
      ]),
    ],
  );

  shadow.appendChild(card);
  document.body.appendChild(host);

  if (autoHideMs > 0) {
    autoHideTimer = setTimeout(() => settle('ignored'), autoHideMs);
  }

  return { host, close };
}
