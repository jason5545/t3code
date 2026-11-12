import { createExtensionHost } from "@t3tools/shared/extensions";

import { ownerMachines } from "./ownerMachines.ts";
import type { ServerExtensionPoints } from "./points.ts";

/** The server's fork extensions. Add a feature by listing its extension here. */
export const serverExtensions = createExtensionHost<ServerExtensionPoints>([ownerMachines]);
