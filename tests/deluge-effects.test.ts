import { describe, expect, it } from 'vitest';
import type {
  AnalyzeOptions,
  FunctionEffects,
  SourceSpan,
  WriteEffect,
} from '../src/content/automation-map/analyzer';
import {
  analyzeDelugeEffects,
  DELUGE_EFFECTS_VERSION,
} from '../src/content/automation-map/analyzer';

// Synthetic snippets ported from research specification §11; never customer source.
const vectors = [
  {
    n: 1,
    title: 'Map constructor and put',
    sources: [
      'm = Map();\nm.put("Stage", "Review");\nzoho.crm.updateRecord("Deals", dealId, m);\n',
    ],
  },
  {
    n: 2,
    title: 'Direct literal and opaque dynamic value',
    sources: ['zoho.crm.updateRecord("Deals", id, {"Stage": calculateStage()});\n'],
  },
  {
    n: 3,
    title: 'Closed putAll',
    sources: [
      'base = {"Stage":"Review"};\nextra = {"Amount":42};\nbase.putAll(extra);\nzoho.crm.updateRecord("Deals", id, base);\n',
    ],
  },
  {
    n: 4,
    title: 'putAll from a parameter',
    sources: [
      'm = {"Stage":"Review"};\nm.putAll(payload);\nzoho.crm.updateRecord("Deals", id, m);\n',
    ],
  },
  {
    n: 5,
    title: 'Entire payload from parameter',
    sources: ['zoho.crm.updateRecord("Deals", id, payload);\n'],
  },
  {
    n: 6,
    title: 'Computed field key',
    sources: [
      'm = {"Stage":"Review"};\nm.put(runtimeKey, 1);\nzoho.crm.updateRecord("Deals", id, m);\n',
    ],
  },
  {
    n: 7,
    title: 'Literal variable module and field alias',
    sources: [
      'moduleName = "Deals";\nk = "Stage";\nm = Map();\nm.put(k, stageArg);\nzoho.crm.updateRecord(moduleName, id, m);\n',
    ],
  },
  {
    n: 8,
    title: 'Dynamic module',
    sources: ['zoho.crm.updateRecord(moduleArg, id, {"Stage":"Review"});\n'],
  },
  {
    n: 9,
    title: 'Literal-only and runtime concatenation',
    sources: [
      'a = "De" + "als";\nb = prefix + "als";\nzoho.crm.updateRecord(a, id, {"Stage":"Review"});\nzoho.crm.updateRecord(b, id, {"Stage":"Review"});\n',
    ],
  },
  {
    n: 10,
    title: 'Alias forwarding and detached reassignment',
    sources: [
      'a = {"Stage":"Review"};\nb = a;\na = {"Amount":3};\nzoho.crm.updateRecord("Deals", id, b);\nzoho.crm.updateRecord("Deals", id, a);\n',
    ],
  },
  {
    n: 11,
    title: 'Mutation through alias',
    sources: [
      'a = Map();\nb = a;\nb.put("Stage", "Review");\nzoho.crm.updateRecord("Deals", id, a);\n',
    ],
  },
  {
    n: 12,
    title: 'Write-time snapshot',
    sources: [
      'm = {"Stage":"Review"};\nzoho.crm.updateRecord("Deals", id, m);\nm.put("Amount", 2);\nzoho.crm.updateRecord("Deals", id, m);\n',
    ],
  },
  {
    n: 13,
    title: 'Two branches and no last-branch overwrite',
    sources: [
      'if(flag)\n{\n  m = {"Stage":"Review"};\n}\nelse\n{\n  m = {"Amount":2};\n}\nzoho.crm.updateRecord("Deals", id, m);\n',
    ],
  },
  {
    n: 14,
    title: 'Branch chooses module',
    sources: [
      'if(flag) { mod = "Deals"; } else { mod = "Contacts"; }\nzoho.crm.updateRecord(mod, id, {"Description":"Review"});\n',
    ],
  },
  {
    n: 15,
    title: 'Fresh per-iteration bulk map',
    sources: [
      'rows = List();\nfor each r in inputRows\n{\n  m = Map();\n  m.put("id", r.get("id"));\n  m.put("Stage", "Review");\n  rows.add(m);\n}\nzoho.crm.bulkUpdate("Deals", rows);\n',
    ],
  },
  {
    n: 16,
    title: 'Loop-carried map used before a later mutation',
    sources: [
      'm = Map();\nfor each r in rows\n{\n  zoho.crm.updateRecord("Deals", r.get("id"), m);\n  m.put("Stage", "Review");\n}\n',
    ],
  },
  {
    n: 17,
    title: 'Helper builds returned map; no inter-function return propagation',
    sources: ['m = standalone.build_payload();\nzoho.crm.updateRecord("Deals", id, m);\n'],
  },
  {
    n: 18,
    title: 'Helper receives map and may mutate it',
    sources: [
      'm = {"Stage":"Review"};\nstandalone.extend_payload(m);\nzoho.crm.updateRecord("Deals", id, m);\n',
    ],
  },
  {
    n: 19,
    title: 'bulkCreate exists and unions list records',
    sources: [
      'rows = List();\nrows.add({"Last_Name":"Example A"});\nrows.add({"Last_Name":"Example B","Company":"Example Co"});\nzoho.crm.bulkCreate("Leads", rows);\n',
    ],
  },
  {
    n: 20,
    title: 'bulkUpdate exists; mixed known and unknown entries',
    sources: [
      'rows = List();\nrows.add({"id":id,"Amount":2});\nrows.add(incomingRow);\nzoho.crm.bulkUpdate("Deals", rows);\n',
    ],
  },
  {
    n: 21,
    title: 'Related-record argument positions',
    sources: [
      'zoho.crm.updateRelatedRecord("Price_Books", childId, "Products", parentId, {"list_price":12});\n',
    ],
  },
  {
    n: 22,
    title: 'Upsert and selector exclusion',
    sources: ['zoho.crm.upsert("Deals", {"id":id,"Stage":"Review"});\n'],
  },
  {
    n: 23,
    title: 'Verified connector deletion and unverified deleteRecord',
    sources: [
      'zoho.crm.invokeConnector("crm.delete", {"module":"Leads","id":id});\nzoho.crm.deleteRecord("Deals", id);\n',
    ],
  },
  {
    n: 24,
    title: 'Attachment',
    sources: ['zoho.crm.attachFile("Deals", id, fileArg, "crm_files");\n'],
  },
  {
    n: 25,
    title: 'Lead conversion with explicit Deal map',
    sources: [
      'd = {"Deal_Name":"Example Deal","Stage":"Review"};\nzoho.crm.convertLead(leadId, {"Deals":d});\n',
    ],
  },
  {
    n: 26,
    title: 'Native trigger options built by putAll',
    sources: [
      'opts = Map();\nopts.putAll({"trigger":{"workflow","blueprint"}});\nzoho.crm.updateRecord("Deals", id, {"Stage":"Review"}, opts);\n',
    ],
  },
  {
    n: 27,
    title: 'Explicit-empty and dynamic native options',
    sources: [
      'zoho.crm.createRecord("Leads", {"Last_Name":"Example"}, {"trigger":{}});\nzoho.crm.updateRecord("Deals", id, {"Stage":"Review"}, optsArg);\n',
    ],
  },
  {
    n: 28,
    title: 'Empty options map and misplaced trigger key',
    sources: [
      'zoho.crm.updateRecord("Deals", id, {"Stage":"Review"}, Map());\nzoho.crm.updateRecord("Deals", id, {"trigger":{"workflow"},"Stage":"Review"});\n',
    ],
  },
  {
    n: 29,
    title: 'Versioned task and positional connection placeholder',
    sources: ['zoho.crm.v8.updateRecord("Deals", id, {"Stage":"Review"}, null, "crm_writer");\n'],
  },
  {
    n: 30,
    title: 'REST update with envelope, dynamic ID suffix and explicit trigger',
    sources: [
      'm = {"Stage":"Review"};\nrows = List();\nrows.add(m);\np = {"data":rows,"trigger":{"workflow"}};\nr = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v8/Deals/" + id\n  type : PUT\n  parameters : p.toString()\n  headers : {"Content-Type":"application/json"}\n  connection : "crm_writer"\n];\n',
    ],
  },
  {
    n: 31,
    title: 'Wholly literal JSON body',
    sources: [
      'r = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v8/Leads"\n  type : POST\n  headers : {"Content-Type":"application/json"}\n  body : "{\\"data\\":[{\\"Last_Name\\":\\"Example\\"}],\\"trigger\\":[\\"workflow\\"]}"\n];\n',
    ],
  },
  {
    n: 32,
    title: 'REST omitted trigger differs from native create',
    sources: [
      'r = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v8/Leads"\n  type : POST\n  headers : {"Content-Type":"application/json"}\n  body : {"data":{{"Last_Name":"Example"}}}.toString()\n];\n',
    ],
  },
  {
    n: 33,
    title: 'REST update with absent trigger remains unsettled',
    sources: [
      'r = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v8/Deals"\n  type : PUT\n  headers : {"Content-Type":"application/json"}\n  body : {"data":{{"id":id,"Stage":"Review"}}}.toString()\n];\n',
    ],
  },
  {
    n: 34,
    title: 'CRM-looking PATCH, not a documented record-method claim',
    sources: [
      'r = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v8/Deals"\n  type : PATCH\n  body : bodyArg\n];\n',
    ],
  },
  {
    n: 35,
    title: 'Dynamic module path vs external lookalike',
    sources: [
      'r = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v8/" + moduleArg\n  type : PUT\n  body : bodyArg\n];\ns = invokeurl\n[\n  url : "https://www.zohoapis.com.example.net/crm/v8/Deals"\n  type : PUT\n  body : bodyArg\n];\n',
    ],
  },
  {
    n: 36,
    title: 'REST delete wf_trigger',
    sources: [
      'r = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v8/Leads?ids=101&wf_trigger=false"\n  type : DELETE\n];\ns = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v8/Leads/102"\n  type : DELETE\n];\n',
    ],
  },
  {
    n: 37,
    title: 'REST tag actions',
    sources: [
      'r = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v8/Deals/actions/add_tags"\n  type : POST\n  body : {"ids":{"101"},"tags":{{"name":"Review"}}}.toString()\n];\ns = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v8/Deals/101/actions/remove_tags"\n  type : POST\n  body : {"tags":{{"name":"Review"}}}.toString()\n];\n',
    ],
  },
  {
    n: 38,
    title: 'Function declaration versus calls',
    sources: [
      'string standalone.outer(string id)\n{\n  a = standalone.inner(id);\n  automation.refresh_totals(id);\n  return a;\n}\n',
    ],
  },
  {
    n: 39,
    title: 'Function HTTP execute and settings route are not modules',
    sources: [
      'r = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v2/functions/example_sync/actions/execute"\n  type : POST\n  parameters : {"arguments":"{}"}\n];\ns = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v8/settings/fields?module=Deals"\n  type : GET\n];\n',
    ],
  },
  {
    n: 40,
    title: 'Service grouping and email block',
    sources: [
      'zoho.books.createRecord("Invoices", orgId, invoiceArg);\nzoho.desk.getRecordById(orgId, "tickets", ticketId);\nzoho.cliq.postToChannel("example_channel", "Example message");\nsendmail\n[\n  from : zoho.loginuserid\n  to : recipientArg\n  subject : "Example"\n  message : "zoho.crm.updateRecord is documentation text"\n];\n',
    ],
  },
  {
    n: 41,
    title: 'External URL with connection; dynamic URL with dynamic connection',
    sources: [
      'r = invokeurl\n[\n  url : "https://api.example.net/orders/101?token=synthetic"\n  type : POST\n  connection : "fulfilment_oauth"\n];\ns = invokeurl\n[\n  url : urlArg\n  type : PUT\n  connection : connectionArg\n];\n',
    ],
  },
  {
    n: 42,
    title: 'Reads and COQL POST',
    sources: [
      'a = zoho.crm.getRecordById("Deals", id);\nb = zoho.crm.searchRecords("Leads", "(Last_Name:equals:Example)");\nc = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v8/coql"\n  type : POST\n  headers : {"Content-Type":"application/json"}\n  body : {"select_query":"select Stage from Deals limit 1"}.toString()\n];\n',
    ],
  },
  {
    n: 43,
    title: 'A fetched record reused as payload',
    sources: [
      'm = zoho.crm.getRecordById("Deals", id);\nm.put("Stage", "Review");\nzoho.crm.updateRecord("Deals", id, m);\n',
    ],
  },
  {
    n: 44,
    title: 'Comments, strings and token spacing',
    sources: [
      '// zoho.crm.updateRecord("Leads",id,{"Last_Name":"Example"});\ntext = "standalone.fake(); zoho.crm.updateRecord(...)";\n/* sendmail [ to:"example@example.invalid" ] */\nzoho /* spacing */ .crm /* spacing */ .updateRecord ("Deals", id, {"Stage":"Review"});\n',
    ],
  },
  {
    n: 45,
    title: 'Literal record map returned and later passed into a callee',
    sources: [
      'string standalone.payload_builder()\n{\n  m = {"Stage":"Review"};\n  return m.toString();\n}\n',
      'void automation.forward_payload(map p)\n{\n  zoho.crm.updateRecord("Deals", id, p);\n}\n',
      'm = {"Stage":"Review"};\nautomation.forward_payload(m);\n',
    ],
  },
  {
    n: 46,
    title: 'Same-record binding versus misleading argument name',
    sources: [
      'void automation.stamp_stage(string dealId)\n{\n  zoho.crm.updateRecord("Deals", dealId.toLong(), {"Stage":"Review"}, {"trigger":{"workflow"}});\n}\n',
    ],
  },
  {
    n: 47,
    title: 'Multiple bindings, trigger-module difference and argument maps',
    sources: ['zoho.crm.updateRecord(moduleArg, recordArg, {"Description":"Review"});\n'],
  },
  {
    n: 48,
    title: 'Lookup and subform fields retain domains',
    sources: [
      'm = {"Owner":{"id":ownerId},"Items":{{"Quantity":2,"Product":{"id":productId}}}};\nzoho.crm.updateRecord("Deals", id, m);\n',
    ],
  },
  {
    n: 49,
    title: 'Unknown mutation and malformed syntax',
    sources: [
      'm = {"Stage":"Review"};\nm.customMutation(payload);\nzoho.crm.updateRecord("Deals", id, m);\n',
    ],
  },
  {
    n: 50,
    title: 'Explicit limits and UTF-16 spans',
    sources: [],
  },
  {
    n: 51,
    title: 'invokeapi reuses CRM route logic',
    sources: [
      'r = invokeapi\n[\n  service : zohocrm\n  path : "/crm/v8/Deals"\n  type : PUT\n  body : {"data":{{"id":id,"Stage":"Review"}},"trigger":{}}.toString()\n  headers : {"Content-Type":"application/json"}\n];\n',
    ],
  },
  {
    n: 52,
    title: 'Ambiguous metadata and missing callee',
    sources: ['standalone.example_sync(id);\n'],
  },
  {
    n: 53,
    title: 'JSON-style trigger lists and invalid envelopes',
    sources: [
      'zoho.crm.updateRecord("Deals", id, {"Stage":"Review"}, {"trigger":["workflow"]});\nr = invokeurl\n[\n  url : "https://www.zohoapis.com/crm/v8/Deals"\n  type : PUT\n  body : "{\\"Stage\\":\\"Review\\"}"\n  headers : {"Content-Type":"application/json"}\n];\n',
    ],
  },
  {
    n: 54,
    title: 'Removed keys and donor snapshot',
    sources: [
      'm = {"Stage":"Review","Amount":1};\nm.remove("Amount");\nextra = {"Description":"Review"};\nm.putAll(extra);\nextra.put("Amount", 2);\nzoho.crm.updateRecord("Deals", id, m);\n',
    ],
  },
] as const;

function keys(w: WriteEffect): string[] {
  return w.fields.filter((f) => f.path.length === 1).map((f) => f.apiName);
}
function checked(source: string, options: AnalyzeOptions = {}): FunctionEffects {
  const result = analyzeDelugeEffects(source, {
    parameters: ['id', 'dealId', 'leadId'],
    ...options,
  });
  expect(result.analysis.status).not.toBe('failed');
  const span = (s: SourceSpan) => {
    expect(s.start).toBeGreaterThanOrEqual(0);
    expect(s.end).toBeLessThanOrEqual(source.length);
    expect(s.end).toBeGreaterThanOrEqual(s.start);
  };
  for (const e of [
    ...result.writes,
    ...result.calls,
    ...result.services,
    ...result.external,
    ...result.reads,
  ]) {
    expect(e.certainty).toBe('possible');
    span(e.span);
    span(e.calleeSpan);
    for (const context of e.contexts) span(context.span);
    if ('fields' in e) for (const f of e.fields) for (const evidence of f.evidence) span(evidence);
  }
  for (const w of result.writes) {
    span(w.module.span);
    span(w.target.span);
    for (const s of w.module.evidence) span(s);
    expect(w.moduleConfidence).toBe(w.module.confidence);
  }
  for (const s of [...result.analysis.analyzedSpans, ...result.analysis.unscanned]) span(s);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  return result;
}

const simple: Record<number, [string | null, string[], string?]> = {
  1: ['Deals', ['Stage']],
  2: ['Deals', ['Stage']],
  3: ['Deals', ['Stage', 'Amount']],
  4: ['Deals', ['Stage'], 'partial'],
  5: ['Deals', [], 'unknown'],
  6: ['Deals', ['Stage'], 'partial'],
  7: ['Deals', ['Stage']],
  8: [null, ['Stage']],
  11: ['Deals', ['Stage'], 'partial'],
  13: ['Deals', ['Stage', 'Amount']],
  14: [null, ['Description']],
  15: ['Deals', ['Stage'], 'partial'],
  16: ['Deals', ['Stage'], 'partial'],
  17: ['Deals', [], 'unknown'],
  18: ['Deals', ['Stage'], 'partial'],
  19: ['Leads', ['Last_Name', 'Company']],
  20: ['Deals', ['Amount'], 'partial'],
  21: ['Price_Books', ['list_price']],
  22: ['Deals', ['Stage']],
  24: ['Deals', []],
  26: ['Deals', ['Stage']],
  29: ['Deals', ['Stage']],
  30: ['Deals', ['Stage']],
  31: ['Leads', ['Last_Name']],
  32: ['Leads', ['Last_Name']],
  33: ['Deals', ['Stage']],
  34: ['Deals', [], 'unknown'],
  43: ['Deals', ['Stage'], 'partial'],
  44: ['Deals', ['Stage']],
  46: ['Deals', ['Stage']],
  47: [null, ['Description']],
  48: ['Deals', ['Owner', 'Items']],
  49: ['Deals', ['Stage'], 'partial'],
  51: ['Deals', ['Stage']],
  54: ['Deals', ['Stage', 'Amount', 'Description'], 'partial'],
};

describe('research vectors V01–V54', () => {
  for (const vector of vectors)
    it(`V${String(vector.n).padStart(2, '0')} ${vector.title}`, () => {
      const sources: readonly string[] =
        vector.n === 50 ? [`// 😀\r\n${'x = 1;\n'.repeat(40000)}`] : vector.sources;
      const results = sources.map((source) => checked(source));
      const r = results[0],
        w = r.writes[0];
      const expected = simple[vector.n];
      if (expected) {
        expect(w).toBeDefined();
        expect(w.module.value).toBe(expected[0]);
        expect(keys(w)).toEqual(expected[1]);
        if (expected[2]) expect(w.fieldsConfidence).toBe(expected[2]);
      }
      switch (vector.n) {
        case 1:
          expect(w.target).toMatchObject({
            kind: 'parameter',
            parameter: 'dealId',
            directParameter: true,
          });
          expect(w.trigger).toMatchObject({
            mode: 'documented-default',
            workflow: 'not-requested',
          });
          expect(sources[0].slice(w.fields[0].evidence[0].start, w.fields[0].evidence[0].end)).toBe(
            '"Stage"',
          );
          break;
        case 2:
          expect(r.calls.map((c) => c.kind)).toEqual(['unclassified']);
          break;
        case 4:
        case 6:
          expect(w.unknownFields).toBe(true);
          break;
        case 7:
          expect(w.module.origin).toBe('propagated');
          expect(w.fields[0].evidence.length).toBeGreaterThan(1);
          break;
        case 8:
          expect(w.confidence).toBe('unknown');
          expect(w.fieldsConfidence).toBe('exact');
          break;
        case 9:
          expect(r.writes.map((w) => w.module.value)).toEqual(['Deals', null]);
          break;
        case 10:
          expect(r.writes.map(keys)).toEqual([['Stage'], ['Amount']]);
          break;
        case 11:
          expect(w.reasons).toContain('alias-mutation');
          break;
        case 12:
          expect(r.writes.map(keys)).toEqual([['Stage'], ['Stage', 'Amount']]);
          break;
        case 13:
          expect(w.fieldsConfidence).toBe('exact');
          break;
        case 14:
          expect(w.module.candidates).toEqual(['Deals', 'Contacts']);
          expect(w.confidence).toBe('partial');
          break;
        case 15:
          expect(w.op).toBe('bulk-update');
          expect(w.reasons).toContain('loop-carried-state');
          break;
        case 16:
          expect(w.contexts[0].kind).toBe('loop');
          expect(w.reasons).toContain('loop-carried-state');
          break;
        case 17:
          expect(r.calls[0].apiName).toBe('build_payload');
          expect(w.reasons).toContain('helper-return');
          break;
        case 18:
          expect(r.calls[0].arguments[0].shape).toBe('map');
          break;
        case 19:
          expect(w.op).toBe('bulk-create');
          expect(w.trigger.documentedDefault).toEqual(['approval', 'blueprint']);
          break;
        case 20:
          expect(w.reasons).toContain('unknown-list-element');
          break;
        case 21:
          expect(w.parentModule?.value).toBe('Products');
          expect(w.resource).toBe('relationship');
          expect(w.fields[0].domain).toBe('relationship');
          break;
        case 22:
          expect(w.op).toBe('upsert');
          break;
        case 23:
          expect(r.writes.map((w) => [w.op, w.module.value, w.recognition])).toEqual([
            ['delete', 'Leads', 'registered'],
            ['delete', null, 'candidate'],
          ]);
          expect(r.services[0].reasons).toContain('unverified-task-signature');
          break;
        case 24:
          expect(w.fieldsConfidence).toBe('not-applicable');
          expect(w.destinationScope).toBe('connection-org-unknown');
          expect(r.connections[0].name.value).toBe('crm_files');
          break;
        case 25:
          expect(r.writes.map((w) => w.module.value)).toEqual([
            'Leads',
            'Contacts',
            'Accounts',
            'Deals',
          ]);
          expect(r.writes.map(keys)).toEqual([[], [], [], ['Deal_Name', 'Stage']]);
          expect(new Set(r.writes.map((w) => w.groupId)).size).toBe(1);
          expect(r.writes[3].unknownFields).toBe(true);
          break;
        case 26:
          expect(w.trigger.requested).toEqual(['workflow', 'blueprint']);
          break;
        case 27:
          expect(r.writes.map((w) => [w.trigger.mode, w.trigger.requested])).toEqual([
            ['explicit-empty', []],
            ['unknown', null],
          ]);
          break;
        case 28:
          expect(r.writes[0].trigger.reasons).toContain('option-present-without-trigger');
          expect(keys(r.writes[1])).toEqual(['trigger', 'Stage']);
          expect(r.writes[1].trigger.mode).toBe('documented-default');
          break;
        case 29:
          expect(w.apiVersion).toBe('v8');
          expect(w.trigger.mode).toBe('unknown');
          expect(r.connections[0].name.value).toBe('crm_writer');
          break;
        case 30:
          expect(w.trigger.requested).toEqual(['workflow']);
          expect(w.destinationScope).toBe('connection-org-unknown');
          expect(r.external).toEqual([]);
          break;
        case 31:
          expect(w.trigger.requested).toEqual(['workflow']);
          expect(r.calls).toEqual([]);
          break;
        case 32:
          expect(w.trigger).toMatchObject({ mode: 'documented-default', workflow: 'possible' });
          break;
        case 33:
          expect(w.trigger.mode).toBe('unknown');
          break;
        case 34:
          expect(w.recognition).toBe('candidate');
          expect(w.reasons).toContain('unverified-route-or-method');
          break;
        case 35:
          expect(w.module.value).toBeNull();
          expect(r.writes).toHaveLength(1);
          expect(r.external[0].destination).toBe('external-url');
          expect(JSON.stringify(r)).not.toContain('example.net');
          break;
        case 36:
          expect(
            r.writes.map((w) => [w.op, w.module.value, w.trigger.mode, w.trigger.workflow]),
          ).toEqual([
            ['delete', 'Leads', 'explicit-empty', 'not-requested'],
            ['delete', 'Leads', 'documented-default', 'possible'],
          ]);
          expect(JSON.stringify(r)).not.toContain('101');
          break;
        case 37:
          expect(r.writes.map((w) => [w.op, w.resource, keys(w)])).toEqual([
            ['add-tags', 'tags', []],
            ['remove-tags', 'tags', []],
          ]);
          break;
        case 38:
          expect(r.calls.map((c) => c.apiName)).toEqual(['inner', 'refresh_totals']);
          expect(r.calls[1].recognition).toBe('candidate');
          break;
        case 39:
          expect(r.writes).toEqual([]);
          expect(r.calls[0]).toMatchObject({
            apiName: 'example_sync',
            via: 'http-execute',
            resolution: 'not-attempted',
          });
          break;
        case 40:
          expect(r.services.map((s) => s.service)).toEqual(['books', 'desk', 'cliq']);
          expect(r.external[0].kind).toBe('sendmail');
          expect(r.writes).toEqual([]);
          expect(r.connections).toEqual([]);
          break;
        case 41:
          expect(r.external.map((e) => e.destination)).toEqual(['external-url', 'unknown-url']);
          expect(r.connections.map((c) => c.name.value)).toEqual(['fulfilment_oauth', null]);
          expect(JSON.stringify(r)).not.toContain('synthetic');
          break;
        case 42:
          expect(r.writes).toEqual([]);
          expect(r.reads.map((r) => r.op)).toEqual(['get-by-id', 'search']);
          break;
        case 43:
          expect(r.reads).toHaveLength(1);
          break;
        case 44:
          expect(r.writes).toHaveLength(1);
          expect(r.calls).toEqual([]);
          expect(r.external).toEqual([]);
          break;
        case 45:
          expect(results.map((r) => r.writes.length)).toEqual([0, 1, 0]);
          expect(results[1].writes[0].fieldsConfidence).toBe('unknown');
          expect(results[2].calls[0].apiName).toBe('forward_payload');
          break;
        case 46:
          expect(w.target).toMatchObject({
            kind: 'parameter',
            parameter: 'dealId',
            directParameter: true,
          });
          expect(w.trigger.workflow).toBe('possible');
          break;
        case 47:
          expect(w.confidence).toBe('unknown');
          break;
        case 48:
          expect(w.fields.map((f) => f.path)).toContainEqual(['Items', '[]', 'Quantity']);
          expect(w.fields.map((f) => f.path)).toContainEqual(['Items', '[]', 'Product']);
          break;
        case 49:
          expect(w.reasons).toContain('unknown-mutator');
          break;
        case 50:
          expect(r.analysis.status).toBe('limited');
          expect(r.analysis.limitReasons).toContain('source-length');
          expect(r.analysis.unscanned).toEqual([{ start: 0, end: sources[0].length }]);
          break;
        case 51:
          expect(w.via).toBe('invokeapi');
          expect(w.trigger.mode).toBe('explicit-empty');
          break;
        case 52: {
          const ambiguous = checked(sources[0], {
            catalogue: [
              { id: 'a', apiName: 'example_sync' },
              { id: 'b', apiName: 'example_sync' },
            ],
          });
          expect(ambiguous.calls[0]).toMatchObject({
            resolution: 'ambiguous',
            calleeFunctionId: null,
          });
          const unique = checked(sources[0], { catalogue: [{ id: 'a', apiName: 'example_sync' }] });
          expect(unique.calls[0]).toMatchObject({ resolution: 'exact', calleeFunctionId: 'a' });
          expect(unique.writes).toEqual([]);
          break;
        }
        case 53:
          expect(r.writes[0].trigger.requested).toEqual(['workflow']);
          expect(r.writes[1].reasons).toContain('invalid-envelope');
          expect(r.writes[1].fieldsConfidence).toBe('unknown');
          break;
        case 54:
          expect(w.reasons).toContain('unknown-mutator');
          expect(w.fields.find((f) => f.apiName === 'Amount')?.evidence[0].start).toBe(
            sources[0].indexOf('"Amount"'),
          );
          break;
      }
    });
});

it('has a versioned, deterministic, JSON-serializable public result', () => {
  const source = vectors.map((v) => v.sources[0] ?? '').join('\n');
  const a = checked(source);
  const b = checked(source);
  expect(a).toEqual(b);
  expect(a.analyzerVersion).toBe(DELUGE_EFFECTS_VERSION);
});
