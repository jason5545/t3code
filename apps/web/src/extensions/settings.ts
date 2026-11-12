import { builtInExtension } from "@t3tools/shared/builtInExtensions";
import { createExtensionHost } from "@t3tools/shared/extensions";

import { ExtensionsSettings } from "../components/settings/ExtensionsSettings";
import { LanguageSettings } from "../components/settings/LanguageSettings";
import { TailnetServerSuggestions } from "../components/settings/TailnetServerSuggestions";
import { createExtensionSlot, type SlotComponents } from "./ExtensionSlot";

export interface SettingsSlots {
  /** Top of Settings → General. */
  readonly "settings.general": object;
  /** Top of Settings → Appearance. */
  readonly "settings.appearance": object;
  /** Top of Settings → Maintenance. */
  readonly "settings.maintenance": object;
  /** The Add environment dialog, above its address fields. */
  readonly "addEnvironment.suggestions": {
    readonly disabled: boolean;
    readonly onAdd: (httpBaseUrl: string) => void;
  };
}

export const SettingsSlot = createExtensionSlot(
  createExtensionHost<SlotComponents<SettingsSlots>>([
    {
      ...builtInExtension("language-selector"),
      contributes: {
        "settings.general": [LanguageSettings],
        "settings.appearance": [LanguageSettings],
      },
    },
    {
      ...builtInExtension("tailnet-suggestions"),
      contributes: { "addEnvironment.suggestions": [TailnetServerSuggestions] },
    },
    {
      ...builtInExtension("extension-manager"),
      contributes: { "settings.maintenance": [ExtensionsSettings] },
    },
  ]),
);
