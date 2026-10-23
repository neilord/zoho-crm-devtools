import { tokenizeDeluge } from '../../../syntax/deluge-tokenizer';
import type { SourceSpan as AnalyzerSpan, TriggerPolicy, WriteEffect } from '../analyzer';
import type { SourceSpan, WriteOperation } from '../types';

export function operation(op: WriteEffect['op']): WriteOperation {
  switch (op) {
    case 'bulk-create':
      return 'create';
    case 'bulk-update':
      return 'update';
    case 'update-related':
      return 'relate';
    case 'add-tags':
    case 'remove-tags':
    case 'crm-mutation':
      return 'other';
    default:
      return op;
  }
}

export function mayRunWorkflows(policy: TriggerPolicy): boolean {
  switch (policy.mode) {
    case 'explicit-empty':
    case 'not-applicable':
      return false;
    case 'explicit':
      return policy.requested?.includes('workflow') === true || policy.confidence !== 'exact';
    case 'documented-default':
      return policy.documentedDefault?.includes('workflow') === true;
    case 'unknown':
      return true;
  }
}

/** One lookup table per source; UTF-16 offsets and CRLF agree with the analyzer. */
export function sourceSpans(source: string): (spans: readonly AnalyzerSpan[]) => SourceSpan[] {
  const lines = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lines.push(i + 1);
  return (spans) =>
    spans.map(({ start, end }) => {
      let lo = 0,
        hi = lines.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (lines[mid] <= start) lo = mid + 1;
        else hi = mid;
      }
      return { start, end, line: lo };
    });
}

export function urlHost(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The analyzer intentionally omits URLs. Inspect only its HTTP block's `url:` literal,
 * never strings in payloads/comments. Variable URLs remain an explicit unknown host. */
export function httpHost(source: string, span: AnalyzerSpan): string | null {
  const tokens = tokenizeDeluge(source.slice(span.start, span.end)).filter(
    (t) => t.token !== 'comment' && t.text.trim(),
  );
  let depth = 0;
  let host: string | null = null;
  let urlKeys = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.token === 'string') continue;
    if (['[', '{', '('].includes(token.text)) depth++;
    if ([']', '}', ')'].includes(token.text)) depth--;
    if (depth !== 1 || token.text !== 'url' || tokens[i + 1]?.text !== ':') continue;
    urlKeys++;
    if (tokens[i + 2]?.token !== 'string') continue;
    const text = tokens[i + 2].text;
    const literal = text
      .slice(1, -1)
      .replace(/\\(u[\da-fA-F]{4}|[\s\S])/g, (_, c: string) =>
        c.startsWith('u') && c.length === 5
          ? String.fromCharCode(Number.parseInt(c.slice(1), 16))
          : (({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[c] ?? c),
      );
    // A runtime suffix cannot change an already terminated literal authority.
    if (tokens[i + 3]?.text === '+' && !/^https?:\/\/[^/]+\//i.test(literal)) continue;
    host = urlHost(literal);
  }
  return urlKeys === 1 ? host : null;
}
