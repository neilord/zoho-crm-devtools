/**
 * Shared Deluge word/prefix vocabulary.
 *
 * Both the live-editor span-refinement layer (`syntax-highlighting.ts`) and the
 * dashboard preview tokenizer (`deluge-tokenizer.ts`) classify identifiers from
 * THIS single source so the two surfaces can never drift on what counts as a
 * control word, a type, a namespace root, and so on. The colour vocabulary
 * (`data-zcdt-token` categories + `--zcdt-syntax-*` variables) is the shared
 * contract; there is deliberately no shared tokenizing engine (the live editor
 * must never be re-tokenized — see docs/zoho-integration.md).
 */

export const IDENTIFIER_PATTERN = '[A-Za-z_][A-Za-z0-9_]*';

/** A dotted chain such as `zoho.crm.getRecords` where every segment is an identifier. */
export const GROUPED_MEMBER_ACCESS_PATTERN = new RegExp(
  `^${IDENTIFIER_PATTERN}(?:\\.${IDENTIFIER_PATTERN})+$`,
);

export const CONTROL_WORDS = new Set([
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

export const CUSTOM_CALL_PREFIXES = ['automation.', 'standalone.'];

export const SERVICE_NAMESPACE_ROOTS = new Set(['automation', 'standalone']);

export const HTTP_METHOD_WORDS = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);

export const TYPE_WORDS = new Set([
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

export function isCustomCallText(text: string): boolean {
  return CUSTOM_CALL_PREFIXES.some((prefix) => text.startsWith(prefix));
}

export function isServiceNamespaceRoot(text: string): boolean {
  return SERVICE_NAMESPACE_ROOTS.has(text);
}

export function isGroupedMemberAccessText(text: string): boolean {
  return GROUPED_MEMBER_ACCESS_PATTERN.test(text);
}

export function getGroupedMemberRoot(text: string): string {
  return text.split('.', 1)[0] ?? '';
}
