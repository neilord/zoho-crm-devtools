// @vitest-environment node
import { expect, it } from 'vitest';
import { analyzeDelugeEffects } from '../src/content/automation-map/analyzer';

/** Invented bodies mix key propagation, branches, loops, HTTP and nested calls. */
function syntheticFunction(index: number, lines: number): string {
  const body = [
    `void automation.synthetic_${index}(string id) {`,
    'moduleName="Deals"; m=Map(); m.put("Stage", "Example"); rows=List();',
  ];
  for (let line = 0; line < lines; line++) {
    switch (line % 20) {
      case 0:
        body.push('m.put("Description", "Example");');
        break;
      case 1:
        body.push('if(flag){m.put("Amount", value);}else{m.put("Stage", value);}');
        break;
      case 2:
        body.push('scratch="string containing zoho.crm.updateRecord is data";');
        break;
      case 3:
        body.push('// 😀 synthetic comment, no executable effects');
        break;
      default:
        body.push(`scratch=${line};`);
    }
  }
  body.push(
    'zoho.crm.updateRecord(moduleName,id,m,{"trigger":{"workflow"}});',
    'for each row in incoming { fresh={"Last_Name":value};rows.add(fresh); }',
    'zoho.crm.bulkCreate("Leads",rows);',
    'standalone.follow_up(id);',
    'r=invokeurl[url:"https://www.zohoapis.com/crm/v8/Deals/"+id type:PUT body:{"data":{m}}.toString()];',
    '}',
  );
  return body.join('\n');
}

it('analyzes 300 mixed synthetic functions within a generous CI ceiling', () => {
  // Warm module/JIT paths before sampling; measurements include tokenizer and normalization.
  for (let i = 0; i < 5; i++) analyzeDelugeEffects(syntheticFunction(i, 40));
  const durations: number[] = [];
  let limited = 0;
  const started = performance.now();
  for (let i = 0; i < 300; i++) {
    const source = syntheticFunction(i, i < 3 ? 3000 : 20 + (i % 8) * 20);
    const start = performance.now();
    const result = analyzeDelugeEffects(source);
    durations.push(performance.now() - start);
    expect(result.analysis.status).not.toBe('failed');
    if (result.analysis.status === 'limited') limited++;
    expect(result.writes.length).toBeGreaterThanOrEqual(2);
    expect(result.calls.map((c) => c.apiName)).toEqual(['follow_up']);
  }
  const total = performance.now() - started;
  durations.sort((a, b) => a - b);
  const p50 = durations[Math.floor(durations.length * 0.5)];
  const p95 = durations[Math.floor(durations.length * 0.95)];
  const max = durations[durations.length - 1];
  console.log(
    `Deluge effects corpus: n=300 p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms total=${total.toFixed(1)}ms limited=${limited}`,
  );
  expect(total).toBeLessThan(15000);
  expect(max).toBeLessThan(2000);
}, 30000);
