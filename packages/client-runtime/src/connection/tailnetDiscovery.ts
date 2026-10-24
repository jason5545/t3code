import type { EnvironmentId, TailnetServer } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import { fetchRemoteEnvironmentDescriptor } from "../environment/descriptor.ts";
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
const PROBE_TIMEOUT_MS = 2_000;
const DEFAULT_SERVER_PORT = 3773;
const TAILSCALE_API = "https://api.tailscale.com/api/v2";

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

/** An OAuth client from the Tailscale admin console with the `devices:core:read` scope. */
export interface TailscaleApiCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

const TailscaleApiToken = Schema.Struct({ access_token: Schema.String });

const TailscaleApiDevices = Schema.Struct({
  devices: Schema.Array(
    Schema.Struct({
      addresses: Schema.optional(Schema.Array(Schema.String)),
      name: Schema.optional(Schema.String),
      hostname: Schema.optional(Schema.String),
      os: Schema.optional(Schema.String),
      tags: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
    }),
  ),
});

export class TailscaleApiError extends Schema.TaggedError<TailscaleApiError>()(
  "TailscaleApiError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not list devices with the Tailscale API. Check the OAuth client ID and secret.";
  }
}

const CLIENT_ONLY_OS = new Set(["android", "iOS"]);

/** Where an untagged device may serve T3 Code: its tailnet IPv4, then Tailscale Serve. */
const tailscaleApiServerUrls = (
  device: (typeof TailscaleApiDevices.Type.devices)[number],
): ReadonlyArray<string> => {
  if ((device.tags?.length ?? 0) > 0 || CLIENT_ONLY_OS.has(device.os ?? "")) return [];
  const address = device.addresses?.find((entry) => /^\d{1,3}(\.\d{1,3}){3}$/u.test(entry));
  const dnsName = device.name?.replace(/\.$/u, "");
  return [
    ...(address === undefined ? [] : [`http://${address}:${DEFAULT_SERVER_PORT}/`]),
    ...(dnsName === undefined || dnsName === "" ? [] : [`https://${dnsName}/`]),
  ];
};

/**
 * For a client with no environment to ask yet: lists the tailnet's devices
 * with the Tailscale API and asks each one directly. Tagged devices belong to
 * the tailnet rather than a person, so they are left out, as servers do.
 */
export const discoverServersThroughTailscaleApi = Effect.fn(
  "clientRuntime.connection.discoverServersThroughTailscaleApi",
)(function* (credentials: TailscaleApiCredentials) {
  const http = yield* HttpClient.HttpClient;
  const { access_token: accessToken } = yield* http
    .execute(
      HttpClientRequest.post(`${TAILSCALE_API}/oauth/token`).pipe(
        HttpClientRequest.bodyUrlParams({
          grant_type: "client_credentials",
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        }),
      ),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(TailscaleApiToken)),
      Effect.mapError((cause) => new TailscaleApiError({ cause })),
    );
  const { devices } = yield* http
    .execute(
      HttpClientRequest.get(`${TAILSCALE_API}/tailnet/-/devices`).pipe(
        HttpClientRequest.bearerToken(accessToken),
      ),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(TailscaleApiDevices)),
      Effect.mapError((cause) => new TailscaleApiError({ cause })),
    );
  const found = yield* Effect.forEach(
    devices,
    (device) =>
      Effect.forEach(
        tailscaleApiServerUrls(device),
        (httpBaseUrl) =>
          fetchRemoteEnvironmentDescriptor({ httpBaseUrl, timeoutMs: PROBE_TIMEOUT_MS }).pipe(
            Effect.map((descriptor) =>
              Option.some({
                environmentId: descriptor.environmentId,
                label: descriptor.label,
                httpBaseUrl,
                nodeName: device.name?.split(".")[0] ?? device.hostname ?? httpBaseUrl,
              } satisfies DiscoveredTailnetServer),
            ),
            Effect.orElseSucceed(() => Option.none<DiscoveredTailnetServer>()),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((servers) => servers.flatMap(Option.toArray))),
    { concurrency: "unbounded" },
  );
  return found.flat();
});

/** Servers to offer: from every connected environment, and from the Tailscale API when set up. */
export const discoverTailnetServers = Effect.fn("clientRuntime.connection.discoverTailnetServers")(
  function* (input?: { readonly tailscaleApi?: TailscaleApiCredentials }) {
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const [viaEnvironments, viaApi] = yield* Effect.all(
      [
        discoverServersThroughEnvironments(),
        input?.tailscaleApi === undefined
          ? Effect.succeed([])
          : discoverServersThroughTailscaleApi(input.tailscaleApi).pipe(
              // Saved credentials were checked when stored; a later failure
              // must not hide what connected environments found.
              Effect.catch((cause) =>
                Effect.logWarning("Tailscale API discovery failed.", { cause }).pipe(Effect.as([])),
              ),
            ),
      ],
      { concurrency: "unbounded" },
    );
    const registered = new Set((yield* SubscriptionRef.get(registry.entries)).keys());
    return mergeDiscoveredServers([...viaEnvironments, viaApi], registered);
  },
);
