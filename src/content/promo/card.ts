import { closeIcon, el } from '../functions/dom';
import promoCss from './card.css?inline';

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

function sparkleIcon(size = 16): SVGSVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('viewBox', '0 0 20 20');
  root.setAttribute('width', String(size));
  root.setAttribute('height', String(size));
  root.setAttribute('fill', 'currentColor');
  root.setAttribute('aria-hidden', 'true');
  const big = document.createElementNS(SVG_NS, 'path');
  big.setAttribute('d', 'M9 2 L10.6 7.4 L16 9 L10.6 10.6 L9 16 L7.4 10.6 L2 9 L7.4 7.4 Z');
  const small = document.createElementNS(SVG_NS, 'path');
  small.setAttribute(
    'd',
    'M15.5 12.5 L16.2 14.8 L18.5 15.5 L16.2 16.2 L15.5 18.5 L14.8 16.2 L12.5 15.5 L14.8 14.8 Z',
  );
  root.append(big, small);
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

  const card = el(
    'section',
    {
      className: 'promo-card',
      attrs: { role: 'complementary', 'aria-label': 'Zoho CRM AI Assistant' },
    },
    [
      el('div', { className: 'promo-header' }, [
        el('span', { className: 'promo-badge' }, [sparkleIcon()]),
        el('span', {
          className: 'promo-eyebrow',
          text: 'New from the makers of Zoho CRM DevTools',
        }),
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
    ],
  );

  shadow.appendChild(card);
  document.body.appendChild(host);

  if (autoHideMs > 0) {
    autoHideTimer = setTimeout(() => settle('ignored'), autoHideMs);
  }

  return { host, close };
}
