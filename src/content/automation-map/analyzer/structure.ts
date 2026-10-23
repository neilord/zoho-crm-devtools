import { tokenizeDeluge } from '../../../syntax/deluge-tokenizer';
import type { SourceSpan } from './types';

export interface Token extends SourceSpan {
  text: string;
  literal: boolean;
}
export interface Structure {
  tokens: Token[];
  pairs: Map<number, number>;
  tokenCount: number;
  malformed: SourceSpan[];
  depth: number;
}

/** Reuse the highlighter once, splitting only member tokens into syntax segments. */
export function readStructure(source: string): Structure {
  const raw = tokenizeDeluge(source);
  const tokens: Token[] = [];
  const malformed: SourceSpan[] = [];
  for (const token of raw) {
    const end = Math.min(source.length, token.end);
    if (token.token === 'comment') {
      if (token.text.startsWith('/*') && !token.text.endsWith('*/'))
        malformed.push({ start: token.start, end });
      continue;
    }
    if (token.token === 'string') {
      let i = 1;
      while (i < token.text.length && token.text[i] !== token.text[0])
        i += token.text[i] === '\\' ? 2 : 1;
      if (i !== token.text.length - 1) malformed.push({ start: token.start, end });
      tokens.push({ text: token.text, start: token.start, end, literal: true });
    } else if (token.text.startsWith('.') && /^\.[A-Za-z_]/.test(token.text)) {
      for (const match of token.text.matchAll(/\.|[A-Za-z_][A-Za-z_0-9]*/g)) {
        tokens.push({
          text: match[0],
          start: token.start + match.index,
          end: token.start + match.index + match[0].length,
          literal: false,
        });
      }
    } else if (token.text.trim())
      tokens.push({ text: token.text, start: token.start, end, literal: false });
  }
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  let depth = 0;
  const closing: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  tokens.forEach((t, i) => {
    if (t.literal) return;
    if (['(', '[', '{'].includes(t.text)) {
      stack.push(i);
      depth = Math.max(depth, stack.length);
    } else if (Object.hasOwn(closing, t.text)) {
      const open = stack[stack.length - 1];
      if (open === undefined || tokens[open].text !== closing[t.text])
        malformed.push({ start: t.start, end: t.end });
      else {
        stack.pop();
        pairs.set(open, i);
        pairs.set(i, open);
      }
    }
  });
  for (const i of stack) malformed.push({ start: tokens[i].start, end: source.length });
  return { tokens, pairs, tokenCount: raw.length, malformed, depth };
}

/** Decode a Deluge literal without evaluating it or interpreting it as code. */
export function decodeLiteral(text: string): string {
  const inner = text.slice(1, -1);
  return inner.replace(/\\(u[\da-fA-F]{4}|[\s\S])/g, (_, c: string) => {
    if (c.startsWith('u') && c.length === 5)
      return String.fromCharCode(Number.parseInt(c.slice(1), 16));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[c] ?? c;
  });
}
