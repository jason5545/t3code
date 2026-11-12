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
      id: "tailscale-pairing",
      title: "Tailscale pairing and tailnet discovery",
      patch: 7,
      contributes: {
        "home.environments": [TailnetServerHomeRows],
        "environments.suggestions": [TailnetServerSuggestions],
      },
    },
  ]),
);
