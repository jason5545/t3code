import { createExtensionHost } from "@t3tools/shared/extensions";

import { EphemeralThreadsWatcher } from "../components/EphemeralThreads";
import { createExtensionSlot, type SlotComponents } from "./ExtensionSlot";

interface AppSlots {
  /** Mounted once beside the app shell, for watchers that render nothing themselves. */
  readonly "app.root": object;
}

export const AppSlot = createExtensionSlot(
  createExtensionHost<SlotComponents<AppSlots>>([
    {
      id: "ephemeral-threads",
      title: "Ephemeral threads",
      patch: 11,
      contributes: { "app.root": [EphemeralThreadsWatcher] },
    },
  ]),
);
