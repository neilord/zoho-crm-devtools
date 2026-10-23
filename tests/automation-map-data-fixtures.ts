import { FREE } from '../src/billing/entitlement';
import type { AutomationGraph, AutomationGraphInputs } from '../src/content/automation-map/types';
export const context = {
  origin: 'https://crm.zoho.com',
  orgId: '123',
  csrfHeader: 'crmcsrfparam=synthetic',
};
export const account = (plan = 'pro') => ({
  signedIn: true,
  entitlement: { ...FREE, plan, entitled: plan !== 'free' },
});
export const rule = (id = '101', module = 'Orchards') => ({
  id,
  name: `Synthetic rule ${id}`,
  status: { active: true },
  module: { api_name: module },
  modified_time: 'r1',
});
export const catalogue = (id = '501', module = 'Orchard gardens') => ({
  id,
  display_name: `Synthetic function ${id}`,
  api_name: `fn_${id}`,
  category: 'automation',
  language: 'deluge',
  source: 'crm',
  updatedTime: 'revision-1',
  associated_place: [{ _type: 'workflow_rules', id: '101', module }],
  rest_api: [{ type: 'oauth', active: true }],
  tasks: { integrations: [{ service: 'ZohoCRM', function: 'zoho.crm.updateRecord' }] },
});
export const moduleWire = (
  api = 'Orchards',
  label = 'Orchard garden',
  plural = 'Orchard gardens',
) => ({
  id: api === 'Orchards' ? '1' : '2',
  api_name: api,
  singular_label: label,
  plural_label: plural,
});
export const graph = (_inputs: AutomationGraphInputs): AutomationGraph => ({
  nodes: new Map(),
  edges: [],
  outgoing: new Map(),
  incoming: new Map(),
  modules: [],
});
export function syntheticFetch(
  overrides: (url: URL) => Response | Promise<Response> | undefined = () => undefined,
): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    const overridden = overrides(url);
    if (overridden) return overridden;
    const path = url.pathname;
    if (path === '/crm/v2/settings/functions') return Response.json({ functions: [catalogue()] });
    if (path.startsWith('/crm/v2/settings/functions/'))
      return Response.json({
        functions: [
          {
            id: path.split('/').at(-1),
            script:
              'm = Map(); m.put("Harvest", "ready"); zoho.crm.updateRecord("Orchards", 1, m);',
          },
        ],
      });
    if (path.endsWith('/workflow_rules'))
      return Response.json({
        workflow_rules: [rule(), rule('102')],
        info: { more_records: false },
      });
    if (path.includes('/workflow_rules/'))
      return Response.json({
        workflow_rules: [
          {
            ...rule(path.split('/').at(-1)),
            conditions: [{ instant_actions: { actions: [{ id: '301', type: 'functions' }] } }],
          },
        ],
      });
    if (path.endsWith('/automation/functions/301'))
      return Response.json({ functions: [{ id: '301', function: { api_name: 'fn_501' } }] });
    if (path.endsWith('/modules')) return Response.json({ modules: [moduleWire()] });
    if (path.endsWith('/fields'))
      return Response.json({
        fields: [{ id: '71', api_name: 'Harvest', field_label: 'Harvest status' }],
      });
    if (path.endsWith('/custom_buttons')) return new Response(null, { status: 204 });
    if (
      path.endsWith('/schedules') ||
      path.endsWith('/blueprints') ||
      path.endsWith('/approval_process')
    )
      return new Response(null, { status: 204 });
    throw new Error(`Unexpected synthetic endpoint: ${path}`);
  };
}
