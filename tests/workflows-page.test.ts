import { afterEach, expect, it, vi } from 'vitest';
import {
  findWorkflowSearchButtonAnchor,
  isWorkflowsListLocation,
  observeWorkflowSearchAnchor,
  resolveRelatedFunction,
} from '../src/content/zoho/workflows-page';

vi.mock('../src/content/functions/edit-in-crm', () => ({
  requestEditInCrm: vi.fn().mockResolvedValue(true),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});
it('matches exact list route and outer native search hook only', () => {
  expect(isWorkflowsListLocation({ pathname: '/crm/org999001/settings/workflow-rules' })).toBe(
    true,
  );
  expect(isWorkflowsListLocation({ pathname: '/crm/org999001/settings/workflow-rules/101' })).toBe(
    false,
  );
  document.body.innerHTML =
    '<input placeholder="Search"><list-workflows><lyte-input data-zcqa="wfSearchWithName1"><input></lyte-input></list-workflows>';
  expect(findWorkflowSearchButtonAnchor()?.tagName).toBe('LYTE-INPUT');
});
it('observes delayed toolbar, replacement, departure and return', async () => {
  history.replaceState(null, '', '/crm/org999001/settings/workflow-rules');
  const listener = vi.fn(),
    dispose = observeWorkflowSearchAnchor(listener);
  expect(listener).toHaveBeenLastCalledWith(null);
  document.body.innerHTML =
    '<list-workflows><lyte-input id="wfSearchWithName1"></lyte-input></list-workflows>';
  await vi.waitFor(() =>
    expect(listener).toHaveBeenLastCalledWith(findWorkflowSearchButtonAnchor()),
  );
  const first = findWorkflowSearchButtonAnchor();
  first?.replaceWith(first.cloneNode(true));
  await vi.waitFor(() =>
    expect(listener).toHaveBeenLastCalledWith(findWorkflowSearchButtonAnchor()),
  );
  expect(findWorkflowSearchButtonAnchor()).not.toBe(first);
  history.replaceState(null, '', '/crm/org999001/settings/workflow-rules/101');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(null));
  history.replaceState(null, '', '/crm/org999001/settings/workflow-rules');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await vi.waitFor(() =>
    expect(listener).toHaveBeenLastCalledWith(findWorkflowSearchButtonAnchor()),
  );
  dispose();
});

it('re-resolves the catalogue source enum for a related extension function handoff', async () => {
  history.replaceState(null, '', '/crm/org999001/settings/workflow-rules');
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        functions: [
          {
            id: '501',
            display_name: 'Score orchard',
            api_name: 'orchard__wf_score',
            source: 'extension',
            language: 'deluge',
            category: 'ExtensionAction',
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ functions: [{ id: '501', workflow: 'info "synthetic harvest";' }] }),
    );
  vi.stubGlobal('fetch', f);
  expect(
    await resolveRelatedFunction({
      id: '501',
      display_name: 'Score orchard',
      api_name: 'orchard__wf_score',
      source: 'crm',
      category: '',
    }),
  ).toMatchObject({ id: '501' });
  expect(f.mock.calls[1][0]).toContain('/settings/functions/501?language=deluge&source=extension');
});
it('refuses a stale API-name identity before fetching the native editor detail', async () => {
  history.replaceState(null, '', '/crm/org999001/settings/workflow-rules');
  const f = vi.fn().mockResolvedValue(
    Response.json({
      functions: [{ id: '501', api_name: 'other_function', source: 'extension' }],
    }),
  );
  vi.stubGlobal('fetch', f);
  expect(
    await resolveRelatedFunction({
      id: '501',
      display_name: 'Score orchard',
      api_name: 'orchard__wf_score',
      category: '',
    }),
  ).toBeNull();
  expect(f).toHaveBeenCalledTimes(1);
});
