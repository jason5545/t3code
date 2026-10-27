import { TailnetDiscovery } from "@t3tools/client-runtime/connection";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "./runtime";

/**
 * Fork patch 7: T3 Code servers that connected environments see on their
 * tailnet, asked while an environment list is open. Each ask has every server
 * run `tailscale status` and probe the owner's machines, so the answer is
 * reused for ten minutes after the last list closes.
 */
const TAILNET_SERVERS_REUSE_MS = 10 * 60_000;

export const tailnetServersAtom = connectionAtomRuntime
  .atom(TailnetDiscovery.discoverTailnetServers())
  .pipe(
    Atom.setIdleTTL(TAILNET_SERVERS_REUSE_MS),
    Atom.withLabel("mobile:connection:tailnet-servers"),
  );
