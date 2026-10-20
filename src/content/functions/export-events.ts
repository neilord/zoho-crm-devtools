/** DOM event names shared by the export control and the upgrade modal (no import cycle). */
export const EXPORT_REQUEST_EVENT = 'functions:exportRequested';
export const EXPORT_STATE_EVENT = 'functions:exportState';
/** Dispatched on the export root after sign-in/upgrade changes the account, so the PRO badge refreshes. */
export const ACCOUNT_CHANGED_EVENT = 'billing:accountChanged';
