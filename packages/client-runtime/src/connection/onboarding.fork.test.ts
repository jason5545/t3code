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
import { CODELESS_PAIRING_REFUSED_DETAIL, PAIRING_REDIRECT_DETAIL } from "./pairingFailureText.ts";
import { SIGNED_OUT_DETAIL } from "./sessionEndedText.ts";
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
const layerEnvironmentRegistryCounting = (knownAddressChecks: { count: number }) =>
  Layer.unwrap(
    Effect.gen(function* () {
      return Layer.mock(EnvironmentRegistry.EnvironmentRegistry)({
        entries: yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(
          new Map(),
        ),
        networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
        assertKnownAddress: () =>
          Effect.sync(() => {
            knownAddressChecks.count += 1;
          }),
      });
    }),
  );
const layerEnvironmentRegistry = layerEnvironmentRegistryCounting({ count: 0 });

type Reply = "ok" | "refuse" | "revoke" | "redirect" | "not-found" | "network" | "server-error";

const forbidden = (reason: string) =>
  Response.json(
    {
      _tag: "EnvironmentOperationForbiddenError",
      code: "operation_forbidden",
      reason,
      traceId: "trace-tailscale-test",
    },
    { status: 403 },
  );

// A slimmer copy of onboarding.test.ts's pairing server, plus the fork's Tailscale endpoint.
function layerPairingHttp(
  calls: Array<{ readonly url: string; readonly init: RequestInit }>,
  replies: { readonly pairing?: Reply; readonly exchange?: Reply } = {},
) {
  const failure = (reply: Reply): Promise<Response> | undefined => {
    switch (reply) {
      case "ok":
        return undefined;
      case "refuse":
        return Promise.resolve(forbidden("tailscale_pairing_refused"));
      case "revoke":
        return Promise.resolve(forbidden("tailscale_pairing_revoked"));
      case "redirect":
        return Promise.resolve(
          new Response(null, { status: 307, headers: { location: "https://elsewhere.test/" } }),
        );
      case "not-found":
        return Promise.resolve(new Response("Not Found", { status: 404 }));
      case "network":
        return Promise.reject(new TypeError("Network request failed"));
      case "server-error":
        return Promise.resolve(new Response("boom", { status: 502 }));
    }
  };
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
      return (
        failure(replies.pairing ?? "ok") ??
        Promise.resolve(
          Response.json({
            id: "tailscale-link",
            credential: "tailscale-code",
            label: "macbook-pro",
            expiresAt: "2026-10-20T10:00:00.000Z",
          }),
        )
      );
    }

    if (url.endsWith("/oauth/token")) {
      return (
        failure(replies.exchange ?? "ok") ??
        Promise.resolve(
          Response.json({
            access_token: "bearer-token",
            issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
            token_type: "Bearer",
            expires_in: 3600,
            scope: AuthStandardClientScopes.join(" "),
          }),
        )
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
        layerPairingHttp(calls),
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

  it.effect.each([
    ["pairing", "refuse", "ConnectionBlockedError", CODELESS_PAIRING_REFUSED_DETAIL],
    ["pairing", "not-found", "ConnectionBlockedError", CODELESS_PAIRING_REFUSED_DETAIL],
    ["pairing", "revoke", "ConnectionBlockedError", SIGNED_OUT_DETAIL],
    ["pairing", "redirect", "ConnectionBlockedError", PAIRING_REDIRECT_DETAIL],
    ["pairing", "network", "ConnectionTransientError", undefined],
    ["pairing", "server-error", "ConnectionTransientError", undefined],
    ["exchange", "redirect", "ConnectionBlockedError", PAIRING_REDIRECT_DETAIL],
    ["exchange", "network", "ConnectionTransientError", undefined],
    ["exchange", "server-error", "ConnectionTransientError", undefined],
  ] as const)(
    "reports a %s endpoint that answers %s as what happened",
    ([endpoint, reply, tag, detail]) =>
      Effect.gen(function* () {
        const layer = Layer.mergeAll(
          layerClientPresentation,
          layerEnvironmentRegistry,
          layerPairingHttp([], { [endpoint]: reply }),
        );
        const error = yield* Effect.flip(
          preparePairingRegistration({ host: "remote.example.test" }).pipe(Effect.provide(layer)),
        );
        expect(error._tag).toBe(tag);
        if (detail !== undefined) expect(error).toMatchObject({ detail });
        // Only a refusal asks for a code.
        if (reply !== "refuse" && reply !== "not-found") {
          expect(error).not.toMatchObject({ detail: CODELESS_PAIRING_REFUSED_DETAIL });
        }
      }),
  );

  it.effect("pairs a tailnet suggestion only when it answers as the suggested environment", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
      const knownAddressChecks = { count: 0 };
      const layer = Layer.mergeAll(
        layerClientPresentation,
        layerEnvironmentRegistryCounting(knownAddressChecks),
        layerPairingHttp(calls),
      );
      const error = yield* Effect.flip(
        preparePairingRegistration({
          host: "http://100.64.10.1:3773",
          suggestedEnvironmentId: "environment-other" as EnvironmentId,
        }).pipe(Effect.provide(layer)),
      );
      expect(error).toMatchObject({ _tag: "ConnectionBlockedError", reason: "configuration" });
      expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
        "/.well-known/t3/environment",
      ]);

      const registration = yield* preparePairingRegistration({
        host: "http://100.64.10.1:3773",
        suggestedEnvironmentId: "environment-paired" as EnvironmentId,
      }).pipe(Effect.provide(layer));
      expect(registration.target.environmentId).toBe("environment-paired");
      // Unlike adding a route, a suggestion keeps the saved-address check.
      expect(knownAddressChecks.count).toBe(1);
    }),
  );
});
