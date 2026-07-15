import { describe, expect, it } from 'vitest';
import { highlightSource } from '../src/content/functions/highlight-source';

function render(source: string, query = ''): HTMLElement {
  const pre = document.createElement('pre');
  for (const node of highlightSource(source, query)) {
    pre.appendChild(node);
  }
  return pre;
}

describe('highlightSource', () => {
  it('wraps classified tokens in data-zcdt-token spans and preserves the source text', () => {
    const source = 'info "hi";';
    const pre = render(source);

    expect(pre.textContent).toBe(source);
    expect(pre.querySelector('[data-zcdt-token="control"]')?.textContent).toBe('info');
    expect(pre.querySelector('[data-zcdt-token="string"]')?.textContent).toBe('"hi"');
  });

  it('keeps whitespace and indentation as plain text nodes', () => {
    const pre = render('\tx = 1;');
    expect(pre.textContent).toBe('\tx = 1;');
  });

  it('renders only token spans when there is no search query', () => {
    const pre = render('info x;');
    expect(pre.querySelector('mark')).toBeNull();
  });

  it('marks the search term inside a token span, keeping the token colour', () => {
    const pre = render('getRecords()', 'record');
    const callable = pre.querySelector('[data-zcdt-token="callable"]');
    const mark = callable?.querySelector('mark');

    expect(mark?.textContent).toBe('Record');
    // The mark sits inside the coloured token span, so it inherits the token colour.
    expect(callable?.textContent).toBe('getRecords');
    expect(pre.textContent).toBe('getRecords()');
  });

  it('marks a match that straddles a token boundary in each token it touches', () => {
    // "x=1" spans the variable, operator, and number tokens.
    const pre = render('x=1', 'x=1');
    const marks = [...pre.querySelectorAll('mark')].map((mark) => mark.textContent);

    expect(marks).toEqual(['x', '=', '1']);
    expect(pre.querySelector('[data-zcdt-token="variable"] mark')?.textContent).toBe('x');
    expect(pre.querySelector('[data-zcdt-token="operator"] mark')?.textContent).toBe('=');
    expect(pre.querySelector('[data-zcdt-token="number"] mark')?.textContent).toBe('1');
  });

  it('never parses source as HTML', () => {
    const pre = render('x = "<b>y</b>";', 'b');
    expect(pre.querySelector('b')).toBeNull();
    expect(pre.textContent).toBe('x = "<b>y</b>";');
  });
});
