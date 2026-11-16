import type {
  EnvironmentId,
  ExtensionCallRequest,
  ExtensionCallResult,
  ExtensionsRequest,
  ExtensionsSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "../state/environmentHttpAuth.ts";
import * as EnvironmentRegistry from "./registry.ts";
import * as EnvironmentSupervisor from "./supervisor.ts";

/** Installing downloads and checks the extension's files, so it may take a while. */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Fork patch 30: reads or changes an environment's extensions. None while the environment
 * is not connected; a refused action comes back as the snapshot's `error`.
 */
export const request = Effect.fn("clientRuntime.connection.requestExtensions")(function* (
  environmentId: EnvironmentId,
  payload: ExtensionsRequest,
) {
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(
    RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
  );
  return yield* registry.run(
    environmentId,
    Effect.gen(function* () {
      const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
      const prepared = yield* SubscriptionRef.get(supervisor.prepared);
      if (Option.isNone(prepared)) return Option.none<ExtensionsSnapshot>();
      const snapshot = yield* executeAuthenticatedEnvironmentHttpRequest({
        prepared: prepared.value,
        signer,
        remoteAuthorization,
        group: "auth",
        method: "POST",
        url: (urls) => urls.extensions(),
        timeoutMs: REQUEST_TIMEOUT_MS,
        request: ({ client, headers }) => client.extensions({ headers, payload }),
      });
      return Option.some<ExtensionsSnapshot>(snapshot);
    }),
  );
});

/** Leaves the handler's 30 seconds on the server room to answer first. */
const CALL_TIMEOUT_MS = 40_000;

/**
 * Fork patch 30: calls a method of an extension's server part on one environment. None while
 * the environment is not connected; a refused or failed call is the result's `error`.
 */
export const call = Effect.fn("clientRuntime.connection.callExtension")(function* (
  environmentId: EnvironmentId,
  payload: ExtensionCallRequest,
) {
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(
    RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
  );
  return yield* registry.run(
    environmentId,
    Effect.gen(function* () {
      const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
      const prepared = yield* SubscriptionRef.get(supervisor.prepared);
      if (Option.isNone(prepared)) return Option.none<ExtensionCallResult>();
      const result = yield* executeAuthenticatedEnvironmentHttpRequest({
        prepared: prepared.value,
        signer,
        remoteAuthorization,
        group: "auth",
        method: "POST",
        url: (urls) => urls.extensionCall(),
        timeoutMs: CALL_TIMEOUT_MS,
        request: ({ client, headers }) => client.extensionCall({ headers, payload }),
      });
      return Option.some<ExtensionCallResult>(result);
    }),
  );
});
