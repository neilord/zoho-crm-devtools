import { beforeEach, describe, expect, it } from 'vitest';
import { injectSearchButton, SEARCH_BUTTON_ID } from '../src/content/functions/toolbar-button';
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

  it('places one button outside the new toolbar search wrapper after a rerender', () => {
    // Minimal sanitized structure observed in the September 2026 Functions UI.
    const toolbar = `
      <div class="flexAlignCenter">
        <div id="filters">Sort Filter</div>
        <div data-zcqa="fxn_lv_search_parent" class="fShrink0 fg1 mL15">
          <lyte-input data-zcqa="fxn_lv_search" class="w225" role="search">
            <div class="lyteField lyteInputBoxSearch"><input placeholder="Search"></div>
          </lyte-input>
        </div>
      </div>`;
    document.body.innerHTML = '<button id="create">Create Function</button>';
    const button = injectSearchButton(
      findCreateFunctionButton() as HTMLElement,
      () => {},
      'before',
    );

    for (let render = 0; render < 2; render++) {
      document.querySelector('.flexAlignCenter')?.remove();
      document.body.insertAdjacentHTML('beforeend', toolbar);
      const anchor = findFunctionSearchButtonAnchor() as HTMLElement;
      expect(findFunctionSearchControl()?.dataset.zcqa).toBe('fxn_lv_search');
      expect(anchor.dataset.zcqa).toBe('fxn_lv_search_parent');
      injectSearchButton(anchor, () => {});
      injectSearchButton(anchor, () => {});
      expect(anchor.nextElementSibling?.id).toBe(SEARCH_BUTTON_ID);
      if (render === 0) {
        expect(anchor.nextElementSibling).toBe(button);
      }
      expect(anchor.querySelector('button')).toBeNull();
      expect(document.querySelectorAll(`#${SEARCH_BUTTON_ID}`)).toHaveLength(1);
    }
  });
});
