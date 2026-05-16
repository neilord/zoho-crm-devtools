import { handleDevReloadCommand } from './background-handler';

chrome.commands.onCommand.addListener((command) => {
  handleDevReloadCommand(command, chrome.runtime);
});
