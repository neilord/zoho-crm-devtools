export const DEV_RELOAD_EVENT = 'zcdt:dev:reload-extension';
export const DEV_RELOAD_MESSAGE_TYPE = 'zcdt.dev.reload-extension';

export interface DevReloadMessage {
  type: typeof DEV_RELOAD_MESSAGE_TYPE;
}

export function isDevReloadMessage(message: unknown): message is DevReloadMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === DEV_RELOAD_MESSAGE_TYPE
  );
}
