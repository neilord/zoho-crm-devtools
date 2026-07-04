import { beforeEach, describe, expect, it, vi } from 'vitest';
import { injectSearchButton, SEARCH_BUTTON_ID } from '../src/content/functions/toolbar-button';

describe('search button injection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('inserts the button immediately after the search row anchor by default', () => {
    document.body.innerHTML =
      '<div id="bar"><div id="search-wrapper"><lyte-input id="functionSearch"></lyte-input></div><button id="create">+ Create Function</button></div>';
    const anchor = document.getElementById('search-wrapper') as HTMLElement;

    const button = injectSearchButton(anchor, () => {});

    expect(button?.id).toBe(SEARCH_BUTTON_ID);
    expect(anchor.nextElementSibling?.id).toBe(SEARCH_BUTTON_ID);
    expect(button?.textContent).toBe('Search All Functions');
  });

  it('can insert before the create-function fallback anchor', () => {
    document.body.innerHTML = '<div id="bar"><button id="create">+ Create Function</button></div>';
    const anchor = document.getElementById('create') as HTMLElement;

    const button = injectSearchButton(anchor, () => {}, 'before');

    expect(button?.id).toBe(SEARCH_BUTTON_ID);
    expect(anchor.previousElementSibling?.id).toBe(SEARCH_BUTTON_ID);
  });

  it('is idempotent across repeated calls', () => {
    document.body.innerHTML =
      '<div id="bar"><div id="search-wrapper"><lyte-input id="functionSearch"></lyte-input></div></div>';
    const anchor = document.getElementById('search-wrapper') as HTMLElement;

    injectSearchButton(anchor, () => {});
    injectSearchButton(anchor, () => {});

    expect(document.querySelectorAll(`#${SEARCH_BUTTON_ID}`)).toHaveLength(1);
  });

  it('invokes the click handler', () => {
    document.body.innerHTML = '<div id="bar"><button id="create">+ Create Function</button></div>';
    const anchor = document.getElementById('create') as HTMLElement;
    const onClick = vi.fn();

    const button = injectSearchButton(anchor, onClick);
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('moves an existing fallback button after the native search anchor', () => {
    document.body.innerHTML =
      '<div id="bar"><div id="search-wrapper"><lyte-input id="functionSearch"></lyte-input></div><button id="create">+ Create Function</button></div>';
    const searchAnchor = document.getElementById('search-wrapper') as HTMLElement;
    const createAnchor = document.getElementById('create') as HTMLElement;

    const button = injectSearchButton(createAnchor, () => {}, 'before');
    injectSearchButton(searchAnchor, () => {});

    expect(document.querySelectorAll(`#${SEARCH_BUTTON_ID}`)).toHaveLength(1);
    expect(searchAnchor.nextElementSibling).toBe(button);
  });

  it('applies the hover style', () => {
    document.body.innerHTML =
      '<div id="bar"><div id="search-wrapper"><lyte-input id="functionSearch"></lyte-input></div></div>';
    const anchor = document.getElementById('search-wrapper') as HTMLElement;

    const button = injectSearchButton(anchor, () => {});
    button?.dispatchEvent(new Event('mouseenter'));

    expect(button?.style.background).toBe('rgb(247, 249, 255)');
    expect(button?.style.borderColor).toBe('rgb(106, 120, 255)');
  });

  it('returns null when the anchor has no parent', () => {
    const orphan = document.createElement('button');
    expect(injectSearchButton(orphan, () => {})).toBeNull();
  });
});
