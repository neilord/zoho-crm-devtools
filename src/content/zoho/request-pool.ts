/** A single shared tab budget. Queued cancellation never consumes a slot. */
export class RequestPool {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly limit = 4) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid request budget');
  }
  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        this.queue = this.queue.filter((item) => item !== start);
        reject(signal.reason);
      };
      const start = () => {
        signal.removeEventListener('abort', abort);
        this.active++;
        resolve();
      };
      if (this.active < this.limit) start();
      else {
        this.queue.push(start);
        signal.addEventListener('abort', abort, { once: true });
      }
    });
    try {
      signal.throwIfAborted();
      return await work();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
export const zohoRequestPool = new RequestPool();
