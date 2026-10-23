import { expect, it } from 'vitest';
import type { AnalysisLimits, FunctionEffects } from '../src/content/automation-map/analyzer';
import { analyzeDelugeEffects } from '../src/content/automation-map/analyzer';

const write = 'zoho.crm.updateRecord("Deals", id, {"Stage":value});';
const fields = (r: FunctionEffects, index = 0) =>
  r.writes[index].fields.filter((f) => f.path.length === 1).map((f) => f.apiName);

it.each([
  ['source-length', write, { sourceLength: 10 }],
  ['tokens', write, { tokens: 3 }],
  ['work-visits', write, { visits: 3 }],
  ['structural-depth', write, { structuralDepth: 1 }],
  ['payload-depth', `m={"A":{"B":{"C":1}}};${write}`, { payloadDepth: 1 }],
  ['bindings', `a=1;b=2;${write}`, { bindings: 1 }],
  ['objects', `a=Map();a=Map();${write}`, { bindings: 1 }],
  ['effects', write.repeat(3), { effects: 1 }],
  ['output-bytes', write, { outputBytes: 50 }],
  ['keys', 'zoho.crm.updateRecord("Deals",id,{"A":1,"B":2});', { keys: 1 }],
  ['list-elements', 'zoho.crm.bulkUpdate("Deals",{{"A":1},{"B":2}});', { listElements: 1 }],
  [
    'alternatives',
    'if(a){m="Deals";}else{m="Leads";} zoho.crm.updateRecord(m,id,{"A":1});',
    { alternatives: 1 },
  ],
  ['evidence', 'k="A";m=Map();m.put(k,1);zoho.crm.updateRecord("Deals",id,m);', { evidence: 1 }],
  ['warnings', 'foo();bar();baz();', { warnings: 1 }],
] as Array<
  [string, string, Partial<AnalysisLimits>]
>)('reports the %s budget honestly', (reason, source, limits) => {
  const r = analyzeDelugeEffects(source, { limits });
  expect(r.analysis.status).toBe('limited');
  expect(r.analysis.limitReasons).toContain(reason);
  if (
    [
      'source-length',
      'tokens',
      'work-visits',
      'structural-depth',
      'effects',
      'output-bytes',
    ].includes(reason)
  )
    expect(r.analysis.unscanned.length).toBeGreaterThan(0);
  if (reason === 'effects')
    expect(r.writes[0]).toMatchObject({ confidence: 'exact', fieldsConfidence: 'exact' });
  if (reason === 'keys')
    expect(r.writes[0]).toMatchObject({ fieldsConfidence: 'partial', unknownFields: true });
  expect(JSON.parse(JSON.stringify(r))).toEqual(r);
});

it('normalizes invalid numeric budgets deterministically', () => {
  const r = analyzeDelugeEffects(write, {
    limits: { keys: Number.NaN, effects: Number.POSITIVE_INFINITY },
  });
  expect(r).toEqual(analyzeDelugeEffects(write));
  expect(analyzeDelugeEffects(write, { limits: { keys: -1 } }).writes).toHaveLength(1);
});

it.each([
  'm = "unterminated',
  'm = "terminal\\',
  'm = "escaped\\"',
  '/* unfinished',
  'm={"A":1;',
  'm = [1,2};',
])('bounds malformed input: %s', (source) => {
  const r = analyzeDelugeEffects(source);
  expect(r.analysis.status).toBe('limited');
  expect(r.analysis.unscanned.length).toBeGreaterThan(0);
  expect(r.writes).toEqual([]);
  expect(r.warnings.some((w) => w.code.startsWith('malformed-'))).toBe(true);
  for (const s of [
    ...r.analysis.unscanned,
    ...r.warnings.flatMap((w) => (w.span ? [w.span] : [])),
  ]) {
    expect(s.start).toBeGreaterThanOrEqual(0);
    expect(s.end).toBeLessThanOrEqual(source.length);
  }
});

it('retains a fully processed write before a malformed suffix', () => {
  const r = analyzeDelugeEffects(`${write}\nm = "terminal\\`);
  expect(r.writes).toHaveLength(1);
  expect(r.writes[0].confidence).toBe('exact');
  expect(r.analysis.status).toBe('limited');
});

it('uses original UTF-16 offsets including emoji, CRLF and trivia', () => {
  const source = `// 😀\r\nzoho /*x*/ . crm . updateRecord ("Deals",id,{"Stage":unknown});`;
  const r = analyzeDelugeEffects(source),
    w = r.writes[0];
  expect(w.span).toEqual({ start: 7, end: source.length - 1 });
  expect(source.slice(w.fields[0].evidence[0].start, w.fields[0].evidence[0].end)).toBe('"Stage"');
  expect(source.slice(w.calleeSpan.start, w.calleeSpan.end)).toBe(
    'zoho /*x*/ . crm . updateRecord',
  );
});

it('keeps comments and strings opaque at every executable boundary', () => {
  const source = `// ${write}\n/* standalone.fake(); */\na="${write.replaceAll('"', '\\"')}";\nb='sendmail [ to: "x" ]';`;
  const r = analyzeDelugeEffects(source);
  expect(r.analysis.status).toBe('analyzed');
  expect(r.writes).toEqual([]);
  expect(r.calls).toEqual([]);
  expect(r.external).toEqual([]);
});

it('includes nested executable calls and evaluates no source strings', () => {
  const r = analyzeDelugeEffects(
    'zoho.crm.updateRecord("Deals",standalone.find_id(),{"Stage":standalone.calculate()});',
  );
  expect(r.calls.map((c) => c.apiName)).toEqual(['find_id', 'calculate']);
  expect(fields(r)).toEqual(['Stage']);
});

it('forks branch entry states and includes the no-branch path', () => {
  const r = analyzeDelugeEffects(
    'm={"A":1};if(flag){m={"B":1};}zoho.crm.updateRecord("Deals",id,m);',
  );
  expect(new Set(fields(r))).toEqual(new Set(['A', 'B']));
  expect(r.writes[0].fieldsConfidence).toBe('exact');
});

it('does not claim an absent branch-map key has a definite value', () => {
  const r = analyzeDelugeEffects(
    'if(flag){m={"module":"Deals"};}else{m={"A":1};}zoho.crm.updateRecord(m.get("module"),id,{"Stage":1});',
  );
  expect(r.writes[0].module).toMatchObject({
    value: null,
    candidates: ['Deals'],
    confidence: 'partial',
  });
});

it('retains may-alias mutations after a branch join', () => {
  const r = analyzeDelugeEffects(
    'a={"A":1};b=a;if(flag){b={"B":1};}b.put("C",1);zoho.crm.updateRecord("Deals",id,a);',
  );
  expect(fields(r)).toContain('C');
  expect(r.writes[0].unknownFields).toBe(true);
  expect(r.writes[0].reasons).toContain('alias-mutation');
});

it('putAll takes a donor snapshot including nested child summaries', () => {
  const r = analyzeDelugeEffects(
    'child={"A":1};donor={"Items":{child}};m=Map();m.putAll(donor);child.put("B",1);zoho.crm.updateRecord("Deals",id,m);',
  );
  expect(r.writes[0].fields.map((f) => f.path)).toEqual([['Items'], ['Items', '[]', 'A']]);
});

it('tracks later map mutations in a list without retroactively changing earlier writes', () => {
  const r = analyzeDelugeEffects(
    'm={"A":1};rows=List();rows.add(m);zoho.crm.bulkUpdate("Deals",rows);m.put("B",1);zoho.crm.bulkUpdate("Deals",rows);',
  );
  expect(fields(r, 0)).toEqual(['A']);
  expect(fields(r, 1)).toEqual(['A', 'B']);
  expect(r.writes[1].unknownFields).toBe(true);
});

it('bounds self-referential heap summaries', () => {
  const r = analyzeDelugeEffects(
    'm=Map();m.put("Self",m);m.putAll(m);zoho.crm.updateRecord("Deals",id,m);',
  );
  expect(r.analysis.status).not.toBe('failed');
  expect(fields(r)).toContain('Self');
  expect(() => JSON.stringify(r)).not.toThrow();
});

it('precomputes loop-carried assignment alternatives before earlier writes', () => {
  const r = analyzeDelugeEffects(
    'mod="Deals";for each r in rows{zoho.crm.updateRecord(mod,id,{"A":1});mod="Contacts";}',
  );
  expect(r.writes[0].module.candidates).toEqual(['Deals', 'Contacts']);
  expect(r.writes[0].module.confidence).toBe('partial');
});

it('precomputes loop putAll additions and includes calls in loop headers once', () => {
  const r = analyzeDelugeEffects(
    'm=Map();for each r in standalone.rows(){zoho.crm.updateRecord("Deals",id,m);m.putAll({"A":1});}',
  );
  expect(fields(r)).toEqual(['A']);
  expect(r.calls.map((c) => c.apiName)).toEqual(['rows']);
  expect(r.writes[0].unknownFields).toBe(true);
});

it('recognizes literal loop collections and fresh maps inside each iteration', () => {
  const r = analyzeDelugeEffects(
    'for each r in {"a","b"}{m=Map();m.put("A",r);zoho.crm.updateRecord("Deals",id,m);}',
  );
  expect(fields(r)).toEqual(['A']);
  expect(r.writes[0].fieldsConfidence).toBe('exact');
});

it('includes possible return/catch/finally effects with control-flow warnings', () => {
  const r = analyzeDelugeEffects(`try {return;${write}} catch(e) {${write}} finally {${write}}`);
  expect(r.writes).toHaveLength(3);
  expect(r.writes[1].contexts[0].kind).toBe('catch');
  expect(r.writes[2].contexts[0].kind).toBe('finally');
  expect(r.warnings.some((w) => w.code === 'control-flow')).toBe(true);
});

it('does not reuse a parameter name as proof of a workflow binding', () => {
  const r = analyzeDelugeEffects(
    'void automation.x(string dealId){copy=dealId;zoho.crm.updateRecord("Deals",copy.toLong(),{"A":1});zoho.crm.updateRecord("Deals",dealId + 1,{"A":1});}',
  );
  expect(r.writes[0].target).toMatchObject({ kind: 'parameter', parameter: 'dealId' });
  expect(r.writes[1].target.kind).toBe('dynamic');
  expect(r.writes[0].trigger.workflow).toBe('not-requested');
});

it('keeps unknown trigger state after an unknown options mutation', () => {
  const r = analyzeDelugeEffects(
    'opts={"trigger":{}};opts.putAll(incoming);zoho.crm.updateRecord("Deals",id,{"A":1},opts);',
  );
  expect(r.writes[0].trigger).toMatchObject({
    mode: 'unknown',
    requested: null,
    workflow: 'unknown',
  });
});

it('does not shift connections into optional argument placeholders', () => {
  const r = analyzeDelugeEffects(
    'zoho.crm.updateRecord("Deals",id,{"A":1},"not_a_connection");zoho.crm.updateRecord("Deals");',
  );
  expect(r.connections).toEqual([]);
  expect(r.writes[0].trigger.mode).toBe('unknown');
  expect(r.writes[1].recognition).toBe('candidate');
});

it('honors case-sensitive task names and unfamiliar version uncertainty', () => {
  const r = analyzeDelugeEffects(
    'zoho.crm.UpdateRecord("Deals",id,{"A":1});zoho.crm.v99.updateRecord("Deals",id,{"A":1});',
  );
  expect(r.writes).toHaveLength(1);
  expect(r.services[0].reasons).toContain('unclassified-crm-call');
  expect(r.writes[0].trigger.mode).toBe('unknown');
  expect(r.warnings.some((w) => w.code === 'unverified-version')).toBe(true);
});

it('never guesses a native tag or arbitrary service connection signature', () => {
  const r = analyzeDelugeEffects(
    'zoho.crm.addTags("Deals",id,"tag");zoho.books.updateRecord("Invoices",id,map,"last_string");',
  );
  expect(r.writes).toEqual([]);
  expect(r.connections).toEqual([]);
  expect(r.services.map((s) => s.service)).toEqual(['crm', 'books']);
});

it('groups unverified related HTTP resources separately from parent module fields', () => {
  const r = analyzeDelugeEffects(
    'r=invokeurl[url:"https://www.zohoapis.com/crm/v8/Products/1/Price_Books/2" type:PUT body:{"data":{{"list_price":1}}}.toString()];',
  );
  expect(r.writes[0]).toMatchObject({
    op: 'update-related',
    recognition: 'candidate',
    resource: 'relationship',
  });
  expect(r.writes[0].parentModule?.value).toBe('Products');
  expect(r.writes[0].module.value).toBe('Price_Books');
});

it.each([
  ['https://www.zohoapis.com@api.example.net/crm/v8/Deals', 'external-url'],
  ['https://www.zohoapis.com.example.net/crm/v8/Deals', 'external-url'],
  ['https://www.zohoapis.eu/crm/v8/Deals', 'unknown-url'],
  ['https://books.zoho.com/api/v3/invoices', 'zoho-service-url'],
])('classifies the actual authority of %s without retaining it', (url, destination) => {
  const r = analyzeDelugeEffects(`r=invokeurl[url:"${url}" type:POST];`);
  expect(r.external[0].destination).toBe(destination);
  expect(r.writes).toEqual([]);
  expect(JSON.stringify(r)).not.toContain(url);
});

it('a hole in the authority does not establish a CRM destination', () => {
  const r = analyzeDelugeEffects('r=invokeurl[url:"https://" + host + "/crm/v8/Deals" type:PUT];');
  expect(r.writes).toEqual([]);
  expect(r.external[0].destination).toBe('unknown-url');
});

it('accepts a caller-established current origin, with HTTP identity joins scoped to it', () => {
  const source =
    'r=invokeurl[url:"https://www.zohoapis.eu/crm/v8/functions/sync/actions/execute" type:GET];';
  const r = analyzeDelugeEffects(source, {
    currentCrmOrigin: 'https://www.zohoapis.eu',
    catalogue: [{ id: 'f', apiName: 'sync' }],
  });
  expect(r.calls[0]).toMatchObject({
    via: 'http-execute',
    resolution: 'exact',
    calleeFunctionId: 'f',
    destinationScope: 'current-org',
  });
  const remote = analyzeDelugeEffects(source.replace('type:GET', 'type:GET connection:"crm"'), {
    currentCrmOrigin: 'https://www.zohoapis.eu',
    catalogue: [{ id: 'f', apiName: 'sync' }],
  });
  expect(remote.calls[0]).toMatchObject({
    resolution: 'not-attempted',
    destinationScope: 'connection-org-unknown',
  });
});

it('uses reserved-route precedence and supports attachment resources', () => {
  const r = analyzeDelugeEffects(
    'a=invokeurl[url:"https://www.zohoapis.com/crm/v8/settings/fields" type:POST];b=invokeurl[url:"https://www.zohoapis.com/crm/v8/Deals/1/Attachments" type:POST];',
  );
  expect(r.writes).toHaveLength(1);
  expect(r.writes[0]).toMatchObject({
    op: 'attach',
    resource: 'attachment',
    fieldsConfidence: 'not-applicable',
  });
});

it('keeps malformed/duplicate request properties uncertain and still finds nested calls', () => {
  const r = analyzeDelugeEffects(
    'r=invokeurl[url:"https://www.zohoapis.com/crm/v8/Deals" type:PUT body:{"data":{{"A":1}}} parameters:standalone.payload() connection:"a" connection:"b"];',
  );
  expect(r.writes[0].unknownFields).toBe(true);
  expect(r.connections[0].name.confidence).not.toBe('exact');
  expect(r.calls[0].apiName).toBe('payload');
  expect(r.warnings.some((w) => w.code === 'invalid-request')).toBe(true);
});

it('keeps unsupported input and explicitly unsupported invokeapi services visible', () => {
  const r = analyzeDelugeEffects(write, { language: 'javascript' });
  expect(r.analysis.status).toBe('unsupported');
  expect(r.analysis.unscanned).toEqual([{ start: 0, end: write.length }]);
  expect(r.writes).toEqual([]);
  const other = analyzeDelugeEffects('r=invokeapi[service:unknownService path:"/x" type:POST];');
  expect(other.analysis.status).toBe('limited');
  expect(other.warnings.some((w) => w.code === 'unsupported-form')).toBe(true);
});

it('honors catalogue category evidence and leaves Creator calls outside CRM', () => {
  const r = analyzeDelugeEffects('button.sync(id);sync(id);thisapp.sync(id);', {
    catalogue: [{ id: 'f', apiName: 'sync', category: 'button' }],
  });
  expect(r.calls.map((c) => c.kind)).toEqual([
    'crm-function',
    'crm-function',
    'other-product-function',
  ]);
  expect(r.calls.map((c) => c.resolution)).toEqual(['exact', 'exact', 'not-attempted']);
});

it('does not let prototype property names corrupt structural parsing or registries', () => {
  const r = analyzeDelugeEffects(
    'm={"toString":1,"constructor":2,"__proto__":3};m.putAll(m);zoho.crm.updateRecord("Deals",id,m);zoho.crm.constructor();',
  );
  expect(fields(r)).toEqual(['toString', 'constructor', '__proto__']);
  expect(r.analysis.status).toBe('analyzed');
  expect(r.services[0].recognition).toBe('candidate');
});

it('keeps stale-source freshness separate from extraction confidence', () => {
  const r = analyzeDelugeEffects(write, { freshness: 'cached-stale' });
  expect(r.analysis.freshness).toBe('cached-stale');
  expect(r.writes[0].confidence).toBe('exact');
  expect(r.warnings[0].code).toBe('source-stale');
});

it('preserves declared parameter provenance across branch and loop joins', () => {
  const r = analyzeDelugeEffects(
    'void automation.x(string dealId){if(flag){a=1;}for each x in rows{a=2;}zoho.crm.updateRecord("Deals",dealId,{"A":1});}',
  );
  expect(r.writes[0].target).toMatchObject({
    kind: 'parameter',
    parameter: 'dealId',
    directParameter: true,
  });
});

it('serializes a map snapshot without later alias mutations and decodes only at HTTP sinks', () => {
  const r = analyzeDelugeEffects(
    'm={"A":1};p={"data":{m}}.toString();m.put("B",1);r=invokeurl[url:"https://www.zohoapis.com/crm/v8/Deals" type:PUT body:p];zoho.crm.updateRecord("Deals",id,m.toString());',
  );
  expect(fields(r, 0)).toEqual(['A']);
  expect(r.writes[1].fieldsConfidence).toBe('unknown');
});

it('does not invent an empty map from an unsupported constructor overload', () => {
  const r = analyzeDelugeEffects('m=Map(payload);zoho.crm.updateRecord("Deals",id,m);');
  expect(r.writes[0].unknownFields).toBe(true);
  expect(r.writes[0].reasons).toContain('unsupported-constructor');
});

it('records skipped expression ranges when a nesting budget hides executable source', () => {
  const source = `m={"A":{"B":standalone.nested()}};${write}`;
  const r = analyzeDelugeEffects(source, { limits: { payloadDepth: 1 } });
  expect(r.analysis.status).toBe('limited');
  expect(r.analysis.unscanned.length).toBeGreaterThan(0);
});

it('distinguishes a missing catalogue target from a resolution not attempted', () => {
  const source = 'standalone.missing(id);';
  expect(analyzeDelugeEffects(source).calls[0].resolution).toBe('not-attempted');
  expect(analyzeDelugeEffects(source, { catalogue: [] }).calls[0].resolution).toBe('missing');
});

it('keeps invokeapi mutations with dynamic paths in the unresolved CRM bucket', () => {
  const r = analyzeDelugeEffects(
    'r=invokeapi[service:zohocrm path:pathArg type:PUT body:payload];',
  );
  expect(r.writes[0]).toMatchObject({
    op: 'crm-mutation',
    via: 'invokeapi',
    moduleConfidence: 'unknown',
    unknownFields: true,
  });
  expect(r.external).toEqual([]);
});

it('never treats unknown REST action names as related module names', () => {
  const r = analyzeDelugeEffects(
    'r=invokeurl[url:"https://www.zohoapis.com/crm/v8/Deals/123/actions/unknown_action" type:POST body:payload];',
  );
  expect(r.writes[0]).toMatchObject({ op: 'crm-mutation', recognition: 'candidate' });
  expect(r.writes[0].module.value).toBe('Deals');
});

it.each([
  ['{"Leads"}', 'Leads', ['Leads']],
  ['{"Leads","Contacts"}', null, ['Leads', 'Contacts']],
  ['input.get("modules")', null, []],
])('rebinds loop iterators from %s instead of retaining previous values', (iterable, expected, candidates) => {
  const r = analyzeDelugeEffects(
    `m="Deals";for each m in ${iterable}{zoho.crm.updateRecord(m,1,{"Status":"X"});}`,
  );
  expect(r.writes).toHaveLength(1);
  expect(r.writes[0].module.value).toBe(expected);
  expect(r.writes[0].module.candidates).toEqual(candidates);
  expect(r.writes[0].module.confidence).toBe(
    expected ? 'exact' : candidates.length ? 'partial' : 'unknown',
  );
});
