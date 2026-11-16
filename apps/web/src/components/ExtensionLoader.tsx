import * as Option from "effect/Option";
import { useEffect } from "react";

import { requestExtensions } from "../extensions/commands";
import {
  appliedExtensionListKey,
  applyExtensionsSnapshot,
  extensionListKey,
} from "../extensions/runtime";
import { useConnectedEnvironmentIds, usePrimaryEnvironmentId } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";

/**
 * Fork patch 30: asks the primary environment which extensions are on and runs their web parts,
 * and asks again whenever the window comes back, so a change made on another device applies
 * without a reload. The web parts are fetched only when the list changed.
 */
export function ExtensionLoader() {
  const environmentId = usePrimaryEnvironmentId();
  const connected = useConnectedEnvironmentIds();
  const request = useAtomCommand(requestExtensions, { reportFailure: false });
  const ready = environmentId !== null && connected.includes(environmentId);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads from the server once it connects and when the window comes back
  useEffect(() => {
    if (!ready || environmentId === null) return;
    let stale = false;
    const read = async (webModules: boolean) => {
      const result = await request({ environmentId, request: { action: "read", webModules } });
      return stale || result._tag !== "Success" ? Option.none() : result.value;
    };
    const load = async () => {
      const snapshot = await read(true);
      if (Option.isSome(snapshot)) applyExtensionsSnapshot(snapshot.value);
    };
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const list = await read(false);
      if (Option.isSome(list) && extensionListKey(list.value) !== appliedExtensionListKey()) {
        await load();
      }
    };
    void load();
    // Coming back fires both events; one read answers both.
    let refreshing = false;
    const onReturn = () => {
      if (refreshing) return;
      refreshing = true;
      void refresh().finally(() => {
        refreshing = false;
      });
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      stale = true;
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [ready, environmentId, request]);

  return null;
}
