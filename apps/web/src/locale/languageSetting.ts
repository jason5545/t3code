import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import {
  getClientSettings,
  getClientSettingsHydratedSnapshot,
  subscribeClientSettings,
  subscribeClientSettingsHydration,
  updateClientSettings,
} from "../hooks/useSettings";
import { startupLocale } from "./autoTranslateRuntime";
import {
  browserLocaleStorage,
  LOCALE_MIGRATED_KEY,
  LOCALE_STORAGE_KEY,
  migratedLanguage,
  persistLocalePreference,
  translatedLocale,
} from "./locale";

/**
 * Fork patch 2: the build-time translations follow upstream's Language setting. They are
 * chosen once per page load from a copy of the setting's locale in `localStorage`, because
 * client settings load after the first modules run; when the setting resolves to another
 * locale than the page started in, the copy is updated and the page reloads.
 */
export function followLanguageSetting(reload: () => void = () => window.location.reload()) {
  const storage = browserLocaleStorage();
  const follow = () => {
    if (!getClientSettingsHydratedSnapshot()) return;
    const { language } = getClientSettings();
    try {
      // Once per device: the choice made in the fork's earlier selector becomes the setting.
      if (storage && storage.getItem(LOCALE_MIGRATED_KEY) === null) {
        const migrated = migratedLanguage(
          storage.getItem(LOCALE_STORAGE_KEY),
          navigator.languages?.[0] || navigator.language,
        );
        storage.setItem(LOCALE_MIGRATED_KEY, "1");
        if (migrated !== null && language === DEFAULT_UNIFIED_SETTINGS.language) {
          // The settings listener runs `follow` again once this lands.
          void updateClientSettings({ language: migrated });
          return;
        }
      }
    } catch {
      // Storage is blocked; the setting still decides gt-react's strings.
    }
    const locale = translatedLocale(language, navigator.languages);
    if (persistLocalePreference(locale, storage) && locale !== startupLocale) reload();
  };
  subscribeClientSettings(follow);
  subscribeClientSettingsHydration(follow);
  follow();
}
