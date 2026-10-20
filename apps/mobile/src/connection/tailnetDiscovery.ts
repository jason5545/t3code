import { TailnetDiscovery } from "@t3tools/client-runtime/connection";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import * as SecureStore from "expo-secure-store";

import { connectionAtomRuntime } from "./runtime";

/**
 * Fork patch 7: a phone with no environment yet can still find servers by
 * listing the tailnet's devices with a Tailscale OAuth client. Its secret
 * stays in the device keychain.
 */
const TAILSCALE_API_CREDENTIALS_KEY = "t3code.tailscale-api.oauth-client";

const TailscaleApiCredentials = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.String,
});
const decodeCredentials = Schema.decodeUnknownOption(
  Schema.fromJsonString(TailscaleApiCredentials),
);
const encodeCredentials = Schema.encodeSync(Schema.fromJsonString(TailscaleApiCredentials));

const readCredentials = Effect.tryPromise(() =>
  SecureStore.getItemAsync(TAILSCALE_API_CREDENTIALS_KEY),
).pipe(
  Effect.map((raw) => (raw === null ? Option.none() : decodeCredentials(raw))),
  Effect.orElseSucceed(() => Option.none<TailnetDiscovery.TailscaleApiCredentials>()),
);

// Bumped after the saved credentials change, so both atoms read them again.
const credentialsVersionAtom = Atom.make(0).pipe(Atom.keepAlive);

export const tailscaleApiConfiguredAtom = connectionAtomRuntime
  .atom((get) => {
    get(credentialsVersionAtom);
    return readCredentials.pipe(Effect.map(Option.isSome));
  })
  .pipe(Atom.withLabel("mobile:connection:tailscale-api-configured"));

/** Read while the add-environment screen is open; reopening it asks again. */
export const tailnetServersAtom = connectionAtomRuntime
  .atom((get) => {
    get(credentialsVersionAtom);
    return Effect.flatMap(readCredentials, (credentials) =>
      TailnetDiscovery.discoverTailnetServers(
        Option.isSome(credentials) ? { tailscaleApi: credentials.value } : {},
      ),
    );
  })
  .pipe(Atom.withLabel("mobile:connection:tailnet-servers"));

export const saveTailscaleApiCredentials = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:save-tailscale-api",
  concurrency: { mode: "singleFlight", key: () => "tailscale-api" },
  // Checked against the API before it is kept, so a typo is reported now.
  execute: (credentials: TailnetDiscovery.TailscaleApiCredentials, registry) =>
    TailnetDiscovery.discoverServersThroughTailscaleApi(credentials).pipe(
      Effect.andThen(
        Effect.tryPromise(() =>
          SecureStore.setItemAsync(TAILSCALE_API_CREDENTIALS_KEY, encodeCredentials(credentials)),
        ),
      ),
      Effect.andThen(
        Effect.sync(() => registry.update(credentialsVersionAtom, (version) => version + 1)),
      ),
    ),
});

export const removeTailscaleApiCredentials = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:remove-tailscale-api",
  concurrency: { mode: "singleFlight", key: () => "tailscale-api" },
  execute: (_input: void, registry) =>
    Effect.tryPromise(() => SecureStore.deleteItemAsync(TAILSCALE_API_CREDENTIALS_KEY)).pipe(
      Effect.andThen(
        Effect.sync(() => registry.update(credentialsVersionAtom, (version) => version + 1)),
      ),
    ),
});
