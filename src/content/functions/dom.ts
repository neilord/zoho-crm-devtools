/**
 * Tiny DOM builders used by the overlay UI. Everything goes through `textContent`
 * and explicit element creation so untrusted function names, descriptions, and
 * source never reach `innerHTML`.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ElementOptions {
  className?: string;
  text?: string;
  title?: string;
  type?: string;
  attrs?: Record<string, string>;
  dataset?: Record<string, string>;
  onClick?: (event: Event) => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: Array<Node | null | undefined> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.title) {
    node.title = options.title;
  }
  if (options.type && node instanceof HTMLButtonElement) {
    node.type = options.type as HTMLButtonElement['type'];
  }
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      node.setAttribute(key, value);
    }
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      node.dataset[key] = value;
    }
  }
  if (options.onClick) {
    node.addEventListener('click', options.onClick);
  }
  for (const child of children) {
    if (child) {
      node.appendChild(child);
    }
  }
  return node;
}

function svg(size: number, build: (root: SVGSVGElement) => void): SVGSVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('viewBox', '0 0 20 20');
  root.setAttribute('width', String(size));
  root.setAttribute('height', String(size));
  root.setAttribute('fill', 'none');
  root.setAttribute('stroke', 'currentColor');
  root.setAttribute('stroke-width', '1.4');
  root.setAttribute('stroke-linecap', 'round');
  root.setAttribute('stroke-linejoin', 'round');
  root.setAttribute('aria-hidden', 'true');
  build(root);
  return root;
}

function path(d: string): SVGPathElement {
  const node = document.createElementNS(SVG_NS, 'path');
  node.setAttribute('d', d);
  return node;
}

function circle(cx: number, cy: number, r: number): SVGCircleElement {
  const node = document.createElementNS(SVG_NS, 'circle');
  node.setAttribute('cx', String(cx));
  node.setAttribute('cy', String(cy));
  node.setAttribute('r', String(r));
  return node;
}

export function searchIcon(size = 18): SVGSVGElement {
  return svg(size, (root) => {
    root.appendChild(circle(8.5, 8.5, 5.5));
    root.appendChild(path('M13 13 L17 17'));
  });
}

export function closeIcon(size = 18): SVGSVGElement {
  return svg(size, (root) => {
    root.appendChild(path('M5 5 L15 15'));
    root.appendChild(path('M15 5 L5 15'));
  });
}

export function backIcon(size = 18): SVGSVGElement {
  return svg(size, (root) => {
    root.appendChild(path('M12 4 L6 10 L12 16'));
  });
}

export function editIcon(size = 16): SVGSVGElement {
  return svg(size, (root) => {
    root.appendChild(path('M4 14 L4 16 L6 16 L15 7 L13 5 Z'));
    root.appendChild(path('M12 6 L14 8'));
  });
}
