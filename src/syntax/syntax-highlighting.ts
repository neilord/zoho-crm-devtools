import { findEditorSurfaces } from '../content/zoho/selectors';

export const SYNTAX_ENHANCEMENT_ENABLED_ATTR = 'data-zcdt-syntax-enhancement';
export const SYNTAX_TOKEN_ATTR = 'data-zcdt-token';

const MEMBER_METHOD_OVERLAY_STYLE = 'cm-zcdt-member-method';
const MEMBER_PROPERTY_OVERLAY_STYLE = 'cm-zcdt-member-property';
const SPLIT_GROUP_ATTR = 'data-zcdt-split-group';
const SPLIT_GROUP_START_ATTR = 'data-zcdt-split-group-start';
const SPLIT_ORIGINAL_CLASS_ATTR = 'data-zcdt-original-class';
const IDENTIFIER_PATTERN = '[A-Za-z_][A-Za-z0-9_]*';
const GROUPED_MEMBER_ACCESS_PATTERN = new RegExp(
  `^${IDENTIFIER_PATTERN}(?:\\.${IDENTIFIER_PATTERN})+$`,
);
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
const SERVICE_NAMESPACE_ROOTS = new Set(['automation', 'standalone']);
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

let splitGroupIdCounter = 0;

function isCustomCallText(text: string): boolean {
  return CUSTOM_CALL_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function isServiceNamespaceRoot(text: string): boolean {
  return SERVICE_NAMESPACE_ROOTS.has(text);
}

function isGroupedMemberAccessText(text: string): boolean {
  return GROUPED_MEMBER_ACCESS_PATTERN.test(text);
}

function getGroupedMemberRoot(text: string): string {
  return text.split('.', 1)[0] ?? '';
}

function isSplitEligibleGroupedMember(text: string): boolean {
  return (
    isGroupedMemberAccessText(text) &&
    !isCustomCallText(text) &&
    getGroupedMemberRoot(text) !== 'zoho'
  );
}

function isSplitEligibleServiceNamespace(text: string): boolean {
  return isGroupedMemberAccessText(text) && isServiceNamespaceRoot(getGroupedMemberRoot(text));
}

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

function isSplitTokenPart(token: Element): boolean {
  return token.hasAttribute(SPLIT_GROUP_ATTR);
}

function shouldSplitMemberAccessToken(token: Element): boolean {
  const text = getTokenText(token);
  return (
    token.classList.contains('cm-variable') &&
    !isSplitTokenPart(token) &&
    isSplitEligibleGroupedMember(text)
  );
}

function shouldSplitServiceNamespaceToken(token: Element): boolean {
  const text = getTokenText(token);
  return (
    token.classList.contains('cm-variable') &&
    !isSplitTokenPart(token) &&
    isSplitEligibleServiceNamespace(text)
  );
}

function createSplitTokenPart(
  source: Element,
  text: string,
  groupId: string,
  start: boolean,
  extraClass?: string,
): Element {
  const part = source.cloneNode(false) as Element;
  part.removeAttribute(SYNTAX_TOKEN_ATTR);
  part.setAttribute(SPLIT_GROUP_ATTR, groupId);
  part.setAttribute(SPLIT_ORIGINAL_CLASS_ATTR, source.className);
  if (start) {
    part.setAttribute(SPLIT_GROUP_START_ATTR, 'true');
  } else {
    part.removeAttribute(SPLIT_GROUP_START_ATTR);
  }
  if (extraClass) {
    part.classList.add(extraClass);
  }
  part.textContent = text;
  return part;
}

function splitMemberAccessToken(token: Element): void {
  const text = token.textContent ?? '';
  const firstDotIndex = text.indexOf('.');
  if (firstDotIndex <= 0 || !token.parentElement) {
    return;
  }

  const semanticClass = hasOpeningCallBracket(token)
    ? MEMBER_METHOD_OVERLAY_STYLE
    : MEMBER_PROPERTY_OVERLAY_STYLE;
  splitGroupIdCounter += 1;
  const groupId = `split-${splitGroupIdCounter}`;
  const baseToken = createSplitTokenPart(token, text.slice(0, firstDotIndex), groupId, true);
  const memberToken = createSplitTokenPart(
    token,
    text.slice(firstDotIndex),
    groupId,
    false,
    semanticClass,
  );

  token.insertAdjacentElement('beforebegin', baseToken);
  baseToken.insertAdjacentElement('afterend', memberToken);
  token.remove();
}

function splitServiceNamespaceToken(token: Element): void {
  const text = token.textContent ?? '';
  const firstDotIndex = text.indexOf('.');
  if (firstDotIndex <= 0 || !token.parentElement) {
    return;
  }

  splitGroupIdCounter += 1;
  const groupId = `split-${splitGroupIdCounter}`;
  const rootToken = createSplitTokenPart(token, text.slice(0, firstDotIndex), groupId, true);
  const suffixToken = createSplitTokenPart(token, text.slice(firstDotIndex), groupId, false);

  token.insertAdjacentElement('beforebegin', rootToken);
  rootToken.insertAdjacentElement('afterend', suffixToken);
  token.remove();
}

function splitServiceNamespaceTokens(editorSurface: Element): void {
  const tokens = editorSurface.querySelectorAll(
    '.CodeMirror-line span.cm-variable, .CodeMirror-line span.cm-variable-2, .CodeMirror-line span.cm-variable-3',
  );

  for (const token of tokens) {
    if (shouldSplitServiceNamespaceToken(token)) {
      splitServiceNamespaceToken(token);
    }
  }
}

function splitGroupedMemberAccessTokens(editorSurface: Element): void {
  const tokens = editorSurface.querySelectorAll(
    '.CodeMirror-line span.cm-variable, .CodeMirror-line span.cm-variable-2, .CodeMirror-line span.cm-variable-3',
  );

  for (const token of tokens) {
    if (shouldSplitMemberAccessToken(token)) {
      splitMemberAccessToken(token);
    }
  }
}

function restoreSplitTokens(editorSurface: Element): void {
  const splitTokens = editorSurface.querySelectorAll(`[${SPLIT_GROUP_ATTR}]`);
  const splitGroups = new Map<string, Element[]>();

  for (const token of splitTokens) {
    const groupId = token.getAttribute(SPLIT_GROUP_ATTR);
    if (!groupId) {
      continue;
    }

    const group = splitGroups.get(groupId) ?? [];
    group.push(token);
    splitGroups.set(groupId, group);
  }

  for (const group of splitGroups.values()) {
    const startToken = group.find((token) => token.hasAttribute(SPLIT_GROUP_START_ATTR));
    if (!startToken?.parentElement) {
      continue;
    }

    const mergedToken = startToken.cloneNode(false) as Element;
    mergedToken.className =
      startToken.getAttribute(SPLIT_ORIGINAL_CLASS_ATTR) ?? startToken.className;
    mergedToken.removeAttribute(SYNTAX_TOKEN_ATTR);
    mergedToken.removeAttribute(SPLIT_GROUP_ATTR);
    mergedToken.removeAttribute(SPLIT_GROUP_START_ATTR);
    mergedToken.removeAttribute(SPLIT_ORIGINAL_CLASS_ATTR);
    mergedToken.classList.remove(MEMBER_METHOD_OVERLAY_STYLE, MEMBER_PROPERTY_OVERLAY_STYLE);
    mergedToken.textContent = group.map((token) => token.textContent ?? '').join('');

    startToken.insertAdjacentElement('beforebegin', mergedToken);
    for (const token of group) {
      token.remove();
    }
  }
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

  if (token.classList.contains('cm-logicalOpr')) {
    return 'logical-operator';
  }

  if (token.classList.contains('cm-relop') || token.classList.contains('cm-tag')) {
    return 'comparison-operator';
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

  if (isServiceNamespaceRoot(text)) {
    return 'service-namespace';
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

  if (token.classList.contains('cm-variable') && isGroupedMemberAccessText(text)) {
    return hasOpeningCallBracket(token) ? 'method' : 'property';
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
  splitServiceNamespaceTokens(editorSurface);
  splitGroupedMemberAccessTokens(editorSurface);
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
      restoreSplitTokens(editorSurface);
      clearSyntaxTokens(editorSurface);
    }
  }

  return editorSurfaces.length;
}
