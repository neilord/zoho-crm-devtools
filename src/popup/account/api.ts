import { billingMessage } from '../../shared/browser';

export const account = {
  getEntitlement: async () => {
    const state = await billingMessage('billing:getEntitlement');
    return state.signedOutPending ? billingMessage('billing:getEntitlement') : state;
  },
  signIn: () => billingMessage('billing:signIn'),
  signOut: () => billingMessage('billing:signOut'),
  openUpgrade: () => billingMessage('billing:openUpgrade'),
  openAccount: () => billingMessage('billing:openAccount'),
  getNotice: () => billingMessage('billing:getNotice'),
  dismissNotice: () => billingMessage('billing:dismissNotice'),
};
