import { useAtomValue } from "@effect/atom-react";
import {
  allowsPreviewTunnel,
  type EnvironmentId,
  type PreviewRuntime,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentCatalog } from "~/connection/catalog";
import { isElectron } from "~/env";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import {
  readEnvironmentSupportsServerBrowser,
  useEnvironmentSupportsServerBrowser,
} from "~/state/entities";
import { environmentServerConfigsAtom } from "~/state/server";

import { tunnelsEnvironmentLoopback } from "./browserTargetResolver";

/** Whether this desktop loads the environment's localhost itself: it is local, or its tunnel is on. */
const desktopLoadsLoopbackAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const target = get(environmentCatalog.catalogValueAtom).entries.get(environmentId)?.target;
    if (!tunnelsEnvironmentLoopback(target)) return true;
    const config = get(environmentServerConfigsAtom).get(environmentId);
    return config !== undefined && allowsPreviewTunnel(config);
  }).pipe(Atom.withLabel(`preview:desktop-loads-loopback:${environmentId}`)),
);

export function previewRuntimeFor(environmentId: EnvironmentId): PreviewRuntime | undefined {
  if (!readEnvironmentSupportsServerBrowser(environmentId)) return undefined;
  // Without its tunnel, another environment's tabs stream from it, as on the web.
  if (
    isPreviewSupportedInRuntime() &&
    environmentId !== appAtomRegistry.get(primaryEnvironmentIdAtom) &&
    appAtomRegistry.get(desktopLoadsLoopbackAtom(environmentId))
  ) {
    return undefined;
  }
  return "server";
}

export function alternatePreviewRuntime(
  environmentId: EnvironmentId,
  primaryEnvironmentId: EnvironmentId | null,
  serverBrowser: boolean,
  desktopLoadsLoopback: boolean,
  snapshot: Pick<PreviewSessionSnapshot, "runtime"> | null | undefined,
): PreviewRuntime | null {
  if (!snapshot || !serverBrowser || !isPreviewSupportedInRuntime()) return null;
  if (environmentId === primaryEnvironmentId) return null;
  if (snapshot.runtime === "server") return desktopLoadsLoopback ? "desktop" : null;
  return "server";
}

export function useDesktopLoadsLoopback(environmentId: EnvironmentId): boolean {
  return useAtomValue(desktopLoadsLoopbackAtom(environmentId));
}

export function isPreviewAvailableFor(environmentId: EnvironmentId): boolean {
  return isPreviewSupportedInRuntime() || readEnvironmentSupportsServerBrowser(environmentId);
}

export function usePreviewAvailable(environmentId: EnvironmentId | null): boolean {
  const serverBrowser = useEnvironmentSupportsServerBrowser(environmentId);
  return isPreviewSupportedInRuntime() || serverBrowser;
}

type RuntimeSnapshot = Pick<PreviewSessionSnapshot, "runtime" | "headless" | "automationOwner">;

/** The desktop app hosts this server tab, in a panel `<webview>` or a background window. */
function desktopHostsServerTab(
  environmentId: EnvironmentId,
  primaryEnvironmentId: EnvironmentId | null,
  snapshot: RuntimeSnapshot | null | undefined,
): boolean {
  return (
    isElectron &&
    snapshot?.runtime === "server" &&
    !snapshot.headless &&
    primaryEnvironmentId !== null &&
    environmentId === primaryEnvironmentId
  );
}

export function rendersServerTabNatively(
  environmentId: EnvironmentId,
  primaryEnvironmentId: EnvironmentId | null,
  snapshot: RuntimeSnapshot | null | undefined,
): boolean {
  return (
    desktopHostsServerTab(environmentId, primaryEnvironmentId, snapshot) &&
    snapshot?.automationOwner === undefined
  );
}

/**
 * Agent tabs run in a never-shown desktop window, because a panel `<webview>`
 * created while the app is hidden never paints and agents open tabs whenever
 * they like. The panel streams them like any other server tab.
 */
export function hostsServerTabInBackground(
  environmentId: EnvironmentId,
  primaryEnvironmentId: EnvironmentId | null,
  snapshot: RuntimeSnapshot | null | undefined,
): boolean {
  return (
    desktopHostsServerTab(environmentId, primaryEnvironmentId, snapshot) &&
    snapshot?.automationOwner !== undefined
  );
}

export function useRendersServerTabNatively(
  environmentId: EnvironmentId,
  snapshot: RuntimeSnapshot | null | undefined,
): boolean {
  return rendersServerTabNatively(environmentId, useAtomValue(primaryEnvironmentIdAtom), snapshot);
}
