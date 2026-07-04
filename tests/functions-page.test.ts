import { beforeEach, describe, expect, it } from 'vitest';
import {
  findCreateFunctionButton,
  findFunctionSearchButtonAnchor,
  findFunctionSearchControl,
  isFunctionsListLocation,
} from '../src/content/zoho/functions-page';

describe('functions page detection', () => {
  it('recognizes the functions settings location', () => {
    expect(isFunctionsListLocation({ pathname: '/crm/org1/settings/functions/myFunctions' })).toBe(
      true,
    );
  });

  it('rejects unrelated CRM locations', () => {
    expect(isFunctionsListLocation({ pathname: '/crm/org1/tab/Leads' })).toBe(false);
  });
});

describe('create-function button discovery', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds the button by its text', () => {
    document.body.innerHTML = `
      <div>
        <button id="decoy">View Deprecated Functions</button>
        <button id="create">+ Create Function</button>
      </div>`;
    expect(findCreateFunctionButton()?.id).toBe('create');
  });

  it('returns null when no matching control exists', () => {
    document.body.innerHTML = '<button>Save</button>';
    expect(findCreateFunctionButton()).toBeNull();
  });

  it('ignores large containers that merely contain the phrase', () => {
    document.body.innerHTML = `
      <section>This page lets you create function definitions and much more text here</section>
      <a role="button" id="link">Create Function</a>`;
    expect(findCreateFunctionButton()?.id).toBe('link');
  });
});

describe('native function search discovery', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds the built-in function search control by id', () => {
    document.body.innerHTML = '<lyte-input id="functionSearch"></lyte-input>';
    expect(findFunctionSearchControl()?.id).toBe('functionSearch');
  });

  it('finds the built-in function search control by qa attribute', () => {
    document.body.innerHTML = '<lyte-input data-zcqa="cfSearchFunctions"></lyte-input>';
    expect(findFunctionSearchControl()?.getAttribute('data-zcqa')).toBe('cfSearchFunctions');
  });

  it('uses the native search wrapper as the button placement anchor', () => {
    document.body.innerHTML = `
      <div class="search-function" id="searchWrapper">
        <lyte-input id="functionSearch"></lyte-input>
      </div>`;
    expect(findFunctionSearchButtonAnchor()?.id).toBe('searchWrapper');
  });

  it('falls back to the search control when the wrapper is missing', () => {
    document.body.innerHTML = '<lyte-input id="functionSearch"></lyte-input>';
    expect(findFunctionSearchButtonAnchor()?.id).toBe('functionSearch');
  });
});
