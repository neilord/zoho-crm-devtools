// Entirely invented CRM configuration, preserving only observed wire shapes.
export const context = {
  origin: 'https://crm.zoho.com',
  orgId: '999001',
  csrfHeader: 'crmcsrfparam=synthetic',
};
export const summary = (id = '101') => ({
  id,
  name: `Synthetic orchard ${id}`,
  description: 'Check ripeness',
  module: { api_name: 'Orchards', id: '55' },
  status: { active: true },
  modified_time: '2030-01-01T00:00:00Z',
  execute_when: { type: 'create', details: {} },
});
export const predicate = {
  field: { api_name: 'Fruit', id: '71' },
  comparator: 'equal',
  type: 'value',
  value: 'Pear',
};
export const condition = (actions: unknown[] = []) => ({
  id: '201',
  sequence_number: 1,
  criteria_details: {
    criteria: { group_operator: 'AND', group: [predicate] },
    relational_criteria: {
      module: { api_name: 'Baskets' },
      module_selection: null,
      criteria: predicate,
    },
  },
  instant_actions: { actions },
  scheduled_actions: [{ id: '202', execute_after: { unit: 5, period: 'minutes' }, actions }],
});
export const detail = (id = '101', actions: unknown[] = []) => ({
  ...summary(id),
  category: 'draft',
  deprecated: false,
  execute_when: {
    type: 'field_update',
    details: { repeat: false, match_all: false, criteria: predicate },
  },
  conditions: [condition(actions)],
});
export const binding = { id: '301', name: 'Score orchard', type: 'functions' };
export const functionResource = {
  id: '301',
  name: 'Score orchard',
  module: { api_name: 'Orchards' },
  function: { id: '401', api_name: 'wf_score_orchard' },
  arguments: [{ name: 'orchardId', type: 'value', value: `\${Orchards.Id}` }],
};
export const catalogue = [
  {
    id: '501',
    display_name: 'Score orchard',
    api_name: 'wf_score_orchard',
    category: 'Automation',
    language: 'deluge',
    source: 'crm',
  },
];
export const paid = {
  signedIn: true,
  entitlement: {
    plan: 'future-paid',
    entitled: true,
    status: 'active',
    checkedAt: '2030-01-01',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  },
};
