import { ConnectionOnboarding } from "@t3tools/client-runtime/connection";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { connectionAtomRuntime } from "./runtime";
import { layerHttpClientWithoutRedirects } from "./tailnetEntry";

const onboardingScheduler = createAtomCommandScheduler();

export const connectPairingUrl = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:connect-pairing-url",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "singleFlight",
    // The same link used for another machine needs its own expected-machine check.
    key: (input: {
      readonly pairingUrl: string;
      readonly expectedEnvironmentId?: EnvironmentId;
      readonly suggestedEnvironmentId?: EnvironmentId;
    }) =>
      JSON.stringify([
        input.pairingUrl,
        input.expectedEnvironmentId ?? null,
        input.suggestedEnvironmentId ?? null,
      ]),
  },
  execute: (input: {
    readonly pairingUrl: string;
    readonly expectedEnvironmentId?: EnvironmentId;
    readonly suggestedEnvironmentId?: EnvironmentId;
  }) =>
    ConnectionOnboarding.ConnectionOnboarding.pipe(
      Effect.flatMap((onboarding) => onboarding.registerPairing(input)),
    ),
});

/**
 * Fork patch 7: pairs a probed entry server with the base URL it answered on,
 * never following a redirect, and only if it still answers as that environment.
 */
export const connectTailnetEntry = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:connect-tailnet-entry",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "singleFlight",
    key: (input: { readonly httpBaseUrl: string; readonly environmentId: EnvironmentId }) =>
      JSON.stringify([input.httpBaseUrl, input.environmentId]),
  },
  execute: (input: { readonly httpBaseUrl: string; readonly environmentId: EnvironmentId }) =>
    ConnectionOnboarding.registerPairingConnection({
      pairingUrl: input.httpBaseUrl,
      suggestedEnvironmentId: input.environmentId,
    }).pipe(Effect.provide(layerHttpClientWithoutRedirects)),
});

export const updateBearerConnection = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:update-bearer",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "serial",
    key: (input: { readonly environmentId: EnvironmentId }) => input.environmentId,
  },
  execute: (input: {
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly httpBaseUrl: string;
  }) =>
    ConnectionOnboarding.ConnectionOnboarding.pipe(
      Effect.flatMap((onboarding) => onboarding.updateBearer(input)),
    ),
});
