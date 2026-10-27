import { EnvironmentId, ORCHESTRATION_PROTOCOL_VERSION } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ConnectionResolver from "./resolver.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionCredential,
  type ConnectionProfile,
} from "./catalog.ts";
import * as ConnectionCredentialStore from "./credentialStore.ts";
import { BearerConnectionTarget, ConnectionBlockedError, type ConnectionTarget } from "./model.ts";
import * as ConnectionProfileStore from "./profileStore.ts";
import * as RpcHttp from "../rpc/http.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const ENDPOINT = {
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
};

function catalogEntry(
  target: ConnectionTarget,
  profile: Option.Option<ConnectionProfile> = Option.none(),
): ConnectionCatalogEntry {
  return { target, profile, enabled: true };
}

// A slimmer copy of resolver.test.ts's dependencies, plus the fork's Tailscale endpoint.
const makeDependencies = (options: {
  readonly credentialMap: Map<string, ConnectionCredential>;
  readonly authorizeBearer: RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization["Service"]["authorizeBearer"];
  readonly tailscalePairing: "issue" | "refuse" | "revoked";
}) => {
  const profiles = new Map<string, ConnectionProfile>();
  const credentials = options.credentialMap;

  const layerDependencies = Layer.mergeAll(
    RpcHttp.layerRemoteHttpClient(((input: string | URL | Request) =>
      Promise.resolve(
        String(input).endsWith("/api/auth/tailscale-pairing")
          ? options.tailscalePairing === "issue"
            ? Response.json({
                id: "tailscale-link",
                credential: "tailscale-code",
                expiresAt: "2026-10-20T10:00:00.000Z",
              })
            : Response.json(
                {
                  _tag: "EnvironmentOperationForbiddenError",
                  code: "operation_forbidden",
                  reason:
                    options.tailscalePairing === "revoked"
                      ? "tailscale_pairing_revoked"
                      : "tailscale_pairing_refused",
                  traceId: "trace-tailscale-test",
                },
                { status: 403 },
              )
          : String(input).endsWith("/oauth/token")
            ? Response.json({
                access_token: "tailscale-bearer",
                issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
                token_type: "Bearer",
                expires_in: 3600,
                scope: "orchestration:read",
              })
            : Response.json({
                environmentId: ENVIRONMENT_ID,
                label: "Compatible environment",
                platform: { os: "linux", arch: "x64" },
                serverVersion: "0.0.0-test",
                orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
                capabilities: { repositoryIdentity: true },
              }),
      )) satisfies typeof fetch),
    Layer.succeed(
      ConnectionProfileStore.ConnectionProfileStore,
      ConnectionProfileStore.ConnectionProfileStore.of({
        get: (connectionId) => Effect.succeed(Option.fromNullishOr(profiles.get(connectionId))),
        put: (profile) => Effect.sync(() => void profiles.set(profile.connectionId, profile)),
        remove: (connectionId) => Effect.sync(() => void profiles.delete(connectionId)),
      }),
    ),
    Layer.succeed(
      ConnectionCredentialStore.ConnectionCredentialStore,
      ConnectionCredentialStore.ConnectionCredentialStore.of({
        get: (connectionId) => Effect.succeed(Option.fromNullishOr(credentials.get(connectionId))),
        put: (connectionId, credential) =>
          Effect.sync(() => void credentials.set(connectionId, credential)),
        remove: (connectionId) => Effect.sync(() => void credentials.delete(connectionId)),
      }),
    ),
    Layer.succeed(
      ClientCapabilities.PrimaryEnvironmentAuth,
      ClientCapabilities.PrimaryEnvironmentAuth.of({ bearerToken: Effect.succeedNone }),
    ),
    Layer.succeed(
      ClientCapabilities.ClientPresentation,
      ClientCapabilities.ClientPresentation.of({
        metadata: { label: "Test Client", deviceType: "desktop", surface: "web" },
      }),
    ),
    Layer.succeed(
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization.of({
        authorizeBearer: options.authorizeBearer,
        authorizeDpop: () => Effect.die("unused"),
        authorizeDpopHttp: () => Effect.die("unused"),
      }),
    ),
    Layer.succeed(
      ClientCapabilities.SshEnvironmentGateway,
      ClientCapabilities.SshEnvironmentGateway.of({
        provision: () => Effect.die("unused"),
        prepare: () => Effect.die("unused"),
        disconnect: () => Effect.void,
      }),
    ),
  );

  return ConnectionResolver.layer.pipe(Layer.provide(layerDependencies));
};

describe("a saved bearer environment whose credential is rejected", () => {
  const target = new BearerConnectionTarget({
    environmentId: ENVIRONMENT_ID,
    label: "Saved",
    connectionId: "saved-1",
  });
  const profile = new BearerConnectionProfile({
    connectionId: "saved-1",
    environmentId: ENVIRONMENT_ID,
    label: "Saved",
    httpBaseUrl: ENDPOINT.httpBaseUrl,
    wsBaseUrl: ENDPOINT.wsBaseUrl,
  });
  const rejected = new ConnectionBlockedError({
    reason: "authentication",
    detail: "The environment credential is invalid.",
  });
  const authorizeBearer: RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization["Service"]["authorizeBearer"] =
    (input) =>
      input.bearerToken === "expired-bearer"
        ? Effect.fail(rejected)
        : Effect.succeed({
            environmentId: input.expectedEnvironmentId,
            label: "Saved",
            httpBaseUrl: input.httpBaseUrl,
            socketUrl: "wss://environment.example.test/ws?wsTicket=ticket",
            httpAuthorization: { _tag: "Bearer" as const, token: input.bearerToken },
          });

  it.effect.each([
    ["rejected", [["saved-1", new BearerConnectionCredential({ token: "expired-bearer" })]]],
    ["missing", []],
  ] as const)("pairs again over Tailscale when it is %s, and keeps the new one", ([, saved]) =>
    Effect.gen(function* () {
      const credentialMap = new Map<string, ConnectionCredential>(saved);
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(
        Effect.provide(
          makeDependencies({ credentialMap, authorizeBearer, tailscalePairing: "issue" }),
        ),
      );
      const prepared = yield* broker.prepare(catalogEntry(target, Option.some(profile)));
      expect(prepared.httpAuthorization).toEqual({ _tag: "Bearer", token: "tailscale-bearer" });
      expect(credentialMap.get("saved-1")).toEqual(
        new BearerConnectionCredential({ token: "tailscale-bearer" }),
      );
    }),
  );

  it.effect("keeps the original failure when the host will not pair over Tailscale", () =>
    Effect.gen(function* () {
      const credentialMap = new Map<string, ConnectionCredential>([
        ["saved-1", new BearerConnectionCredential({ token: "expired-bearer" })],
      ]);
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(
        Effect.provide(
          makeDependencies({ credentialMap, authorizeBearer, tailscalePairing: "refuse" }),
        ),
      );
      const error = yield* Effect.flip(broker.prepare(catalogEntry(target, Option.some(profile))));
      expect(error).toBe(rejected);
      expect(credentialMap.get("saved-1")).toEqual(
        new BearerConnectionCredential({ token: "expired-bearer" }),
      );
    }),
  );

  it.effect("says the device was signed out when its node may no longer pair", () =>
    Effect.gen(function* () {
      const credentialMap = new Map<string, ConnectionCredential>([
        ["saved-1", new BearerConnectionCredential({ token: "expired-bearer" })],
      ]);
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(
        Effect.provide(
          makeDependencies({ credentialMap, authorizeBearer, tailscalePairing: "revoked" }),
        ),
      );
      const error = yield* Effect.flip(broker.prepare(catalogEntry(target, Option.some(profile))));
      expect(error).toMatchObject({
        _tag: "ConnectionBlockedError",
        reason: "authentication",
        detail: "This device was signed out.",
        traceId: "trace-tailscale-test",
      });
    }),
  );
});
