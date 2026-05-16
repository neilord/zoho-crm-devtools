import { handleDevReloadMessage } from './background-handler';

chrome.runtime.onMessage.addListener((message) => {
  handleDevReloadMessage(message, chrome.runtime);
});
