import { builtInExtension } from "@t3tools/shared/builtInExtensions";
import { createExtensionHost } from "@t3tools/shared/extensions";

import {
  TailnetServerHomeRows,
  TailnetServerSuggestions,
} from "../features/connection/TailnetServerSection";
import { createExtensionSlot, type SlotComponents } from "./ExtensionSlot";

interface EnvironmentSlots {
  /** Home, above the thread list and inside both of its empty states. */
  readonly "home.environments": object;
  /** Above the saved environments, in Connections and in Settings → Environments. */
  readonly "environments.suggestions": object;
}

export const EnvironmentSlot = createExtensionSlot(
  createExtensionHost<SlotComponents<EnvironmentSlots>>([
    {
      ...builtInExtension("tailnet-suggestions"),
      contributes: {
        "home.environments": [TailnetServerHomeRows],
        "environments.suggestions": [TailnetServerSuggestions],
      },
    },
  ]),
);
