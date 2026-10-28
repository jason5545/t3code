import * as NodeServices from "@effect/platform-node/NodeServices";
import type { TailscalePeerIdentity } from "@t3tools/tailscale";
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
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as McpOAuth from "./McpOAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SessionStore from "./SessionStore.ts";
import * as TailscalePairing from "./TailscalePairing.ts";

const HOST_ADDRESS = "100.95.60.35";
const GROK_BOT = "100.89.41.32";
const CI_BOX = "100.110.0.7";
const SHARED_BOX = "100.110.0.8";
const MAC = "100.89.162.36";
const LOOPBACK_REDIRECT = "http://localhost:51234/callback";
const HTTPS_REDIRECT = "https://agent.example/callback";
const verifier = "a".repeat(43) + "-verifier-for-tests";
const challenge = "DeB41nTVkPwpbbYecrnqtVq7VXLezustdHAK4SWt13c";
const urls = {
  issuer: "https://agent-hub.tail.ts.net",
  resource: "https://agent-hub.tail.ts.net/mcp",
};

const node = (
  stableNodeId: string,
  nodeName: string,
  loginName: string,
  tags: ReadonlyArray<string> = [],
): TailscalePeerIdentity => ({ stableNodeId, nodeName, loginName, tags });

const PEERS = new Map<string, TailscalePeerIdentity>([
  [GROK_BOT, node("nBotStable", "lisky-box-1", "tagged-devices", ["tag:lisky"])],
  [CI_BOX, node("nCiStable", "dice-ci", "tagged-devices", ["tag:game-lxc"])],
  [SHARED_BOX, node("nSharedStable", "shared", "tagged-devices", ["tag:lisky", "tag:ci"])],
  [MAC, node("nMacStable", "macbook-pro", "owner@example.com")],
  [HOST_ADDRESS, node("nHostStable", "agent-hub", "owner@example.com")],
]);

const layerLookup = Layer.succeed(
  TailscalePairing.TailscaleNodeLookup,
  TailscalePairing.TailscaleNodeLookup.of({
    host: Effect.succeed({
      ownerLoginName: "owner@example.com",
      addresses: [HOST_ADDRESS],
      magicDnsSuffix: "tail.ts.net",
    }),
    whois: (address) => {
      const peer = PEERS.get(address);
      return peer === undefined
        ? Effect.fail(new TailscalePairing.TailscaleLookupError({ unknownPeer: true, cause: "" }))
        : Effect.succeed(peer);
    },
    peers: Effect.succeed([]),
  }),
);

const layerTest = (mcpTags: string | undefined) =>
  McpOAuth.layer.pipe(
    Layer.provide(ServerSettings.layerTest()),
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
              env: mcpTags === undefined ? {} : { T3CODE_TAILSCALE_MCP_TAGS: mcpTags },
            }),
          ),
        ),
      ),
    ),
    Layer.provideMerge(
      EnvironmentAuth.layer.pipe(
        Layer.provideMerge(SqlitePersistence.layerMemory),
        Layer.provideMerge(ServerSecretStore.layer),
        Layer.provideMerge(ServerEnvironment.layerIdentity),
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-tailscale-mcp-test-" }),
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

// Tailscale Serve proxies from this machine and names no user for tagged nodes.
const viaServe = (source: string) => fakeRequest(HOST_ADDRESS, { "x-forwarded-for": source });

const signIn = (request: HttpServerRequest.HttpServerRequest, redirect = LOOPBACK_REDIRECT) =>
  Effect.gen(function* () {
    const oauth = yield* McpOAuth.McpOAuth;
    const client = yield* oauth.register({ client_name: "mcp-remote", redirect_uris: [redirect] });
    const authorization = yield* oauth.validateAuthorization({
      urls,
      request: {
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: redirect,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "state-1",
      },
    });
    const approved = yield* oauth.approveOverTailscale(request, authorization);
    if (Option.isNone(approved)) return Option.none();
    const code = new URL(approved.value).searchParams.get("code") ?? "";
    const token = yield* oauth.exchangeCode({
      request,
      urls,
      token: {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
        client_id: client.clientId,
        code_verifier: verifier,
      },
    });
    return Option.some({ redirect: approved.value, token: token.access_token });
  });

const approvedSignIn = (request: HttpServerRequest.HttpServerRequest) =>
  signIn(request).pipe(Effect.map(Option.getOrThrow));

const bearer = (token: string) => fakeRequest(MAC, { authorization: `Bearer ${token}` });

it.layer(NodeServices.layer)("MCP sign-in for tagged tailnet nodes", (it) => {
  it.effect(
    "signs in an allowed tagged node to a loopback redirect without a person, at the configured access",
    () =>
      Effect.gen(function* () {
        const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
        const sessions = yield* SessionStore.SessionStore;
        const served = yield* approvedSignIn(viaServe(GROK_BOT));
        expect(served.redirect).toMatch(
          /^http:\/\/localhost:51234\/callback\?code=.+&state=state-1/u,
        );

        const client = yield* environmentAuth.authenticateMcpClient(bearer(served.token));
        expect(client.access).toBe("auto-accept-edits");
        const session = yield* sessions.verify(served.token);
        expect(session.subject).toBe("mcp-client:tailscale:nBotStable");
        expect(session.client.label).toBe("mcp-remote (lisky-box-1)");
        // Still an MCP-only token.
        expect(
          (yield* Effect.flip(environmentAuth.authenticateHttpRequest(bearer(served.token))))._tag,
        ).toBe("ServerAuthInvalidCredentialError");

        yield* approvedSignIn(fakeRequest(GROK_BOT));
      }).pipe(Effect.provide(layerTest("tag:lisky=auto-accept-edits"))),
  );

  it.effect(
    "leaves https redirects, other tags, untagged devices and local peers to a person",
    () =>
      Effect.gen(function* () {
        expect(yield* signIn(viaServe(GROK_BOT), HTTPS_REDIRECT)).toEqual(Option.none());
        expect(yield* signIn(viaServe(CI_BOX))).toEqual(Option.none());
        expect(yield* signIn(fakeRequest(MAC))).toEqual(Option.none());
        expect(yield* signIn(fakeRequest(HOST_ADDRESS))).toEqual(Option.none());
        // A tagged node cannot borrow another node's address straight to the server.
        expect(yield* signIn(fakeRequest(CI_BOX, { "x-forwarded-for": GROK_BOT }))).toEqual(
          Option.none(),
        );
      }).pipe(Effect.provide(layerTest("tag:lisky=auto-accept-edits"))),
  );

  it.effect("approves nothing when no tag is listed", () =>
    Effect.gen(function* () {
      expect(yield* signIn(viaServe(GROK_BOT))).toEqual(Option.none());
    }).pipe(Effect.provide(layerTest(undefined))),
  );

  it.effect("gives a node with several allowed tags the least access among them", () =>
    Effect.gen(function* () {
      const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const signedIn = yield* approvedSignIn(viaServe(SHARED_BOX));
      expect((yield* environmentAuth.authenticateMcpClient(bearer(signedIn.token))).access).toBe(
        "read-only",
      );
    }).pipe(Effect.provide(layerTest("tag:lisky=full-access, tag:ci=read-only, tag:x=bogus"))),
  );

  it.effect("asks a person again once the node's automatic sign-in is revoked", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const blocks = yield* TailscalePairing.makeBlockStore;
      const signedIn = yield* approvedSignIn(viaServe(GROK_BOT));
      yield* TestClock.adjust(Duration.seconds(1));
      yield* sessions.revoke((yield* sessions.verify(signedIn.token)).sessionId);

      expect(yield* signIn(viaServe(GROK_BOT))).toEqual(Option.none());
      const blocked = yield* blocks.listBlocked;
      expect(blocked.map((entry) => [entry.kind, entry.stableNodeId])).toEqual([
        ["mcp", "nBotStable"],
      ]);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* blocks.unblock(blocked[0]!);
      yield* approvedSignIn(viaServe(GROK_BOT));
    }).pipe(Effect.provide(layerTest("tag:lisky=auto-accept-edits"))),
  );
});
