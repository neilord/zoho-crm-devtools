import '../../background/worker';
import { isOwnSender } from '../../shared/browser';
import { handleDevReloadMessage } from './background-handler';

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!isOwnSender(sender)) return false;
  handleDevReloadMessage(message, chrome.runtime);
});
