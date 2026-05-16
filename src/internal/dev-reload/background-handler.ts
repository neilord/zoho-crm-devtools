import { isDevReloadMessage } from './protocol';

export interface DevReloadRuntime {
  reload(): void;
}

export function handleDevReloadMessage(message: unknown, runtime: DevReloadRuntime): boolean {
  if (!isDevReloadMessage(message)) {
    return false;
  }

  runtime.reload();
  return true;
}
