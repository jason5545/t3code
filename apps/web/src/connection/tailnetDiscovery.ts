import { TailnetDiscovery } from "@t3tools/client-runtime/connection";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "./runtime";

/**
 * Fork patch 7: T3 Code servers that connected environments see on their
 * tailnet. Read while the add-environment dialog is open, so reopening it
 * asks again.
 */
export const tailnetServersAtom = connectionAtomRuntime
  .atom(TailnetDiscovery.discoverTailnetServers())
  .pipe(Atom.withLabel("web:connection:tailnet-servers"));
