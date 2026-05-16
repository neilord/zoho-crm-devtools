import {
  DEV_RELOAD_CONTROL_ATTR,
  DEV_RELOAD_MESSAGE_TYPE,
  type DevReloadMessage,
} from './protocol';

export interface DevReloadMessenger {
  sendMessage(message: DevReloadMessage): Promise<unknown> | undefined;
}

function styleControl(control: HTMLButtonElement): void {
  Object.assign(control.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    padding: '0',
    border: '0',
    opacity: '0',
    pointerEvents: 'auto',
    zIndex: '2147483647',
  });
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
  styleControl(control);
  control.addEventListener('click', () => {
    void messenger.sendMessage({ type: DEV_RELOAD_MESSAGE_TYPE });
  });
  root.documentElement.append(control);
  return control;
}
