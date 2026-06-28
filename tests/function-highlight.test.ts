import { describe, expect, it } from 'vitest';
import { highlightNodes } from '../src/content/functions/dom';

function serialize(nodes: Array<Text | HTMLElement>): string {
  return nodes
    .map((node) => (node instanceof HTMLElement ? `[${node.textContent}]` : node.textContent))
    .join('');
}

describe('highlightNodes', () => {
  it('returns a single text node when there is no query', () => {
    const nodes = highlightNodes('GetRate', '');
    expect(nodes).toHaveLength(1);
    expect(serialize(nodes)).toBe('GetRate');
  });

  it('returns a single text node when nothing matches', () => {
    const nodes = highlightNodes('GetRate', 'xyz');
    expect(nodes).toHaveLength(1);
    expect(serialize(nodes)).toBe('GetRate');
  });

  it('wraps a single match in a mark element', () => {
    const nodes = highlightNodes('LIVE_GetRate', 'rate');
    expect(serialize(nodes)).toBe('LIVE_Get[Rate]');
    expect(nodes.some((node) => node instanceof HTMLElement && node.tagName === 'MARK')).toBe(true);
  });

  it('matches case-insensitively but preserves original casing', () => {
    const nodes = highlightNodes('getRecords', 'RECORD');
    expect(serialize(nodes)).toBe('get[Record]s');
  });

  it('wraps every occurrence', () => {
    const nodes = highlightNodes('abcabc', 'a');
    expect(serialize(nodes)).toBe('[a]bc[a]bc');
  });

  it('never uses innerHTML, so markup in the text stays literal', () => {
    const nodes = highlightNodes('<b>x</b>', 'x');
    const container = document.createElement('div');
    for (const node of nodes) {
      container.appendChild(node);
    }
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toBe('<b>x</b>');
  });
});
