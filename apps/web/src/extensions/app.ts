import { builtInExtension } from "@t3tools/shared/builtInExtensions";
import { createExtensionHost } from "@t3tools/shared/extensions";

import { EphemeralThreadsWatcher } from "../components/EphemeralThreads";
import { ExtensionLoader } from "../components/ExtensionLoader";
import { createExtensionSlot, type SlotComponents } from "./ExtensionSlot";

interface AppSlots {
  /** Mounted once beside the app shell, for watchers that render nothing themselves. */
  readonly "app.root": object;
}

export const AppSlot = createExtensionSlot(
  createExtensionHost<SlotComponents<AppSlots>>([
    {
      ...builtInExtension("ephemeral-thread-watcher"),
      contributes: { "app.root": [EphemeralThreadsWatcher] },
    },
    {
      ...builtInExtension("extension-manager"),
      contributes: { "app.root": [ExtensionLoader] },
    },
  ]),
);
