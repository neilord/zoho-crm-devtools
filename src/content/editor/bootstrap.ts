import { loadSettings } from '../../settings/storage';
import { applySyntaxEnhancementPreference } from '../../syntax/syntax-highlighting';
import { findEditorRoot } from '../zoho/selectors';
import { applyIndentGuidesPreference } from './indent-guides';
import { installThemeIntegration } from './themes';

export async function bootstrapEditorIntegration(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.enabled) {
    return;
  }

  installThemeIntegration(settings.customThemeId);

  const markEditorReady = () => {
    applyIndentGuidesPreference(settings.indentGuidesEnabled);
    applySyntaxEnhancementPreference(settings.syntaxEnhancementEnabled);

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
