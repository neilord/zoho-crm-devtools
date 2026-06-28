import { beforeEach, describe, expect, it, vi } from 'vitest';
import { injectSearchButton, SEARCH_BUTTON_ID } from '../src/content/functions/toolbar-button';

describe('search button injection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('inserts the button immediately before the anchor', () => {
    document.body.innerHTML = '<div id="bar"><button id="create">+ Create Function</button></div>';
    const anchor = document.getElementById('create') as HTMLElement;

    const button = injectSearchButton(anchor, () => {});

    expect(button?.id).toBe(SEARCH_BUTTON_ID);
    expect(anchor.previousElementSibling?.id).toBe(SEARCH_BUTTON_ID);
  });

  it('is idempotent across repeated calls', () => {
    document.body.innerHTML = '<div id="bar"><button id="create">+ Create Function</button></div>';
    const anchor = document.getElementById('create') as HTMLElement;

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

  it('returns null when the anchor has no parent', () => {
    const orphan = document.createElement('button');
    expect(injectSearchButton(orphan, () => {})).toBeNull();
  });
});
