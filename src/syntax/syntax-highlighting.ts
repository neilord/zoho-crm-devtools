import { findEditorSurfaces } from '../content/zoho/selectors';

export const SYNTAX_ENHANCEMENT_ENABLED_ATTR = 'data-zcdt-syntax-enhancement';
export const SYNTAX_TOKEN_ATTR = 'data-zcdt-token';

const CONTROL_WORDS = new Set([
  'break',
  'catch',
  'continue',
  'each',
  'else',
  'else if',
  'finally',
  'for',
  'for each',
  'if',
  'info',
  'return',
  'throw',
  'try',
  'while',
]);
const CUSTOM_CALL_PREFIXES = ['automation.', 'standalone.'];
const HTTP_METHOD_WORDS = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);
const TYPE_WORDS = new Set([
  'bool',
  'boolean',
  'Boolean',
  'collection',
  'Collection',
  'date',
  'Date',
  'datetime',
  'DateTime',
  'decimal',
  'Decimal',
  'double',
  'Double',
  'float',
  'Float',
  'int',
  'Int',
  'list',
  'List',
  'long',
  'Long',
  'map',
  'Map',
  'string',
  'String',
  'time',
  'Time',
  'void',
]);

function getTokenText(token: Element | null): string {
  return token?.textContent?.trim() ?? '';
}

function getPreviousToken(token: Element): Element | null {
  let previous = token.previousElementSibling;
  while (previous && (previous.classList.contains('cm-tab') || getTokenText(previous) === '')) {
    previous = previous.previousElementSibling;
  }
  return previous;
}

function getNextToken(token: Element): Element | null {
  let next = token.nextElementSibling;
  while (next && (next.classList.contains('cm-tab') || getTokenText(next) === '')) {
    next = next.nextElementSibling;
  }
  return next;
}

function getPreviousTokenTexts(token: Element, count: number): string[] {
  const texts: string[] = [];
  let previous = getPreviousToken(token);

  while (previous && texts.length < count) {
    texts.unshift(getTokenText(previous));
    previous = getPreviousToken(previous);
  }

  return texts;
}

function hasOpeningCallBracket(token: Element): boolean {
  const nextText = getTokenText(getNextToken(token));
  return nextText.startsWith('(');
}

function hasPreviousText(token: Element, text: string): boolean {
  return getTokenText(getPreviousToken(token)) === text;
}

function hasPreviousPhrase(token: Element, phrase: string): boolean {
  return getPreviousTokenTexts(token, 2).join(' ') === phrase || hasPreviousText(token, phrase);
}

function hasNextText(token: Element, text: string): boolean {
  return getTokenText(getNextToken(token)) === text;
}

function isSignatureName(token: Element): boolean {
  return (
    TYPE_WORDS.has(getTokenText(getPreviousToken(token))) &&
    token.classList.contains('cm-variable') &&
    hasOpeningCallBracket(token)
  );
}

function getSemanticToken(token: Element): string | null {
  const text = getTokenText(token);

  if (!text) {
    return null;
  }

  if (token.classList.contains('cm-comment')) {
    return 'comment';
  }

  if (token.classList.contains('cm-string')) {
    return 'string';
  }

  if (token.classList.contains('cm-constant')) {
    return 'constant';
  }

  if (token.classList.contains('cm-relop') || token.classList.contains('cm-logicalOpr')) {
    return 'logical-operator';
  }

  if (token.classList.contains('cm-tag')) {
    return 'logical-operator';
  }

  if (token.classList.contains('cm-operator')) {
    return text === ':' ? 'punctuation' : 'operator';
  }

  if (token.classList.contains('cm-separator') || token.classList.contains('cm-semicolon')) {
    return 'punctuation';
  }

  if (token.classList.contains('cm-brackets')) {
    return 'bracket';
  }

  if (text === 'index' && hasPreviousPhrase(token, 'for each')) {
    return 'control';
  }

  if (CONTROL_WORDS.has(text)) {
    return 'control';
  }

  if (text === 'invokeurl') {
    return 'special-form';
  }

  if (HTTP_METHOD_WORDS.has(text) && hasPreviousText(token, ':')) {
    return 'http-method';
  }

  if (text === 'zoho') {
    return 'namespace';
  }

  if (TYPE_WORDS.has(text)) {
    return 'type';
  }

  if (text.startsWith('.')) {
    return hasOpeningCallBracket(token) ? 'method' : 'property';
  }

  if (
    CUSTOM_CALL_PREFIXES.some((prefix) => text.startsWith(prefix)) &&
    hasOpeningCallBracket(token)
  ) {
    return 'custom-call';
  }

  if (token.classList.contains('cm-variable') && hasNextText(token, ':')) {
    return 'block-key';
  }

  if (isSignatureName(token)) {
    return 'callable';
  }

  if (hasOpeningCallBracket(token)) {
    return text.includes('.') ? 'method' : 'callable';
  }

  if (
    token.classList.contains('cm-syntax') ||
    token.classList.contains('cm-builtin') ||
    token.classList.contains('cm-def')
  ) {
    return 'callable';
  }

  if (token.classList.contains('cm-property') || token.classList.contains('cm-attribute')) {
    return 'property';
  }

  if (token.classList.contains('cm-variable')) {
    return 'variable';
  }

  return null;
}

export function annotateSyntaxTokens(editorSurface: Element): void {
  const tokens = editorSurface.querySelectorAll('.CodeMirror-line span[class]');

  for (const token of tokens) {
    const semanticToken = getSemanticToken(token);
    if (semanticToken) {
      token.setAttribute(SYNTAX_TOKEN_ATTR, semanticToken);
    } else {
      token.removeAttribute(SYNTAX_TOKEN_ATTR);
    }
  }
}

function clearSyntaxTokens(editorSurface: Element): void {
  for (const token of editorSurface.querySelectorAll(`[${SYNTAX_TOKEN_ATTR}]`)) {
    token.removeAttribute(SYNTAX_TOKEN_ATTR);
  }
}

export function applySyntaxEnhancementPreference(
  enabled: boolean,
  root: ParentNode = document,
): number {
  const editorSurfaces = findEditorSurfaces(root);

  for (const editorSurface of editorSurfaces) {
    if (enabled) {
      editorSurface.setAttribute(SYNTAX_ENHANCEMENT_ENABLED_ATTR, 'true');
      annotateSyntaxTokens(editorSurface);
    } else {
      editorSurface.removeAttribute(SYNTAX_ENHANCEMENT_ENABLED_ATTR);
      clearSyntaxTokens(editorSurface);
    }
  }

  return editorSurfaces.length;
}
