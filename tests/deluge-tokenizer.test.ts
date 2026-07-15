import { describe, expect, it } from 'vitest';
import { type DelugeToken, tokenizeDeluge } from '../src/syntax/deluge-tokenizer';

/** Category output for every classified token, dropping whitespace/plain runs. */
function classified(source: string): Array<{ text: string; token: string }> {
  return tokenizeDeluge(source)
    .filter((token): token is DelugeToken & { token: string } => token.token !== null)
    .map(({ text, token }) => ({ text, token }));
}

describe('tokenizeDeluge', () => {
  it('tiles the whole source so tokens reproduce the input verbatim', () => {
    const source = 'x = 1;\n// done\n';
    const tokens = tokenizeDeluge(source);

    expect(tokens.map((token) => token.text).join('')).toBe(source);
    // Offsets are contiguous with no gaps.
    let cursor = 0;
    for (const token of tokens) {
      expect(token.start).toBe(cursor);
      expect(token.end).toBe(token.start + token.text.length);
      cursor = token.end;
    }
    expect(cursor).toBe(source.length);
  });

  it('classifies line and block comments', () => {
    expect(classified('// a comment')).toEqual([{ text: '// a comment', token: 'comment' }]);
    expect(classified('/* block\nspanning */x')).toEqual([
      { text: '/* block\nspanning */', token: 'comment' },
      { text: 'x', token: 'variable' },
    ]);
  });

  it('handles strings with escapes and both quote styles', () => {
    expect(classified('"he said \\"hi\\""')).toEqual([
      { text: '"he said \\"hi\\""', token: 'string' },
    ]);
    expect(classified("'it\\'s ok'")).toEqual([{ text: "'it\\'s ok'", token: 'string' }]);
  });

  it('keeps decimal points inside numbers', () => {
    expect(classified('3.14')).toEqual([{ text: '3.14', token: 'number' }]);
    expect(classified('42')).toEqual([{ text: '42', token: 'number' }]);
  });

  it('separates logical, comparison, and arithmetic operators', () => {
    expect(classified('a && b || !c')).toEqual([
      { text: 'a', token: 'variable' },
      { text: '&&', token: 'logical-operator' },
      { text: 'b', token: 'variable' },
      { text: '||', token: 'logical-operator' },
      { text: '!', token: 'logical-operator' },
      { text: 'c', token: 'variable' },
    ]);
    expect(classified('x >= 1 == y')).toEqual([
      { text: 'x', token: 'variable' },
      { text: '>=', token: 'comparison-operator' },
      { text: '1', token: 'number' },
      { text: '==', token: 'comparison-operator' },
      { text: 'y', token: 'variable' },
    ]);
    expect(classified('a + b * c')).toEqual([
      { text: 'a', token: 'variable' },
      { text: '+', token: 'operator' },
      { text: 'b', token: 'variable' },
      { text: '*', token: 'operator' },
      { text: 'c', token: 'variable' },
    ]);
  });

  it('classifies brackets and separators as brackets and punctuation', () => {
    expect(classified('f(a, b);')).toEqual([
      { text: 'f', token: 'callable' },
      { text: '(', token: 'bracket' },
      { text: 'a', token: 'variable' },
      { text: ',', token: 'punctuation' },
      { text: 'b', token: 'variable' },
      { text: ')', token: 'bracket' },
      { text: ';', token: 'punctuation' },
    ]);
  });

  it('distinguishes keywords, types, and constants', () => {
    expect(classified('if (x) return;')).toEqual([
      { text: 'if', token: 'control' },
      { text: '(', token: 'bracket' },
      { text: 'x', token: 'variable' },
      { text: ')', token: 'bracket' },
      { text: 'return', token: 'control' },
      { text: ';', token: 'punctuation' },
    ]);
    expect(classified('string name = null;')).toEqual([
      { text: 'string', token: 'type' },
      { text: 'name', token: 'variable' },
      { text: '=', token: 'operator' },
      { text: 'null', token: 'constant' },
      { text: ';', token: 'punctuation' },
    ]);
  });

  it('splits zoho and automation namespaces from their member chains', () => {
    expect(classified('zoho.crm.getRecords("Leads");')).toEqual([
      { text: 'zoho', token: 'namespace' },
      { text: '.crm.getRecords', token: 'method' },
      { text: '(', token: 'bracket' },
      { text: '"Leads"', token: 'string' },
      { text: ')', token: 'bracket' },
      { text: ';', token: 'punctuation' },
    ]);
    expect(classified('automation.runFlow("x");')).toEqual([
      { text: 'automation', token: 'service-namespace' },
      { text: '.runFlow', token: 'method' },
      { text: '(', token: 'bracket' },
      { text: '"x"', token: 'string' },
      { text: ')', token: 'bracket' },
      { text: ';', token: 'punctuation' },
    ]);
  });

  it('distinguishes a called member (method) from an accessed member (property)', () => {
    expect(classified('rec.add("v")')).toEqual([
      { text: 'rec', token: 'variable' },
      { text: '.add', token: 'method' },
      { text: '(', token: 'bracket' },
      { text: '"v"', token: 'string' },
      { text: ')', token: 'bracket' },
    ]);
    expect(classified('rec.status')).toEqual([
      { text: 'rec', token: 'variable' },
      { text: '.status', token: 'property' },
    ]);
  });

  it('recognizes invokeurl blocks with block keys and HTTP methods', () => {
    const source = 'resp = invokeurl\n[\nurl :"https://x"\ntype :GET\n];';
    expect(classified(source)).toEqual([
      { text: 'resp', token: 'variable' },
      { text: '=', token: 'operator' },
      { text: 'invokeurl', token: 'special-form' },
      { text: '[', token: 'bracket' },
      { text: 'url', token: 'block-key' },
      { text: ':', token: 'punctuation' },
      { text: '"https://x"', token: 'string' },
      { text: 'type', token: 'block-key' },
      { text: ':', token: 'punctuation' },
      { text: 'GET', token: 'http-method' },
      { text: ']', token: 'bracket' },
      { text: ';', token: 'punctuation' },
    ]);
  });

  it('treats the for-each index keyword and in operator specially', () => {
    expect(classified('for each index i in list')).toEqual([
      { text: 'for', token: 'control' },
      { text: 'each', token: 'control' },
      { text: 'index', token: 'control' },
      { text: 'i', token: 'variable' },
      { text: 'in', token: 'comparison-operator' },
      { text: 'list', token: 'type' },
    ]);
  });

  it('classifies a realistic multi-line function', () => {
    const source = [
      'void updateLead(int leadId)',
      '{',
      '\t// look up the record',
      '\tmp = zoho.crm.getRecordById("Leads", leadId);',
      '\tif(mp.get("Status") == "New")',
      '\t{',
      '\t\tmp.put("Status", "Working");',
      '\t}',
      '}',
    ].join('\n');

    const tokens = tokenizeDeluge(source);
    expect(tokens.map((token) => token.text).join('')).toBe(source);

    const found = classified(source);
    expect(found).toContainEqual({ text: 'void', token: 'type' });
    expect(found).toContainEqual({ text: 'updateLead', token: 'callable' });
    expect(found).toContainEqual({ text: 'int', token: 'type' });
    expect(found).toContainEqual({ text: 'leadId', token: 'variable' });
    expect(found).toContainEqual({ text: '// look up the record', token: 'comment' });
    expect(found).toContainEqual({ text: 'zoho', token: 'namespace' });
    expect(found).toContainEqual({ text: '.crm.getRecordById', token: 'method' });
    expect(found).toContainEqual({ text: 'if', token: 'control' });
    expect(found).toContainEqual({ text: '.get', token: 'method' });
    expect(found).toContainEqual({ text: '.put', token: 'method' });
    expect(found).toContainEqual({ text: '==', token: 'comparison-operator' });
    expect(found).toContainEqual({ text: '"New"', token: 'string' });
  });
});
