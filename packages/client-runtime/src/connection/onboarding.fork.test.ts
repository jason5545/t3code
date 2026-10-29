import {
  AuthStandardClientScopes,
  type EnvironmentId,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as RpcHttp from "../rpc/http.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import { BearerConnectionCredential, type ConnectionCatalogEntry } from "./catalog.ts";
import type { NetworkStatus } from "./model.ts";
import { preparePairingRegistration } from "./onboarding.ts";
import * as EnvironmentRegistry from "./registry.ts";

const layerClientPresentation = Layer.succeed(
  ClientCapabilities.ClientPresentation,
  ClientCapabilities.ClientPresentation.of({
    metadata: {
      label: "T3 Code Test",
      deviceType: "desktop",
      os: "Test OS",
    },
  }),
);

// Pairing without a target environment checks the address against saved environments.
const layerEnvironmentRegistry = Layer.unwrap(
  Effect.gen(function* () {
    return Layer.mock(EnvironmentRegistry.EnvironmentRegistry)({
      entries: yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(
        new Map(),
      ),
      networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
      assertKnownAddress: () => Effect.void,
    });
  }),
);

// A slimmer copy of onboarding.test.ts's pairing server, plus the fork's Tailscale endpoint.
function layerPairingHttp(
  calls: Array<{ readonly url: string; readonly init: RequestInit }>,
  tailscalePairing: "issue" | "refuse",
) {
  const fetchFn = ((input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith("/.well-known/t3/environment")) {
      return Promise.resolve(
        Response.json({
          environmentId: "environment-paired",
          label: "Paired environment",
          platform: { os: "linux", arch: "x64" },
          serverVersion: "0.0.0-test",
          orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
          capabilities: { repositoryIdentity: true },
        }),
      );
    }

    if (url.endsWith("/api/auth/tailscale-pairing")) {
      return Promise.resolve(
        tailscalePairing === "issue"
          ? Response.json({
              id: "tailscale-link",
              credential: "tailscale-code",
              label: "macbook-pro",
              expiresAt: "2026-10-20T10:00:00.000Z",
            })
          : Response.json(
              {
                _tag: "EnvironmentOperationForbiddenError",
                code: "operation_forbidden",
                reason: "tailscale_pairing_refused",
                traceId: "trace-tailscale-test",
              },
              { status: 403 },
            ),
      );
    }

    if (url.endsWith("/oauth/token")) {
      return Promise.resolve(
        Response.json({
          access_token: "bearer-token",
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: AuthStandardClientScopes.join(" "),
        }),
      );
    }

    return Promise.reject(new Error(`Unexpected request: ${url}`));
  }) satisfies typeof fetch;

  return RpcHttp.layerRemoteHttpClient(fetchFn);
}

describe("connection onboarding over Tailscale", () => {
  it.effect("pairs an address without a code over Tailscale", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
      const layer = Layer.mergeAll(
        layerClientPresentation,
        layerEnvironmentRegistry,
        layerPairingHttp(calls, "issue"),
      );
      const registration = yield* preparePairingRegistration({ host: "remote.example.test" }).pipe(
        Effect.provide(layer),
      );
      expect(registration.credential).toEqual(
        new BearerConnectionCredential({ token: "bearer-token" }),
      );
      expect(calls.map((call) => call.url)).toEqual([
        "https://remote.example.test/.well-known/t3/environment",
        "https://remote.example.test/api/auth/tailscale-pairing",
        "https://remote.example.test/oauth/token",
      ]);
      const tokenRequest = calls.at(-1);
      const tokenBody =
        tokenRequest?.init.body instanceof Uint8Array
          ? new TextDecoder().decode(tokenRequest.init.body)
          : String(tokenRequest?.init.body);
      expect(new URLSearchParams(tokenBody).get("subject_token")).toBe("tailscale-code");

      // A pairing link without its token is the same address-only request.
      const fromLink = yield* preparePairingRegistration({
        pairingUrl: "http://100.95.60.35:3773/",
      }).pipe(Effect.provide(layer));
      expect(fromLink.profile.httpBaseUrl).toBe("http://100.95.60.35:3773/");
    }),
  );

  it.effect("asks for a code when the host will not pair over Tailscale", () =>
    Effect.gen(function* () {
      const layer = Layer.mergeAll(
        layerClientPresentation,
        layerEnvironmentRegistry,
        layerPairingHttp([], "refuse"),
      );
      const error = yield* Effect.flip(
        preparePairingRegistration({ host: "remote.example.test" }).pipe(Effect.provide(layer)),
      );
      expect(error).toMatchObject({
        _tag: "ConnectionBlockedError",
        reason: "configuration",
        detail: "Enter a pairing code.",
      });
    }),
  );
});
