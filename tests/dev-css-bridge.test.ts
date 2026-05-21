import { beforeEach, describe, expect, it } from 'vitest';
import { createManifest } from '../manifest.config';
import {
  clearDevCss,
  insertDevCss,
  installDevCssBridge,
} from '../src/internal/dev-css-bridge/control';
import {
  DEFAULT_DEV_CSS_NAME,
  DEV_CSS_CLEAR_ATTR,
  DEV_CSS_INPUT_ATTR,
  DEV_CSS_INSERT_ATTR,
  DEV_CSS_NAME_ATTR,
  DEV_CSS_OUTPUT_ATTR,
  DEV_CSS_STYLE_ATTR,
} from '../src/internal/dev-css-bridge/protocol';

describe('development CSS bridge', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('installs one set of hidden automation controls', () => {
    const firstControls = installDevCssBridge();
    const secondControls = installDevCssBridge();

    expect(firstControls).toEqual(secondControls);
    expect(document.querySelectorAll(`[${DEV_CSS_INPUT_ATTR}]`)).toHaveLength(1);
    expect(document.querySelectorAll(`[${DEV_CSS_NAME_ATTR}]`)).toHaveLength(1);
    expect(document.querySelectorAll(`[${DEV_CSS_INSERT_ATTR}]`)).toHaveLength(1);
    expect(document.querySelectorAll(`[${DEV_CSS_CLEAR_ATTR}]`)).toHaveLength(1);
    expect(document.querySelectorAll(`[${DEV_CSS_OUTPUT_ATTR}]`)).toHaveLength(1);
    expect(firstControls.input.tabIndex).toBe(-1);
    expect(firstControls.input.style.opacity).toBe('0');
    expect(firstControls.input.style.pointerEvents).toBe('auto');
    expect(firstControls.input.style.left).toBe('1px');
    expect(firstControls.insert.style.left).toBe('3px');
    expect(firstControls.output.style.left).toBe('5px');
    expect(firstControls.name.value).toBe(DEFAULT_DEV_CSS_NAME);
  });

  it('inserts CSS into one named style tag', () => {
    const style = insertDevCss(document, 'body { color: red; }', 'agent');

    expect(style.getAttribute(DEV_CSS_STYLE_ATTR)).toBe('agent');
    expect(style.textContent).toBe('body { color: red; }');
    expect(document.querySelectorAll(`style[${DEV_CSS_STYLE_ATTR}]`)).toHaveLength(1);
  });

  it('updates the same named style tag on repeated insert', () => {
    const firstStyle = insertDevCss(document, 'body { color: red; }', 'agent');
    const secondStyle = insertDevCss(document, 'body { color: blue; }', 'agent');

    expect(secondStyle).toBe(firstStyle);
    expect(document.querySelectorAll(`style[${DEV_CSS_STYLE_ATTR}="agent"]`)).toHaveLength(1);
    expect(secondStyle.textContent).toBe('body { color: blue; }');
  });

  it('allows multiple named CSS styles to coexist', () => {
    insertDevCss(document, 'body { color: red; }', 'agent');
    insertDevCss(document, 'body { background: black; }', 'audit');

    expect(document.querySelectorAll(`style[${DEV_CSS_STYLE_ATTR}]`)).toHaveLength(2);
    expect(document.querySelector(`style[${DEV_CSS_STYLE_ATTR}="agent"]`)?.textContent).toContain(
      'color',
    );
    expect(document.querySelector(`style[${DEV_CSS_STYLE_ATTR}="audit"]`)?.textContent).toContain(
      'background',
    );
  });

  it('clears only the matching named style tag', () => {
    insertDevCss(document, 'body { color: red; }', 'agent');
    insertDevCss(document, 'body { background: black; }', 'audit');

    const removedStyle = clearDevCss(document, 'agent');

    expect(removedStyle?.getAttribute(DEV_CSS_STYLE_ATTR)).toBe('agent');
    expect(document.querySelector(`style[${DEV_CSS_STYLE_ATTR}="agent"]`)).toBeNull();
    expect(document.querySelector(`style[${DEV_CSS_STYLE_ATTR}="audit"]`)).not.toBeNull();
  });

  it('uses the default agent name when a name is empty', () => {
    const style = insertDevCss(document, 'body { color: red; }', '  ');

    expect(style.getAttribute(DEV_CSS_STYLE_ATTR)).toBe(DEFAULT_DEV_CSS_NAME);

    expect(clearDevCss(document, '')).toBe(style);
    expect(document.querySelector(`style[${DEV_CSS_STYLE_ATTR}]`)).toBeNull();
  });

  it('writes JSON status when inserting and clearing through controls', () => {
    const { input, name, insert, clear, output } = installDevCssBridge();

    input.value = 'body { color: red; }';
    name.value = 'agent';
    insert.click();

    expect(JSON.parse(output.textContent ?? '')).toEqual({
      ok: true,
      action: 'insert-css',
      name: 'agent',
      bytes: 20,
    });

    clear.click();

    expect(JSON.parse(output.textContent ?? '')).toEqual({
      ok: true,
      action: 'clear-css',
      name: 'agent',
    });
  });

  it('keeps the CSS bridge entrypoint out of production manifests', () => {
    const productionManifest = createManifest('production');
    const developmentManifest = createManifest('development');

    expect(productionManifest.content_scripts).toHaveLength(1);
    expect(
      productionManifest.content_scripts?.some((script) =>
        script.js?.includes('src/internal/dev-tools/content-entry.ts'),
      ),
    ).toBe(false);
    expect(
      developmentManifest.content_scripts?.some((script) =>
        script.js?.includes('src/internal/dev-tools/content-entry.ts'),
      ),
    ).toBe(true);
  });
});
