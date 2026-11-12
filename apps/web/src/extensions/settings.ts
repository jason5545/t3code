import { createExtensionHost } from "@t3tools/shared/extensions";

import { LanguageSettings } from "../components/settings/LanguageSettings";
import { TailnetServerSuggestions } from "../components/settings/TailnetServerSuggestions";
import { createExtensionSlot, type SlotComponents } from "./ExtensionSlot";

export interface SettingsSlots {
  /** Top of Settings → General. */
  readonly "settings.general": object;
  /** Top of Settings → Appearance. */
  readonly "settings.appearance": object;
  /** The Add environment dialog, above its address fields. */
  readonly "addEnvironment.suggestions": {
    readonly disabled: boolean;
    readonly onAdd: (httpBaseUrl: string) => void;
  };
}

export const SettingsSlot = createExtensionSlot(
  createExtensionHost<SlotComponents<SettingsSlots>>([
    {
      id: "zh-tw-interface",
      title: "Taiwan Traditional Chinese interface",
      patch: 2,
      contributes: {
        "settings.general": [LanguageSettings],
        "settings.appearance": [LanguageSettings],
      },
    },
    {
      id: "tailscale-pairing",
      title: "Tailscale pairing and tailnet discovery",
      patch: 7,
      contributes: { "addEnvironment.suggestions": [TailnetServerSuggestions] },
    },
  ]),
);
