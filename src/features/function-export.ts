import { type FunctionRecord, getFunctionSource } from '../content/functions/types';

export const EXPORT_FORMATS = ['json', 'csv', 'markdown'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export interface ExportFile {
  filename: string;
  mediaType: string;
  content: string;
}
export interface SkippedFunction {
  id: string;
  name: string;
  apiName: string;
  reason: string;
}
export interface ExportMetadata {
  orgId: string;
  exportedAt: string;
}
export function isExportFormat(value: unknown): value is ExportFormat {
  return EXPORT_FORMATS.includes(value as ExportFormat);
}

function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  // Quoting alone does not stop spreadsheet formula execution. JSON retains exact source.
  if (/^[\t\r\n]|^\s*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function fence(text: string, language: string): string {
  // Avoid spreading one argument per source token: large scripts exceed the call stack.
  let length = 3;
  for (const [run] of text.matchAll(/`+/g)) length = Math.max(length, run.length + 1);
  const delimiter = '`'.repeat(length);
  return `${delimiter}${language}\n${text}\n${delimiter}`;
}
function heading(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#+!|]/g, '\\$&');
}

/** Pure serialization: no Chrome, DOM, storage, requests or credentials. */
export function serializeFunctionExport(
  records: readonly FunctionRecord[],
  format: ExportFormat,
  metadata: ExportMetadata,
  skipped: readonly SkippedFunction[] = [],
): ExportFile {
  if (
    !isExportFormat(format) ||
    !/^\d+$/.test(metadata.orgId) ||
    !Number.isFinite(Date.parse(metadata.exportedAt))
  )
    throw new Error('Invalid export options');
  const seen = new Set<string>();
  for (const record of records) {
    if (
      !record.detail ||
      record.detail.id !== record.summary.id ||
      (typeof record.detail.script !== 'string' && typeof record.detail.workflow !== 'string') ||
      seen.has(record.summary.id)
    ) {
      throw new Error('Cannot export incomplete or duplicate functions');
    }
    seen.add(record.summary.id);
  }
  const stem = `zoho-functions-${metadata.orgId}-${new Date(metadata.exportedAt).toISOString().slice(0, 10)}`;
  if (format === 'json') {
    return {
      filename: `${stem}.json`,
      mediaType: 'application/json;charset=utf-8',
      content: `${JSON.stringify({ schemaVersion: 1, ...metadata, functions: records, skipped }, null, 2)}\n`,
    };
  }
  if (format === 'csv') {
    const columns = [
      'id',
      'display_name',
      'api_name',
      'category',
      'language',
      'source',
      'description',
      'createdTime',
      'updatedTime',
      'metadata_json',
      'code',
      'error',
    ];
    const rows = records.map((record) => {
      const s = record.summary;
      return [
        s.id,
        s.display_name,
        s.api_name,
        s.category,
        s.language,
        s.source,
        s.description,
        s.createdTime,
        s.updatedTime,
        JSON.stringify(s),
        getFunctionSource(record),
        '',
      ];
    });
    for (const item of skipped) {
      rows.push([item.id, item.name, item.apiName, '', '', '', '', '', '', '', '', item.reason]);
    }
    return {
      filename: `${stem}.csv`,
      mediaType: 'text/csv;charset=utf-8',
      content:
        '\uFEFF' +
        [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') +
        '\r\n',
    };
  }
  const sections = records.map(
    (record) =>
      `## ${heading(record.summary.display_name || record.summary.id)}\n\n${fence(JSON.stringify({ summary: record.summary, detail: { ...record.detail, script: undefined, workflow: undefined } }, null, 2), 'json')}\n\n${fence(getFunctionSource(record), 'deluge')}`,
  );
  if (skipped.length) {
    sections.push(
      `## Not exported\n\n${skipped
        .map(
          (item) =>
            `- ${heading(item.name)} (ID: ${heading(item.id)}, API name: ${heading(item.apiName)}): ${heading(item.reason)}`,
        )
        .join('\n')}`,
    );
  }
  return {
    filename: `${stem}.md`,
    mediaType: 'text/markdown;charset=utf-8',
    content: `# Zoho CRM functions\n\nOrg: ${metadata.orgId}\n\nExported: ${new Date(metadata.exportedAt).toISOString()}\n\nFunctions: ${records.length} of ${records.length + skipped.length}\n\n${sections.join('\n\n---\n\n')}\n`,
  };
}
