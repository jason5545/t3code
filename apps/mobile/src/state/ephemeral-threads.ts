import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { isEphemeralThreadShell } from "@t3tools/contracts";
import { useEffect } from "react";

import { appAtomRegistry } from "./atom-registry";
import { trackEphemeralThreadKeys } from "./ephemeral-thread-keys";
import { environmentThreadShells } from "./threads";

const track = (shells: ReadonlyArray<EnvironmentThreadShell>) =>
  trackEphemeralThreadKeys(
    new Set(
      shells
        .filter((shell) => isEphemeralThreadShell(shell) && shell.deletedAt === null)
        .map((shell) => scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id))),
    ),
  );

/** Fork patch 11: keeps the storage modules' view of ephemeral threads current. */
export function useEphemeralThreadTracking(): void {
  // oxlint-disable-next-line t3code/react-effect-budget -- subscribes storage modules outside React to the shell atom.
  useEffect(() => {
    track(appAtomRegistry.get(environmentThreadShells.threadShellsAtom));
    return appAtomRegistry.subscribe(environmentThreadShells.threadShellsAtom, track);
  }, []);
}
