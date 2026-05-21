export const DEV_CSS_INPUT_ATTR = 'data-zcdt-dev-css-input';
export const DEV_CSS_NAME_ATTR = 'data-zcdt-dev-css-name';
export const DEV_CSS_INSERT_ATTR = 'data-zcdt-dev-insert-css';
export const DEV_CSS_CLEAR_ATTR = 'data-zcdt-dev-clear-css';
export const DEV_CSS_OUTPUT_ATTR = 'data-zcdt-dev-output';
export const DEV_CSS_STYLE_ATTR = 'data-zcdt-dev-css-style';
export const DEFAULT_DEV_CSS_NAME = 'agent';

export type DevCssAction = 'insert-css' | 'clear-css';

export interface DevCssStatus {
  ok: true;
  action: DevCssAction;
  name: string;
  bytes?: number;
}
