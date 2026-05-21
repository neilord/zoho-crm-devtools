import { styleHiddenDevControl } from '../dev-controls';
import {
  DEFAULT_DEV_CSS_NAME,
  DEV_CSS_CLEAR_ATTR,
  DEV_CSS_INPUT_ATTR,
  DEV_CSS_INSERT_ATTR,
  DEV_CSS_NAME_ATTR,
  DEV_CSS_OUTPUT_ATTR,
  DEV_CSS_STYLE_ATTR,
  type DevCssStatus,
} from './protocol';

interface DevCssBridgeRoot {
  createElement<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K];
  documentElement: HTMLElement;
  querySelector<E extends Element = Element>(selectors: string): E | null;
  querySelectorAll<E extends Element = Element>(selectors: string): NodeListOf<E>;
}

export interface DevCssBridgeControls {
  input: HTMLTextAreaElement;
  name: HTMLInputElement;
  insert: HTMLButtonElement;
  clear: HTMLButtonElement;
  output: HTMLOutputElement;
}

function normalizeName(name: string): string {
  return name.trim() || DEFAULT_DEV_CSS_NAME;
}

function writeStatus(output: Element, status: DevCssStatus): void {
  output.textContent = JSON.stringify(status);
}

function findStyleByName(root: Pick<DevCssBridgeRoot, 'querySelectorAll'>, name: string) {
  for (const style of root.querySelectorAll<HTMLStyleElement>(`style[${DEV_CSS_STYLE_ATTR}]`)) {
    if (style.getAttribute(DEV_CSS_STYLE_ATTR) === name) {
      return style;
    }
  }

  return null;
}

function createHiddenControl<K extends keyof HTMLElementTagNameMap>(
  root: Pick<DevCssBridgeRoot, 'createElement'>,
  tagName: K,
  attr: string,
  offsetPx: number,
): HTMLElementTagNameMap[K] {
  const control = root.createElement(tagName);
  control.tabIndex = -1;
  control.setAttribute(attr, 'true');
  control.setAttribute('aria-hidden', 'true');
  styleHiddenDevControl(control, { offsetPx });
  return control;
}

export function insertDevCss(
  root: Pick<DevCssBridgeRoot, 'createElement' | 'documentElement' | 'querySelectorAll'>,
  css: string,
  name: string,
): HTMLStyleElement {
  const normalizedName = normalizeName(name);
  const existing = findStyleByName(root, normalizedName);
  const style = existing ?? root.createElement('style');

  if (!existing) {
    style.setAttribute(DEV_CSS_STYLE_ATTR, normalizedName);
    root.documentElement.append(style);
  }

  style.textContent = css;
  return style;
}

export function clearDevCss(
  root: Pick<DevCssBridgeRoot, 'querySelectorAll'>,
  name: string,
): HTMLStyleElement | null {
  const style = findStyleByName(root, normalizeName(name));
  style?.remove();
  return style;
}

export function installDevCssBridge(root: DevCssBridgeRoot = document): DevCssBridgeControls {
  const existingInput = root.querySelector<HTMLTextAreaElement>(`[${DEV_CSS_INPUT_ATTR}]`);
  const existingName = root.querySelector<HTMLInputElement>(`[${DEV_CSS_NAME_ATTR}]`);
  const existingInsert = root.querySelector<HTMLButtonElement>(`[${DEV_CSS_INSERT_ATTR}]`);
  const existingClear = root.querySelector<HTMLButtonElement>(`[${DEV_CSS_CLEAR_ATTR}]`);
  const existingOutput = root.querySelector<HTMLOutputElement>(`[${DEV_CSS_OUTPUT_ATTR}]`);

  if (existingInput && existingName && existingInsert && existingClear && existingOutput) {
    return {
      input: existingInput,
      name: existingName,
      insert: existingInsert,
      clear: existingClear,
      output: existingOutput,
    };
  }

  const input = createHiddenControl(root, 'textarea', DEV_CSS_INPUT_ATTR, 1);
  const name = createHiddenControl(root, 'input', DEV_CSS_NAME_ATTR, 2);
  const insert = createHiddenControl(root, 'button', DEV_CSS_INSERT_ATTR, 3);
  const clear = createHiddenControl(root, 'button', DEV_CSS_CLEAR_ATTR, 4);
  const output = createHiddenControl(root, 'output', DEV_CSS_OUTPUT_ATTR, 5);

  name.value = DEFAULT_DEV_CSS_NAME;
  insert.type = 'button';
  clear.type = 'button';

  insert.addEventListener('click', () => {
    const style = insertDevCss(root, input.value, name.value);
    writeStatus(output, {
      ok: true,
      action: 'insert-css',
      name: style.getAttribute(DEV_CSS_STYLE_ATTR) ?? DEFAULT_DEV_CSS_NAME,
      bytes: input.value.length,
    });
  });

  clear.addEventListener('click', () => {
    const normalizedName = normalizeName(name.value);
    clearDevCss(root, normalizedName);
    writeStatus(output, {
      ok: true,
      action: 'clear-css',
      name: normalizedName,
    });
  });

  root.documentElement.append(input, name, insert, clear, output);

  return { input, name, insert, clear, output };
}
