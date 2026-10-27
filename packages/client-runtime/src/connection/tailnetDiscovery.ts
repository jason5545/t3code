import type { EnvironmentId, TailnetServer } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "../state/environmentHttpAuth.ts";
import * as EnvironmentRegistry from "./registry.ts";
import * as EnvironmentSupervisor from "./supervisor.ts";

/**
 * Fork patch 7: T3 Code servers on the user's tailnet, found without typing
 * an address. Adding one pairs over Tailscale, so it needs no code either.
 */
export type DiscoveredTailnetServer = TailnetServer;

const DISCOVERY_TIMEOUT_MS = 15_000;

/** Keeps the first server per environment and drops the ones this client already has. */
export const mergeDiscoveredServers = (
  lists: ReadonlyArray<ReadonlyArray<DiscoveredTailnetServer>>,
  registered: ReadonlySet<EnvironmentId>,
): ReadonlyArray<DiscoveredTailnetServer> => {
  const byEnvironment = new Map<EnvironmentId, DiscoveredTailnetServer>();
  for (const server of lists.flat()) {
    if (!registered.has(server.environmentId) && !byEnvironment.has(server.environmentId)) {
      byEnvironment.set(server.environmentId, server);
    }
  }
  return [...byEnvironment.values()];
};

/** Asks each connected environment which other servers its tailnet has. */
const discoverServersThroughEnvironments = Effect.fn(
  "clientRuntime.connection.discoverServersThroughEnvironments",
)(function* () {
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(
    RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
  );
  const entries = yield* SubscriptionRef.get(registry.entries);
  return yield* Effect.forEach(
    [...entries.keys()],
    (environmentId) =>
      registry
        .run(
          environmentId,
          Effect.gen(function* () {
            const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
            const prepared = yield* SubscriptionRef.get(supervisor.prepared);
            if (Option.isNone(prepared)) return [];
            return yield* executeAuthenticatedEnvironmentHttpRequest({
              prepared: prepared.value,
              signer,
              remoteAuthorization,
              group: "auth",
              method: "GET",
              url: (urls) => urls.tailnetServers(),
              timeoutMs: DISCOVERY_TIMEOUT_MS,
              request: ({ client, headers }) => client.tailnetServers({ headers }),
            });
          }),
        )
        // Servers without the endpoint, or with discovery off, just add nothing.
        .pipe(Effect.orElseSucceed((): ReadonlyArray<DiscoveredTailnetServer> => [])),
    { concurrency: "unbounded" },
  );
});

/**
 * Servers to offer, from every connected environment. A client with none has
 * no one to ask; it adds its first server by address or tailnet machine name.
 */
export const discoverTailnetServers = Effect.fn("clientRuntime.connection.discoverTailnetServers")(
  function* () {
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const viaEnvironments = yield* discoverServersThroughEnvironments();
    const registered = new Set((yield* SubscriptionRef.get(registry.entries)).keys());
    return mergeDiscoveredServers(viaEnvironments, registered);
  },
);
