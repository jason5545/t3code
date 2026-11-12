import * as Option from "effect/Option";
import { useEffect } from "react";

import { requestExtensions } from "../extensions/commands";
import { applyExtensionsSnapshot } from "../extensions/runtime";
import { useConnectedEnvironmentIds, usePrimaryEnvironmentId } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";

/** Fork patch 30: asks the primary environment which extensions are on and runs their web parts. */
export function ExtensionLoader() {
  const environmentId = usePrimaryEnvironmentId();
  const connected = useConnectedEnvironmentIds();
  const request = useAtomCommand(requestExtensions, { reportFailure: false });
  const ready = environmentId !== null && connected.includes(environmentId);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads from the server once it connects
  useEffect(() => {
    if (!ready || environmentId === null) return;
    let stale = false;
    void request({ environmentId, request: { action: "read", webModules: true } }).then(
      (result) => {
        if (stale || result._tag !== "Success" || Option.isNone(result.value)) return;
        applyExtensionsSnapshot(result.value.value);
      },
    );
    return () => {
      stale = true;
    };
  }, [ready, environmentId, request]);

  return null;
}
