export function mapIcon(size = 17): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({
    width: String(size),
    height: String(size),
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(key, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M2 4l5-2 6 2 5-2v14l-5 2-6-2-5 2V4zm5-2v14m6-12v14');
  svg.append(path);
  return svg;
}
