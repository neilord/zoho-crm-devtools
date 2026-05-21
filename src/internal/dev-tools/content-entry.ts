import { installDevCssBridge } from '../dev-css-bridge/control';
import { installDevReloadControl } from '../dev-reload/control';

installDevReloadControl(document, chrome.runtime);
installDevCssBridge(document);
