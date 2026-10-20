import { afterEach, describe, expect, it, vi } from 'vitest';
import { retryRequest, zohoGet } from '../src/content/zoho/api-client';
import { RequestPool } from '../src/content/zoho/request-pool';

const context = {
  origin: 'https://crm.zoho.com',
  orgId: '999001',
  csrfHeader: 'crmcsrfparam=synthetic',
};

afterEach(() => vi.useRealTimers());
describe('shared Zoho request budget and transport', () => {
  it('bounds requests and removes aborted queued work', async () => {
    const pool = new RequestPool(1),
      abort = new AbortController();
    let release = () => {};
    const first = pool.run(
      new AbortController().signal,
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const work = vi.fn();
    const second = pool.run(abort.signal, work);
    const assertion = expect(second).rejects.toThrow();
    abort.abort();
    await assertion;
    release();
    await first;
    expect(work).not.toHaveBeenCalled();
    expect(await pool.run(new AbortController().signal, async () => 'ok')).toBe('ok');
  });
  it.each([
    '2',
    'Wed, 01 Jan 2031 00:00:02 GMT',
  ])('honors Retry-After %s and retries in place', async (header) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': header } }))
      .mockResolvedValueOnce(Response.json({ done: true }));
    const result = retryRequest(`${context.origin}/crm/test`, {}, f, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1999);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('cancels backoff and never retries 4xx', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const f = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    const result = retryRequest('https://crm.zoho.com/crm/test', {}, f, abort.signal);
    const assertion = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1);
    abort.abort();
    await assertion;
    expect(f).toHaveBeenCalledTimes(1);
    const denied = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
    expect((await retryRequest('url', {}, denied, new AbortController().signal)).status).toBe(403);
    expect(denied).toHaveBeenCalledTimes(1);
  });
  it('rejects cross-origin GETs before transport', async () => {
    const f = vi.fn();
    await expect(
      zohoGet(context, 'https://other.example.invalid/crm/test', f, new AbortController().signal),
    ).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});

it('times out a stalled GET and releases its global slot', async () => {
  // Spy on the timeout signal rather than wall time: Chrome implements the actual timeout.
  const timeout = new AbortController();
  const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
  const f = vi
    .fn()
    .mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () => reject(init.signal.reason)),
        ),
    );
  try {
    const result = zohoGet(
      context,
      '/crm/v8/settings/fields?module=Orchards',
      f,
      new AbortController().signal,
    );
    const assertion = expect(result).rejects.toThrow('Timeout');
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith(15_000);
    timeout.abort(new DOMException('Timeout', 'TimeoutError'));
    await assertion;
    spy.mockRestore();
    expect(
      await zohoGet(
        context,
        '/crm/v8/settings/fields?module=Orchards',
        vi.fn().mockResolvedValue(Response.json({ fields: [] })),
        new AbortController().signal,
      ),
    ).toEqual({ fields: [] });
  } finally {
    spy.mockRestore();
  }
});

it('uses four global slots and retains them until response bodies finish', async () => {
  let active = 0,
    maximum = 0;
  const release: (() => void)[] = [];
  const f = vi.fn().mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            maximum = Math.max(maximum, ++active);
            release.push(() => {
              active--;
              controller.enqueue(new TextEncoder().encode('{"fields":[]}'));
              controller.close();
            });
          },
        }),
      ),
  );
  const work = Promise.all(
    Array.from({ length: 8 }, () =>
      zohoGet(context, '/crm/v8/settings/fields?module=Orchards', f, new AbortController().signal),
    ),
  );
  await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(4));
  for (const finish of release.splice(0)) finish();
  await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(8));
  for (const finish of release.splice(0)) finish();
  await work;
  expect(maximum).toBe(4);
});
