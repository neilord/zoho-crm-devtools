/**
 * Renders Deluge source for the dashboard code preview: syntax-token spans with
 * the search term highlighted on top.
 *
 * The tokenizer supplies `data-zcdt-token` spans (coloured by the shared
 * `--zcdt-syntax-*` palette); the search match is composited WITHIN those spans
 * by wrapping matched substrings in `<mark>`, so a hit keeps its token colour
 * and gains the highlight background. Matches are computed over the whole source
 * and sliced per token, so a match that straddles a token boundary is marked in
 * each token it touches. Everything goes through `textContent`, so untrusted
 * source is never parsed as HTML.
 */

import { tokenizeDeluge } from '../../syntax/deluge-tokenizer';
import { SYNTAX_TOKEN_ATTR } from '../../syntax/syntax-highlighting';

/** Case-insensitive, non-overlapping match ranges of `query` within `source`. */
function matchRanges(source: string, query: string): Array<[number, number]> {
  if (!query) {
    return [];
  }
  const haystack = source.toLowerCase();
  const needle = query.toLowerCase();
  const ranges: Array<[number, number]> = [];

  let index = haystack.indexOf(needle);
  while (index !== -1) {
    ranges.push([index, index + needle.length]);
    index = haystack.indexOf(needle, index + needle.length);
  }
  return ranges;
}

/**
 * Child nodes for the `[start, end)` slice of `source`, wrapping the parts that
 * overlap a match range in `<mark>` and leaving the rest as plain text.
 */
function sliceWithMatches(
  source: string,
  start: number,
  end: number,
  ranges: Array<[number, number]>,
): Array<Text | HTMLElement> {
  const children: Array<Text | HTMLElement> = [];
  let cursor = start;

  for (const [matchStart, matchEnd] of ranges) {
    if (matchEnd <= start || matchStart >= end) {
      continue;
    }
    const overlapStart = Math.max(matchStart, start);
    const overlapEnd = Math.min(matchEnd, end);
    if (overlapStart > cursor) {
      children.push(document.createTextNode(source.slice(cursor, overlapStart)));
    }
    const mark = document.createElement('mark');
    mark.textContent = source.slice(overlapStart, overlapEnd);
    children.push(mark);
    cursor = overlapEnd;
  }

  if (cursor < end) {
    children.push(document.createTextNode(source.slice(cursor, end)));
  }
  return children;
}

/**
 * Builds the token-highlighted nodes for a `<pre class="fs-code">`. When `query`
 * is empty the result is just the token spans; otherwise the search term is
 * marked on top of them.
 */
export function highlightSource(source: string, query: string): Array<Text | HTMLElement> {
  const tokens = tokenizeDeluge(source);
  const ranges = matchRanges(source, query);
  const nodes: Array<Text | HTMLElement> = [];

  for (const token of tokens) {
    const children = sliceWithMatches(source, token.start, token.end, ranges);
    if (token.token === null) {
      // Whitespace / unclassified runs render inline so indentation is preserved.
      for (const child of children) {
        nodes.push(child);
      }
      continue;
    }
    const span = document.createElement('span');
    span.setAttribute(SYNTAX_TOKEN_ATTR, token.token);
    for (const child of children) {
      span.appendChild(child);
    }
    nodes.push(span);
  }

  if (nodes.length === 0) {
    nodes.push(document.createTextNode(source));
  }
  return nodes;
}
