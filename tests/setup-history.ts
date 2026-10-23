/**
 * Closing the Automation Map from the UI pops its history entry with `history.back()`, which
 * jsdom (like a browser) performs a task later. Without this the traversal would land in the
 * next test and pop the entry that test just pushed.
 */
import { afterEach } from 'vitest';

afterEach(async () => {
  await new Promise<void>((resolve) => {
    // Real timers: a test that faked them has already restored them in its own hook.
    setTimeout(resolve, 0);
  });
});
