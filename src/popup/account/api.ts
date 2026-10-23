import { billingMessage } from '../../shared/browser';

export const account = {
  getEntitlement: async () => {
    const state = await billingMessage('billing:getEntitlement');
    return state.signedOutPending ? billingMessage('billing:getEntitlement') : state;
  },
  signIn: () => billingMessage('billing:signIn'),
  signUp: () => billingMessage('billing:signUp'),
  signOut: () => billingMessage('billing:signOut'),
  openUpgrade: () => billingMessage('billing:openUpgrade'),
  openAccount: () => billingMessage('billing:openAccount'),
  openBilling: () => billingMessage('billing:openBilling'),
  openCheckout: (plan: string) => billingMessage('billing:openCheckout', { plan }),
  getNotice: () => billingMessage('billing:getNotice'),
  dismissNotice: () => billingMessage('billing:dismissNotice'),
};
