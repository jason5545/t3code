import { ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpClient from "effect/http/HttpClient";

import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makeProviderMaintenanceCapabilities,
  type ProviderMaintenanceCapabilities,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";

import type { AcpRegistrySettings } from "../settings.ts";

/*
 * Fork patch 3: a local ACP command (`source: "local"`) has no registry entry, so its
 * version is the one it reports in ACP `initialize`, and two hidden settings opt it
 * into the update flow: `npmPackageName` to look up npm `latest`, and `updateCommand`.
 */

const DRIVER_KIND = ProviderDriverKind.make("acpRegistry");

/**
 * Registry agents carry their version in the registry and have no installer
 * of their own here, so only a local command can declare where its latest
 * version is published and how it updates itself.
 */
export function acpRegistryMaintenanceCapabilities(input: {
  readonly instanceId: ProviderInstance["instanceId"];
  readonly settings: AcpRegistrySettings;
  readonly environment?: NodeJS.ProcessEnv;
}): ProviderMaintenanceCapabilities | null {
  if (input.settings.source !== "local") return null;
  const packageName = input.settings.npmPackageName || null;
  const [updateExecutable, ...updateArgs] = input.settings.updateCommand;
  const executable = updateExecutable?.trim() || null;
  if (packageName === null && executable === null) return null;
  return makeProviderMaintenanceCapabilities({
    provider: DRIVER_KIND,
    packageName,
    updateExecutable: executable,
    updateArgs,
    updateLockKey: executable === null ? null : `local:${input.instanceId}`,
    ...(input.environment ? { env: input.environment } : {}),
  });
}

/** What a local command reports in ACP `initialize`, the only version it has. */
export const localCommandVersion = (input: {
  readonly settings: AcpRegistrySettings;
  readonly probe?: { readonly agentVersion?: string } | undefined;
}): string | undefined =>
  input.settings.source === "local" ? input.probe?.agentVersion || undefined : undefined;

export const make = Effect.fn("AcpLocalCommandUpdates.make")(function* (input: {
  readonly instanceId: ProviderInstance["instanceId"];
  readonly settings: AcpRegistrySettings;
  readonly environment: NodeJS.ProcessEnv;
  /** The last provider the background probe cached, if any. */
  readonly probedProvider: Effect.Effect<ServerProvider | undefined>;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  const latestVersions = yield* ProviderLatestVersions.ProviderLatestVersions;
  const maintenance = acpRegistryMaintenanceCapabilities(input);

  /**
   * A local command's version comes only from the background probe. The readiness
   * check repeats the probed one so a health refresh neither blanks it nor misses
   * the probe cache; invalidating the probe cache clears both.
   */
  const withProbedVersion = (provider: ServerProvider) =>
    input.settings.source !== "local" || !provider.installed || provider.version !== null
      ? Effect.succeed(provider)
      : input.probedProvider.pipe(
          Effect.map((probed) =>
            probed?.version ? { ...provider, version: probed.version } : provider,
          ),
        );

  /**
   * Adds the npm version advisory to a background probe's result. It runs before the
   * snapshot permit is taken, so the lookup never holds up live command and
   * configuration updates.
   */
  const adviseProbe =
    (enableProviderUpdateChecks: boolean) =>
    <A extends { readonly provider: ServerProvider }>(probe: Option.Option<A>) =>
      maintenance === null || Option.isNone(probe)
        ? Effect.succeed(probe)
        : enrichProviderSnapshotWithVersionAdvisory(probe.value.provider, maintenance, {
            enableProviderUpdateChecks,
          }).pipe(
            Effect.map((provider) => Option.some({ ...probe.value, provider })),
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.provideService(ProviderLatestVersions.ProviderLatestVersions, latestVersions),
          );

  return { maintenance, withProbedVersion, adviseProbe };
});
