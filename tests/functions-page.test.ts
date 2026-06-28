import { beforeEach, describe, expect, it } from 'vitest';
import {
  findCreateFunctionButton,
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
