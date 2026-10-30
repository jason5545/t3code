import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import type { TailscalePeerIdentity, TailscaleStatusPeer } from "@t3tools/tailscale";
import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as McpOAuth from "./McpOAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as SessionStore from "./SessionStore.ts";
import * as TailscalePairing from "./TailscalePairing.ts";

const OWNER = "owner@example.com";
const HOST_ADDRESS = "100.95.60.35";
const MAC = "100.89.162.36";
const GROK_BOT = "100.89.41.32";
const FRIEND = "100.70.0.9";

const node = (
  stableNodeId: string,
  nodeName: string,
  loginName: string,
  tags: ReadonlyArray<string> = [],
): TailscalePeerIdentity => ({ stableNodeId, nodeName, loginName, tags });

const PEERS = new Map<string, TailscalePeerIdentity>([
  [MAC, node("nMacStable", "macbook-pro", OWNER)],
  [GROK_BOT, node("nBotStable", "lisky-box-1", "tagged-devices", ["tag:lisky"])],
  [FRIEND, node("nFriendStable", "friend-laptop", "friend@example.com")],
  [HOST_ADDRESS, node("nHostStable", "agent-hub", OWNER)],
]);

const statusPeer = (
  nodeName: string,
  overrides: Partial<TailscaleStatusPeer> = {},
): TailscaleStatusPeer => ({
  stableNodeId: `n${nodeName}`,
  nodeName,
  dnsName: `${nodeName}.tail.ts.net`,
  addresses: [],
  online: true,
  tags: [],
  os: "linux",
  loginName: OWNER,
  ...overrides,
});

const HOST = { ownerLoginName: OWNER, addresses: [HOST_ADDRESS], magicDnsSuffix: "tail.ts.net" };

const layerLookup = Layer.succeed(
  TailscalePairing.TailscaleNodeLookup,
  TailscalePairing.TailscaleNodeLookup.of({
    host: Effect.succeed(HOST),
    whois: (address) => {
      const peer = PEERS.get(address);
      return peer === undefined
        ? Effect.fail(new TailscalePairing.TailscaleLookupError({ unknownPeer: true, cause: "" }))
        : Effect.succeed(peer);
    },
    status: Effect.succeed({
      host: HOST,
      peers: [
        statusPeer("macbook-pro", {
          os: "macOS",
          online: false,
          lastSeen: "2026-10-26T18:13:05Z",
          addresses: [MAC],
        }),
        statusPeer("agent-fr", { addresses: ["fd7a:115c:a1e0::1", "100.112.49.26"] }),
        statusPeer("poco-f8-ultra", { os: "android" }),
        statusPeer("lisky-box", { tags: ["tag:lisky"], loginName: "tagged-devices" }),
        statusPeer("friend-laptop", { loginName: "friend@example.com" }),
      ],
    }),
  }),
);

const layerTest = (ownerAccess: string | undefined) =>
  McpOAuth.layerMcpClientAuthenticator.pipe(
    Layer.provideMerge(
      Layer.effect(TailscalePairing.TailscalePairing, TailscalePairing.make).pipe(
        Layer.provide(layerLookup),
        Layer.provide(
          Layer.succeed(
            TailscalePairing.EnvironmentProbe,
            TailscalePairing.EnvironmentProbe.of({ describe: () => Effect.succeedNone }),
          ),
        ),
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env:
                ownerAccess === undefined ? {} : { T3CODE_TAILSCALE_MCP_OWNER_ACCESS: ownerAccess },
            }),
          ),
        ),
      ),
    ),
    Layer.provideMerge(
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getEnvironmentId: Effect.succeed(EnvironmentId.make("environment:agent-hub")),
      }),
    ),
    Layer.provideMerge(
      EnvironmentAuth.layer.pipe(
        Layer.provideMerge(SqlitePersistence.layerMemory),
        Layer.provideMerge(ServerSecretStore.layer),
        Layer.provideMerge(ServerEnvironment.layerIdentity),
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-tailscale-owner-mcp-test-" }),
        ),
      ),
    ),
    Layer.provideMerge(TestClock.layer()),
  );

const fakeRequest = (peerAddress: string, headers: Record<string, string> = {}) =>
  ({
    headers,
    cookies: {},
    source: { socket: { remoteAddress: peerAddress } },
  }) as unknown as HttpServerRequest.HttpServerRequest;

const callerOf = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.flatMap(McpHttpServer.McpClientAuthenticator, (clients) =>
    clients.authenticate(request),
  ).pipe(Effect.map((scope) => scope?.client));

it.layer(NodeServices.layer)("MCP calls from the owner's own tailnet machines", (it) => {
  it.effect("lets the owner's untagged machine call without a token, and no one else", () =>
    Effect.gen(function* () {
      const mac = yield* callerOf(fakeRequest(MAC));
      expect(mac).toMatchObject({ label: "macbook-pro (Tailscale)", access: "full-access" });
      expect((yield* callerOf(fakeRequest(MAC)))?.sessionId).toBe(mac?.sessionId);

      // Tagged nodes keep T3CODE_TAILSCALE_MCP_TAGS; this host's own traffic carries no peer.
      expect(yield* callerOf(fakeRequest(GROK_BOT))).toBeUndefined();
      expect(yield* callerOf(fakeRequest(FRIEND))).toBeUndefined();
      expect(yield* callerOf(fakeRequest(HOST_ADDRESS))).toBeUndefined();
      expect(yield* callerOf(fakeRequest("127.0.0.1"))).toBeUndefined();
    }).pipe(Effect.provide(layerTest("full-access"))),
  );

  it.effect("keeps every machine on sign-in while owner access is unset", () =>
    Effect.gen(function* () {
      expect(yield* callerOf(fakeRequest(MAC))).toBeUndefined();
    }).pipe(Effect.provide(layerTest(undefined))),
  );

  it.effect("stops a machine once its session is revoked in Connections", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const mac = yield* callerOf(fakeRequest(MAC));
      yield* TestClock.adjust(Duration.seconds(1));
      yield* sessions.revoke(AuthSessionId.make(mac!.sessionId));
      expect(yield* callerOf(fakeRequest(MAC))).toBeUndefined();
    }).pipe(Effect.provide(layerTest("auto"))),
  );

  it.effect(
    "lists the owner's other computers, their tailnet IPv4 and when an offline one was last seen",
    () =>
      Effect.gen(function* () {
        const pairing = yield* TailscalePairing.TailscalePairing;
        expect(Option.getOrThrow(yield* pairing.ownerMachines())).toEqual([
          {
            name: "macbook-pro",
            os: "macOS",
            online: false,
            lastSeen: "2026-10-26T18:13:05Z",
            address: MAC,
          },
          { name: "agent-fr", os: "linux", online: true, lastSeen: null, address: "100.112.49.26" },
        ]);
      }).pipe(Effect.provide(layerTest(undefined))),
  );
});
