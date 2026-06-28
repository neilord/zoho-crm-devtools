/**
 * Shapes of the Zoho CRM internal functions API that this feature relies on.
 *
 * The payloads carry more fields than we model; everything here is optional and
 * read defensively because it comes from an undocumented internal endpoint that
 * Zoho can change. See docs/zoho-integration.md for the endpoint inventory.
 */

export interface ZohoAssociatedPlace {
  status?: boolean;
  module?: string;
  _type?: string;
  name?: string;
  arguments?: Array<{ name?: string; value?: string }>;
}

export interface ZohoRestApi {
  /** Observed values: `oauth`, `zapikey`. */
  type?: string;
  active?: boolean;
}

export interface ZohoFunctionTasks {
  integrations?: Array<{ service?: string; function?: string }>;
  webhooks?: Array<{ method?: string; connection?: string }>;
  sendmail?: unknown[];
}

/** A function as returned by the list endpoint (`/settings/functions`). */
export interface ZohoFunctionSummary {
  id: string;
  display_name: string;
  api_name?: string;
  /** Coarse bucket, e.g. `Standalone`, `Automation`, `Dynamic`, `ExtensionAction`. */
  category: string;
  /** Used when requesting details. Usually `deluge`. */
  language?: string;
  /** Used when requesting details. Usually `crm`. */
  source?: string;
  description?: string;
  createdTime?: string | number;
  updatedTime?: string | number;
  /** Extension functions expose their namespace here, used as a finer category. */
  workflow?: { namespace?: string } | null;
  associated_place?: ZohoAssociatedPlace[];
  rest_api?: ZohoRestApi[];
  tasks?: ZohoFunctionTasks | null;
}

/** A single function as returned by the details endpoint, including source. */
export interface ZohoFunctionDetail {
  id: string;
  /** Deluge source for standalone functions. */
  script?: string;
  /** Deluge source for workflow/automation functions. */
  workflow?: string;
  name?: string;
  modified_by?: string;
  params?: Array<{ name?: string; type?: string }>;
  associated_place?: ZohoAssociatedPlace[];
}

/** A summary paired with its lazily loaded detail (null until fetched). */
export interface FunctionRecord {
  summary: ZohoFunctionSummary;
  detail: ZohoFunctionDetail | null;
}

/** The Deluge source for a record, regardless of function kind. */
export function getFunctionSource(record: FunctionRecord): string {
  return record.detail?.script ?? record.detail?.workflow ?? '';
}
