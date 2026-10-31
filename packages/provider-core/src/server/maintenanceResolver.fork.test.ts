import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProviderLatestVersions from "./ProviderLatestVersions.ts";
import {
  normalizeCommandPath,
  resolveLatestProviderVersion,
  resolvePackageManagedProviderMaintenance,
} from "./maintenanceResolver.ts";

const noSpawn = ChildProcessSpawner.make(() =>
  Effect.die("maintenance resolution should not spawn a process here"),
);
const npmLatest = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ version: "2.1.316" }))),
);

const resolveNativeClaudeLatest = (lookupLatestVersion: Effect.Effect<string | null>) =>
  resolvePackageManagedProviderMaintenance(
    {
      provider: ProviderDriverKind.make("claudeAgent"),
      npmPackageName: "@anthropic-ai/claude-code",
      nativeUpdate: {
        args: ["update"],
        isCommandPath: (commandPath) =>
          normalizeCommandPath(commandPath).endsWith("/.local/bin/claude"),
        lookupLatestVersion,
      },
    },
    {
      binaryPath: "claude",
      resolvedCommandPath: "/home/me/.local/bin/claude",
      realCommandPath: "/home/me/.local/bin/claude",
      env: {},
      platform: "linux",
    },
  ).pipe(
    Effect.flatMap(resolveLatestProviderVersion),
    Effect.provide(Layer.mergeAll(ProviderLatestVersions.layer, NodeServices.layer)),
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, noSpawn),
    Effect.provideService(HttpClient.HttpClient, npmLatest),
  );

it.effect("compares a native install with its own release channel, not npm", () =>
  Effect.gen(function* () {
    // `claude update` installs 2.1.314 while npm already lists 2.1.316.
    expect(yield* resolveNativeClaudeLatest(Effect.succeed("2.1.314"))).toBe("2.1.314");
    // A failed channel lookup is unknown; npm would report a version the updater cannot install.
    expect(yield* resolveNativeClaudeLatest(Effect.succeed(null))).toBeNull();
  }),
);
