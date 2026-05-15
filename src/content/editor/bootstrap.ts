import { loadSettings } from '../../settings/storage';
import { findEditorRoot } from '../zoho/selectors';

export async function bootstrapEditorIntegration(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.enabled) {
    return;
  }

  const markEditorReady = () => {
    if (findEditorRoot()) {
      document.documentElement.dataset.zcdtReady = 'true';
    }
  };

  markEditorReady();

  const observer = new MutationObserver(markEditorReady);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
