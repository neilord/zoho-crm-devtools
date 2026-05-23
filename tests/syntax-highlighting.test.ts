import { beforeEach, describe, expect, it } from 'vitest';
import {
  applySyntaxEnhancementPreference,
  SYNTAX_ENHANCEMENT_ENABLED_ATTR,
  SYNTAX_TOKEN_ATTR,
} from '../src/syntax/syntax-highlighting';

describe('syntax highlighting enhancement', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="CodeMirror-deluge-edit-task"></div>';
  });

  it('enables syntax enhancement styling on the live Deluge editor surface', () => {
    expect(applySyntaxEnhancementPreference(true)).toBe(1);

    expect(
      document
        .querySelector('.CodeMirror-deluge-edit-task')
        ?.getAttribute(SYNTAX_ENHANCEMENT_ENABLED_ATTR),
    ).toBe('true');
  });

  it('removes syntax enhancement styling when the preference is disabled', () => {
    const editorSurface = document.querySelector('.CodeMirror-deluge-edit-task');
    editorSurface?.setAttribute(SYNTAX_ENHANCEMENT_ENABLED_ATTR, 'true');
    if (editorSurface) {
      editorSurface.innerHTML = `
        <pre class="CodeMirror-line">
          <span><span class="cm-syntax" ${SYNTAX_TOKEN_ATTR}="control">info</span></span>
        </pre>`;
    }

    applySyntaxEnhancementPreference(false);

    expect(editorSurface?.hasAttribute(SYNTAX_ENHANCEMENT_ENABLED_ATTR)).toBe(false);
    expect(editorSurface?.querySelector(`[${SYNTAX_TOKEN_ATTR}]`)).toBeNull();
  });

  it('handles pages without a live Deluge editor surface', () => {
    document.body.innerHTML = '<div></div>';

    expect(applySyntaxEnhancementPreference(true)).toBe(0);
  });

  it('annotates Zoho tokens consistently across similar call expressions', () => {
    document.body.innerHTML = `
      <div class="CodeMirror-deluge-edit-task">
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-syntax">zoho</span>
            <span class="cm-variable">.crm.updateRecord</span>
            <span class="cm-brackets">(</span>
            <span class="cm-string">"Deals"</span>
            <span class="cm-separator">,</span>
            <span class="cm-variable">recId_</span>
            <span class="cm-brackets">)</span>
            <span class="cm-semicolon">;</span>
          </span>
        </pre>
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-syntax">info</span>
            <span class="cm-syntax">zoho</span>
            <span class="cm-variable">.crm.updateRecord</span>
            <span class="cm-brackets">(</span>
            <span class="cm-string">"Deals"</span>
            <span class="cm-separator">,</span>
            <span class="cm-variable">recId_</span>
            <span class="cm-brackets">)</span>
            <span class="cm-semicolon">;</span>
          </span>
        </pre>
      </div>`;

    applySyntaxEnhancementPreference(true);

    const tokens = [...document.querySelectorAll(`[${SYNTAX_TOKEN_ATTR}]`)].map((token) => ({
      text: token.textContent,
      semantic: token.getAttribute(SYNTAX_TOKEN_ATTR),
    }));

    expect(tokens).toEqual([
      { text: 'zoho', semantic: 'namespace' },
      { text: '.crm.updateRecord', semantic: 'method' },
      { text: '(', semantic: 'bracket' },
      { text: '"Deals"', semantic: 'string' },
      { text: ',', semantic: 'punctuation' },
      { text: 'recId_', semantic: 'variable' },
      { text: ')', semantic: 'bracket' },
      { text: ';', semantic: 'punctuation' },
      { text: 'info', semantic: 'control' },
      { text: 'zoho', semantic: 'namespace' },
      { text: '.crm.updateRecord', semantic: 'method' },
      { text: '(', semantic: 'bracket' },
      { text: '"Deals"', semantic: 'string' },
      { text: ',', semantic: 'punctuation' },
      { text: 'recId_', semantic: 'variable' },
      { text: ')', semantic: 'bracket' },
      { text: ';', semantic: 'punctuation' },
    ]);
  });

  it('supports grouped and pre-split member access shapes', () => {
    document.body.innerHTML = `
      <div class="CodeMirror-deluge-edit-task">
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-variable">pLeadDetailFields.add</span>
            <span class="cm-brackets">(</span>
            <span class="cm-string">"Lead_Brand"</span>
            <span class="cm-brackets">)</span>
            <span class="cm-semicolon">;</span>
          </span>
        </pre>
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-variable">pLeadDetailFields</span>
            <span class="cm-zcdt-member-method">.add</span>
            <span class="cm-brackets">(</span>
            <span class="cm-string">"Lead_Origin"</span>
            <span class="cm-brackets">)</span>
            <span class="cm-semicolon">;</span>
          </span>
        </pre>
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-variable">obj</span>
            <span class="cm-zcdt-member-property">.prop</span>
            <span class="cm-semicolon">;</span>
          </span>
        </pre>
      </div>`;

    applySyntaxEnhancementPreference(true);

    const tokens = [...document.querySelectorAll(`[${SYNTAX_TOKEN_ATTR}]`)].map((token) => ({
      text: token.textContent,
      semantic: token.getAttribute(SYNTAX_TOKEN_ATTR),
    }));

    expect(tokens).toContainEqual({ text: 'pLeadDetailFields', semantic: 'variable' });
    expect(tokens).toContainEqual({ text: '.add', semantic: 'method' });
    expect(tokens).toContainEqual({ text: 'obj', semantic: 'variable' });
    expect(tokens).toContainEqual({ text: '.prop', semantic: 'property' });
  });

  it('restores grouped member spans when the preference is disabled', () => {
    document.body.innerHTML = `
      <div class="CodeMirror-deluge-edit-task">
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-variable">pLeadDetailFields.add</span>
            <span class="cm-brackets">(</span>
            <span class="cm-string">"Lead_Brand"</span>
            <span class="cm-brackets">)</span>
            <span class="cm-semicolon">;</span>
          </span>
        </pre>
      </div>`;

    applySyntaxEnhancementPreference(true);
    applySyntaxEnhancementPreference(false);

    const variableTokens = [
      ...document.querySelectorAll(
        '.CodeMirror-deluge-edit-task .CodeMirror-line span.cm-variable',
      ),
    ].map((token) => token.textContent);

    expect(variableTokens).toEqual(['pLeadDetailFields.add']);
    expect(document.querySelector('[data-zcdt-split-group]')).toBeNull();
    expect(document.querySelector(`[${SYNTAX_TOKEN_ATTR}]`)).toBeNull();
  });

  it('uses bracket direction to avoid coloring plain arguments as methods', () => {
    document.body.innerHTML = `
      <div class="CodeMirror-deluge-edit-task">
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-variable">ifnull</span>
            <span class="cm-brackets">(</span>
            <span class="cm-variable">sFName</span>
            <span class="cm-brackets">)</span>
          </span>
        </pre>
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-variable">return</span>
            <span class="cm-semicolon">;</span>
          </span>
        </pre>
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-syntax">else if</span>
            <span class="cm-brackets">(</span>
            <span class="cm-variable">isPhone</span>
            <span class="cm-brackets">)</span>
          </span>
        </pre>
      </div>`;

    applySyntaxEnhancementPreference(true);

    const tokens = [...document.querySelectorAll(`[${SYNTAX_TOKEN_ATTR}]`)].map((token) => ({
      text: token.textContent,
      semantic: token.getAttribute(SYNTAX_TOKEN_ATTR),
    }));

    expect(tokens).toContainEqual({ text: 'ifnull', semantic: 'callable' });
    expect(tokens).toContainEqual({ text: 'sFName', semantic: 'variable' });
    expect(tokens).toContainEqual({ text: 'return', semantic: 'control' });
    expect(tokens).toContainEqual({ text: 'else if', semantic: 'control' });
  });

  it('annotates inspected Deluge special forms and custom calls', () => {
    document.body.innerHTML = `
      <div class="CodeMirror-deluge-edit-task">
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-variable">nZohoProjectsPortalId</span>
            <span class="cm-operator">=</span>
            <span class="cm-variable">standalone.variables</span>
            <span class="cm-brackets">(</span>
            <span class="cm-string">"nZohoProjectsPortalId"</span>
            <span class="cm-brackets">)</span>
            <span class="cm-semicolon">;</span>
          </span>
        </pre>
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-variable">resp</span>
            <span class="cm-operator">=</span>
            <span class="cm-syntax">invokeurl</span>
          </span>
        </pre>
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-variable">url</span>
            <span class="cm-operator">:</span>
            <span class="cm-string">"https://projectsapi.zoho.com"</span>
          </span>
        </pre>
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-variable">type</span>
            <span class="cm-operator">:</span>
            <span class="cm-syntax">GET</span>
          </span>
        </pre>
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-syntax">for each</span>
            <span class="cm-tab" role="presentation"> </span>
            <span class="cm-syntax">index</span>
            <span class="cm-variable">i</span>
            <span class="cm-relop">in</span>
            <span class="cm-variable">pMilestones</span>
          </span>
        </pre>
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-syntax">for</span>
            <span class="cm-syntax">each</span>
            <span class="cm-syntax cm-overlay cm-searching">index</span>
            <span class="cm-variable">j</span>
            <span class="cm-relop">in</span>
            <span class="cm-variable">pItems</span>
          </span>
        </pre>
      </div>`;

    applySyntaxEnhancementPreference(true);

    const tokens = [...document.querySelectorAll(`[${SYNTAX_TOKEN_ATTR}]`)].map((token) => ({
      text: token.textContent,
      semantic: token.getAttribute(SYNTAX_TOKEN_ATTR),
    }));

    expect(tokens).toContainEqual({ text: 'standalone.variables', semantic: 'custom-call' });
    expect(tokens).toContainEqual({ text: 'invokeurl', semantic: 'special-form' });
    expect(tokens).toContainEqual({ text: 'url', semantic: 'block-key' });
    expect(tokens).toContainEqual({ text: 'type', semantic: 'block-key' });
    expect(tokens).toContainEqual({ text: 'GET', semantic: 'http-method' });
    expect(tokens).toContainEqual({ text: 'index', semantic: 'control' });
    expect(tokens).toContainEqual({ text: 'i', semantic: 'variable' });
    expect(tokens).toContainEqual({ text: 'j', semantic: 'variable' });
  });

  it('separates comparison and boolean logical operators', () => {
    document.body.innerHTML = `
      <div class="CodeMirror-deluge-edit-task">
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-variable">isPhone</span>
            <span class="cm-operator">=</span>
            <span class="cm-variable">sPhone.length</span>
            <span class="cm-brackets">()</span>
            <span class="cm-tag">&gt;</span>
            <span class="cm-constant">1</span>
            <span class="cm-logicalOpr">&amp;&amp;</span>
            <span class="cm-logicalOpr">!</span>
            <span class="cm-variable">pNoNameList.contains</span>
            <span class="cm-brackets">(sPhone)</span>
            <span class="cm-semicolon">;</span>
          </span>
        </pre>
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-variable">count</span>
            <span class="cm-relop">==</span>
            <span class="cm-constant">10</span>
          </span>
        </pre>
      </div>`;

    applySyntaxEnhancementPreference(true);

    const tokens = [...document.querySelectorAll(`[${SYNTAX_TOKEN_ATTR}]`)].map((token) => ({
      text: token.textContent,
      semantic: token.getAttribute(SYNTAX_TOKEN_ATTR),
    }));

    expect(tokens).toContainEqual({ text: '>', semantic: 'comparison-operator' });
    expect(tokens).toContainEqual({ text: '==', semantic: 'comparison-operator' });
    expect(tokens).toContainEqual({ text: '&&', semantic: 'logical-operator' });
    expect(tokens).toContainEqual({ text: '!', semantic: 'logical-operator' });
  });

  it('does not keep re-splitting already enhanced member access', () => {
    document.body.innerHTML = `
      <div class="CodeMirror-deluge-edit-task">
        <pre class="CodeMirror-line">
          <span>
            <span class="cm-variable">pLeadDetailFields.add</span>
            <span class="cm-brackets">(</span>
            <span class="cm-string">"Lead_Brand"</span>
            <span class="cm-brackets">)</span>
          </span>
        </pre>
      </div>`;

    applySyntaxEnhancementPreference(true);
    applySyntaxEnhancementPreference(true);
    applySyntaxEnhancementPreference(true);

    expect(document.querySelectorAll('[data-zcdt-split-group-start="true"]')).toHaveLength(1);
    expect(
      [...document.querySelectorAll(`[${SYNTAX_TOKEN_ATTR}="method"]`)].map(
        (token) => token.textContent,
      ),
    ).toEqual(['.add']);
  });
});
