import { loadSettings } from '../../settings/storage';
import { findEditorRoot } from '../zoho/selectors';

export async function bootstrapEditorIntegration(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.enabled) {
    return;
  }

  if (!findEditorRoot()) {
    return;
  }

  document.documentElement.dataset.zcdtReady = 'true';
}
