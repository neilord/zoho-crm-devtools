import { describe, expect, it, vi } from 'vitest';
import { WorkflowApi } from '../src/content/workflows/api';
import { context, summary } from './fixtures/workflows';

describe('workflow API', () => {
  it('pages by more_records, emits metadata, deduplicates ids and uses observed headers', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ workflow_rules: [summary()], info: { more_records: true } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          workflow_rules: [summary(), summary('102')],
          info: { more_records: false },
        }),
      );
    const pages: unknown[][] = [];
    expect(
      await new WorkflowApi(context, f, new AbortController().signal).list((r) => pages.push(r)),
    ).toHaveLength(2);
    expect(pages.map((p) => p.length)).toEqual([1, 2]);
    expect(f.mock.calls[1][0]).toContain('page=2&per_page=200');
    expect(f.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      credentials: 'include',
      redirect: 'error',
      headers: { 'X-Crm-Org': context.orgId, 'X-Zcsrf-Token': context.csrfHeader },
    });
  });
  it('fails repeated pages instead of claiming completeness', async () => {
    const f = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ workflow_rules: [summary()], info: { more_records: true } }),
        ),
      );
    await expect(
      new WorkflowApi(context, f, new AbortController().signal).list(() => {}),
    ).rejects.toThrow('no progress');
    expect(f).toHaveBeenCalledTimes(2);
  });
  it.each([{}, { workflow_rules: [{ id: '..' }] }])('rejects malformed list %j', async (value) => {
    await expect(
      new WorkflowApi(
        context,
        vi.fn().mockResolvedValue(Response.json(value)),
        new AbortController().signal,
      ).list(() => {}),
    ).rejects.toThrow();
  });
  it('validates resource identity and fixed paths', async () => {
    const f = vi.fn().mockResolvedValue(Response.json({ functions: [{ id: '302' }] }));
    const api = new WorkflowApi(context, f, new AbortController().signal);
    await expect(api.resource('functions', '301')).rejects.toThrow('Invalid workflow detail');
    expect(f.mock.calls[0][0]).toBe(`${context.origin}/crm/v8/settings/automation/functions/301`);
    expect(() => api.rule('../')).toThrow();
  });
});

it('treats a bodyless 204 as an empty final list page', async () => {
  const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  const onPage = vi.fn();
  expect(await new WorkflowApi(context, f, new AbortController().signal).list(onPage)).toEqual([]);
  expect(onPage).toHaveBeenCalledWith([]);
});
