import { styleHiddenDevControl } from '../dev-controls';
import {
  DEV_RELOAD_CONTROL_ATTR,
  DEV_RELOAD_MESSAGE_TYPE,
  type DevReloadMessage,
} from './protocol';

export interface DevReloadMessenger {
  sendMessage(message: DevReloadMessage): Promise<unknown> | undefined;
}

export function installDevReloadControl(
  root: Pick<Document, 'documentElement' | 'createElement' | 'querySelector'>,
  messenger: DevReloadMessenger,
): HTMLButtonElement {
  const existing = root.querySelector<HTMLButtonElement>(`[${DEV_RELOAD_CONTROL_ATTR}]`);
  if (existing) {
    return existing;
  }

  const control = root.createElement('button');
  control.type = 'button';
  control.tabIndex = -1;
  control.setAttribute(DEV_RELOAD_CONTROL_ATTR, 'true');
  control.setAttribute('aria-hidden', 'true');
  styleHiddenDevControl(control);
  control.addEventListener('click', () => {
    void messenger.sendMessage({ type: DEV_RELOAD_MESSAGE_TYPE });
  });
  root.documentElement.append(control);
  return control;
}
