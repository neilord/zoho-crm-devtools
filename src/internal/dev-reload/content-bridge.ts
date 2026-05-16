import { DEV_RELOAD_EVENT, DEV_RELOAD_MESSAGE_TYPE } from './protocol';

export interface DevReloadMessenger {
  sendMessage(message: { type: typeof DEV_RELOAD_MESSAGE_TYPE }): Promise<unknown> | undefined;
}

export function installDevReloadBridge(
  target: Pick<Window, 'addEventListener'>,
  messenger: DevReloadMessenger,
): void {
  target.addEventListener(DEV_RELOAD_EVENT, () => {
    void messenger.sendMessage({ type: DEV_RELOAD_MESSAGE_TYPE });
  });
}
