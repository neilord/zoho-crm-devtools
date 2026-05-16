import { DEV_RELOAD_COMMAND } from './protocol';

export interface DevReloadRuntime {
  reload(): void;
}

export function handleDevReloadCommand(command: string, runtime: DevReloadRuntime): boolean {
  if (command !== DEV_RELOAD_COMMAND) {
    return false;
  }

  runtime.reload();
  return true;
}
