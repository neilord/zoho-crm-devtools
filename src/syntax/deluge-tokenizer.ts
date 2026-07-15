/**
 * A small, dependency-free Deluge tokenizer for the function-search dashboard
 * preview.
 *
 * It is deliberately DOM-free: text in, tokens out. That keeps it pure (trivial
 * to unit-test) and leaves a future CodeMirror-overlay reuse open. The live
 * editor is contractually forbidden from being re-tokenized, so this shares only
 * the COLOUR VOCABULARY with `syntax-highlighting.ts` (the `data-zcdt-token`
 * categories from `deluge-vocabulary.ts`), never an engine.
 *
 * The output tokens tile the source with no gaps: concatenating every `text`
 * reproduces the input exactly, so the renderer can rebuild the code verbatim.
 * `token` is one of the `data-zcdt-token` categories, or `null` for whitespace
 * and anything unclassified.
 */

import {
  CONTROL_WORDS,
  HTTP_METHOD_WORDS,
  isServiceNamespaceRoot,
  TYPE_WORDS,
} from './deluge-vocabulary';

export interface DelugeToken {
  text: string;
  /** A `data-zcdt-token` category, or `null` for whitespace / unclassified runs. */
  token: string | null;
  start: number;
  end: number;
}

/**
 * Deluge boolean/null literals. The live editor gets these from CodeMirror's
 * `cm-atom`/`cm-constant` classes; the tokenizer has no DOM to lean on, so it
 * recognizes them by word. This set is tokenizer-only on purpose — the editor
 * never classifies constants by word, so there is nothing to keep in sync.
 */
const CONSTANT_WORDS = new Set(['true', 'false', 'null']);

const MULTI_CHAR_OPERATORS = ['&&', '||', '==', '!=', '<=', '>=', '->'];
const LOGICAL_OPERATOR_TEXT = new Set(['&&', '||', '!']);
const COMPARISON_OPERATOR_TEXT = new Set(['==', '!=', '<=', '>=', '<', '>']);

const WHITESPACE = /\s/;
const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

function isIdentifierStart(char: string): boolean {
  return IDENTIFIER_START.test(char);
}

function isIdentifierPart(char: string): boolean {
  return IDENTIFIER_PART.test(char);
}

/** The next significant (non-whitespace, non-comment) character at or after `from`. */
function peekSignificantChar(source: string, from: number): string {
  let index = from;
  while (index < source.length) {
    const char = source[index];
    if (WHITESPACE.test(char)) {
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }
    return char;
  }
  return '';
}

/** Classify a bare (dot-free) identifier using the same precedence as `getSemanticToken`. */
function classifyIdentifier(text: string, previousWord: string, nextChar: string): string {
  // A `for each` loop's `index` keyword reads as control, matching the editor.
  if (text === 'index' && previousWord === 'each') {
    return 'control';
  }
  if (CONTROL_WORDS.has(text)) {
    return 'control';
  }
  if (text === 'invokeurl') {
    return 'special-form';
  }
  if (HTTP_METHOD_WORDS.has(text) && previousWord === ':') {
    return 'http-method';
  }
  if (CONSTANT_WORDS.has(text)) {
    return 'constant';
  }
  if (text === 'zoho') {
    return 'namespace';
  }
  if (isServiceNamespaceRoot(text)) {
    return 'service-namespace';
  }
  if (TYPE_WORDS.has(text)) {
    return 'type';
  }
  // A block key such as `url:` or `type:` in an `invokeurl` block.
  if (nextChar === ':') {
    return 'block-key';
  }
  // A signature name (`string getName(...)`) or any other call target reads as callable.
  if (nextChar === '(') {
    return 'callable';
  }
  return 'variable';
}

export function tokenizeDeluge(source: string): DelugeToken[] {
  const tokens: DelugeToken[] = [];
  let index = 0;
  // Text of the last classifiable token, used for context-sensitive rules
  // (`type:` block keys, HTTP method after `:`, `for each index`).
  let previousWord = '';

  const push = (token: string | null, start: number, end: number): void => {
    tokens.push({ text: source.slice(start, end), token, start, end });
  };

  while (index < source.length) {
    const char = source[index];
    const start = index;

    // Whitespace runs stay as null tokens so indentation survives rendering.
    if (WHITESPACE.test(char)) {
      while (index < source.length && WHITESPACE.test(source[index])) {
        index += 1;
      }
      push(null, start, index);
      continue;
    }

    // Line comment.
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      push('comment', start, index);
      previousWord = '';
      continue;
    }

    // Block comment (unterminated comments run to end of source).
    if (char === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index = Math.min(index + 2, source.length);
      push('comment', start, index);
      previousWord = '';
      continue;
    }

    // Single- or double-quoted string with backslash escapes.
    if (char === '"' || char === "'") {
      const quote = char;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      push('string', start, index);
      previousWord = '';
      continue;
    }

    // Number literal (a `.` between digits stays part of the number, not a member access).
    if (DIGIT.test(char)) {
      index += 1;
      while (index < source.length && (DIGIT.test(source[index]) || source[index] === '.')) {
        index += 1;
      }
      push('number', start, index);
      previousWord = '';
      continue;
    }

    // Member access: `.member(.member)*` starting a token (e.g. after `zoho`, `)` or `]`).
    // Method when the whole chain is called, property otherwise.
    if (char === '.' && isIdentifierStart(source[index + 1] ?? '')) {
      index += 1;
      while (index < source.length && isIdentifierPart(source[index])) {
        index += 1;
      }
      while (
        index < source.length &&
        source[index] === '.' &&
        isIdentifierStart(source[index + 1] ?? '')
      ) {
        index += 1;
        while (index < source.length && isIdentifierPart(source[index])) {
          index += 1;
        }
      }
      const next = peekSignificantChar(source, index);
      push(next === '(' ? 'method' : 'property', start, index);
      previousWord = '';
      continue;
    }

    // Identifier / keyword. A dotted chain is split into its root token and a
    // trailing member-access token, so `zoho.crm.getRecords(` colours `zoho` as
    // a namespace and `.crm.getRecords` as a method — matching the editor.
    if (isIdentifierStart(char)) {
      while (index < source.length && isIdentifierPart(source[index])) {
        index += 1;
      }
      const word = source.slice(start, index);
      const hasMemberAccess = source[index] === '.' && isIdentifierStart(source[index + 1] ?? '');
      // Deluge's `in` (as in `for each ... in list`) reads as a comparison operator.
      if (word === 'in') {
        push('comparison-operator', start, index);
        previousWord = word;
        continue;
      }
      const nextChar = hasMemberAccess ? '.' : peekSignificantChar(source, index);
      push(classifyIdentifier(word, previousWord, nextChar), start, index);
      previousWord = word;
      continue;
    }

    // Multi-character operators before single characters so `==` beats `=`.
    const twoChar = source.slice(index, index + 2);
    if (MULTI_CHAR_OPERATORS.includes(twoChar)) {
      index += 2;
      const category = LOGICAL_OPERATOR_TEXT.has(twoChar)
        ? 'logical-operator'
        : COMPARISON_OPERATOR_TEXT.has(twoChar)
          ? 'comparison-operator'
          : 'operator';
      push(category, start, index);
      previousWord = twoChar;
      continue;
    }

    // Brackets.
    if (
      char === '(' ||
      char === ')' ||
      char === '[' ||
      char === ']' ||
      char === '{' ||
      char === '}'
    ) {
      index += 1;
      push('bracket', start, index);
      previousWord = char;
      continue;
    }

    // Separators and terminators.
    if (char === ',' || char === ';' || char === ':') {
      index += 1;
      push('punctuation', start, index);
      previousWord = char;
      continue;
    }

    // Single-character operators.
    if (LOGICAL_OPERATOR_TEXT.has(char)) {
      index += 1;
      push('logical-operator', start, index);
      previousWord = char;
      continue;
    }
    if (COMPARISON_OPERATOR_TEXT.has(char)) {
      index += 1;
      push('comparison-operator', start, index);
      previousWord = char;
      continue;
    }
    if (
      char === '+' ||
      char === '-' ||
      char === '*' ||
      char === '/' ||
      char === '%' ||
      char === '='
    ) {
      index += 1;
      push('operator', start, index);
      previousWord = char;
      continue;
    }

    // Anything else (stray symbols) stays uncoloured but is still emitted verbatim.
    index += 1;
    push(null, start, index);
    previousWord = '';
  }

  return tokens;
}
