import { builtInExtension } from "@t3tools/shared/builtInExtensions";
import { createExtensionHost } from "@t3tools/shared/extensions";

import { EphemeralThreadsWatcher } from "../components/EphemeralThreads";
import { ExtensionLoader } from "../components/ExtensionLoader";
import { APP_INTERFACE_POINT, createAppInterface } from "./AppInterface";
import { createExtensionSlot, type SlotComponents } from "./ExtensionSlot";

interface AppSlots {
  /** Mounted once beside the app shell, for watchers that render nothing themselves. */
  readonly "app.root": object;
  /** A whole interface the user can switch to, drawn in place of the standard app shell. */
  readonly [APP_INTERFACE_POINT]: object;
}

const host = createExtensionHost<SlotComponents<AppSlots>>([
  {
    ...builtInExtension("ephemeral-thread-watcher"),
    contributes: { "app.root": [EphemeralThreadsWatcher] },
  },
  {
    ...builtInExtension("extension-manager"),
    contributes: { "app.root": [ExtensionLoader] },
  },
]);

export const AppSlot = createExtensionSlot(host);
export const AppInterface = createAppInterface(host.list(APP_INTERFACE_POINT), host.extensions);
