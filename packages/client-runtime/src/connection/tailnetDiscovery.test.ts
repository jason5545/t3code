import { EnvironmentId, ORCHESTRATION_PROTOCOL_VERSION } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as RpcHttp from "../rpc/http.ts";
import { discoverServersThroughTailscaleApi, mergeDiscoveredServers } from "./tailnetDiscovery.ts";

const descriptor = (environmentId: string, label: string) =>
  Response.json({
    environmentId,
    label,
    platform: { os: "linux", arch: "x64" },
    serverVersion: "0.0.0-test",
    orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
    capabilities: { repositoryIdentity: true },
  });

// Shaped like GET /api/v2/tailnet/-/devices (tailscale client/tailscale/devices.go).
const DEVICES = [
  {
    addresses: ["100.95.60.35", "fd7a:115c:a1e0::e833:3c24"],
    name: "agent-hub.tail.ts.net",
    hostname: "agent-hub",
    os: "linux",
    tags: null,
  },
  {
    addresses: ["100.89.162.36"],
    name: "macbook-pro.tail.ts.net",
    hostname: "MacBook Pro",
    os: "macOS",
  },
  { addresses: ["100.118.93.59"], name: "phone.tail.ts.net", hostname: "phone", os: "android" },
  {
    addresses: ["100.97.155.23"],
    name: "lisky-box.tail.ts.net",
    hostname: "lisky-box",
    os: "linux",
    tags: ["tag:lisky"],
  },
];

const layerTailscaleApi = (requests: Array<{ readonly url: string; readonly init: RequestInit }>) =>
  RpcHttp.layerRemoteHttpClient(((input, init = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push({ url, init });
    if (url === "https://api.tailscale.com/api/v2/oauth/token") {
      const body = new URLSearchParams(
        init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init.body),
      );
      return Promise.resolve(
        body.get("client_secret") === "secret"
          ? Response.json({ access_token: "ts-token", token_type: "Bearer", expires_in: 3600 })
          : Response.json({ message: "invalid client" }, { status: 401 }),
      );
    }
    if (url === "https://api.tailscale.com/api/v2/tailnet/-/devices") {
      return Promise.resolve(Response.json({ devices: DEVICES }));
    }
    if (url === "http://100.95.60.35:3773/.well-known/t3/environment") {
      return Promise.resolve(descriptor("environment-agent-hub", "agent-hub"));
    }
    if (url === "https://macbook-pro.tail.ts.net/.well-known/t3/environment") {
      return Promise.resolve(descriptor("environment-mac", "Mac"));
    }
    return Promise.reject(new TypeError("connection refused"));
  }) satisfies typeof fetch);

describe("tailnet server discovery", () => {
  it.effect("finds servers through the Tailscale API, asking only untagged computers", () =>
    Effect.gen(function* () {
      const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
      const servers = yield* discoverServersThroughTailscaleApi({
        clientId: "client",
        clientSecret: "secret",
      }).pipe(Effect.provide(layerTailscaleApi(requests)));

      expect(servers).toEqual([
        {
          environmentId: "environment-agent-hub",
          label: "agent-hub",
          httpBaseUrl: "http://100.95.60.35:3773/",
          nodeName: "agent-hub",
        },
        {
          environmentId: "environment-mac",
          label: "Mac",
          httpBaseUrl: "https://macbook-pro.tail.ts.net/",
          nodeName: "macbook-pro",
        },
      ]);
      const devicesRequest = requests.find((request) => request.url.endsWith("/devices"));
      expect(new Headers(devicesRequest?.init.headers).get("authorization")).toBe(
        "Bearer ts-token",
      );
      const asked = requests.map((request) => new URL(request.url).hostname);
      for (const skipped of ["100.118.93.59", "phone.tail.ts.net", "100.97.155.23"]) {
        expect(asked).not.toContain(skipped);
      }
    }),
  );

  it.effect("reports credentials the Tailscale API rejects", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        discoverServersThroughTailscaleApi({ clientId: "client", clientSecret: "wrong" }).pipe(
          Effect.provide(layerTailscaleApi([])),
        ),
      );
      expect(error._tag).toBe("TailscaleApiError");
    }),
  );

  it("offers each environment once and leaves out the ones already added", () => {
    const server = (environmentId: string, httpBaseUrl: string) => ({
      environmentId: EnvironmentId.make(environmentId),
      label: environmentId,
      httpBaseUrl,
      nodeName: environmentId,
    });
    expect(
      mergeDiscoveredServers(
        [
          [server("mac", "http://100.89.162.36:3773/"), server("added", "http://100.64.0.2:3773/")],
          [server("mac", "https://mac.tail.ts.net/"), server("nas", "https://nas.tail.ts.net/")],
        ],
        new Set([EnvironmentId.make("added")]),
      ).map((entry) => [entry.environmentId, entry.httpBaseUrl]),
    ).toEqual([
      ["mac", "http://100.89.162.36:3773/"],
      ["nas", "https://nas.tail.ts.net/"],
    ]);
  });
});
