/**
 * Fork patch 11: ephemeral threads in the web client. Their drafts stay in
 * memory, the window title marks one in the foreground without naming it, and
 * a purge (delete, an idle hour, its OMP process gone) is announced and left.
 */
import { isEphemeralThreadShell } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { type DraftId, setEphemeralThreadKeys, useComposerDraftStore } from "../composerDraftStore";
import { useThreadShell, useThreadShells } from "../state/entities";
import { resolveThreadRouteRef } from "../threadRoutes";
import { stackedThreadToast, toastManager } from "./ui/toast";

/** True while the route shows an ephemeral thread, or a new-thread draft set to launch one. */
export function useEphemeralForeground(): boolean {
  const params = useRouterState({ select: (state) => state.matches.at(-1)?.params });
  const threadRef = resolveThreadRouteRef(params ?? {});
  const shell = useThreadShell(threadRef);
  const draftId = (params as { readonly draftId?: string } | undefined)?.draftId;
  const draftEphemeral = useComposerDraftStore(
    (store) =>
      draftId !== undefined && store.getDraftSession(draftId as DraftId)?.ephemeral === true,
  );
  return isEphemeralThreadShell(shell) || draftEphemeral;
}

export function EphemeralThreadsWatcher() {
  const router = useRouter();
  const shells = useThreadShells();
  const ephemeralKeys = new Set(
    shells
      .filter((shell) => isEphemeralThreadShell(shell) && shell.deletedAt === null)
      .map((shell) => scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id))),
  );
  const previousKeys = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setEphemeralThreadKeys(ephemeralKeys);
    const endedKeys = [...previousKeys.current].filter((key) => !ephemeralKeys.has(key));
    previousKeys.current = ephemeralKeys;
    if (endedKeys.length === 0) return;
    toastManager.add(stackedThreadToast({ type: "info", title: "Conversation ended and erased" }));
    const current = resolveThreadRouteRef(router.state.matches.at(-1)?.params ?? {});
    if (current !== null && endedKeys.includes(scopedThreadKey(current))) {
      void router.navigate({ to: "/", replace: true });
    }
  }, [ephemeralKeys, router]);

  return null;
}
