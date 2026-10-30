import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthStandardClientScopes } from "@t3tools/contracts";
import type { TailscalePeerIdentity, TailscaleStatusPeer } from "@t3tools/tailscale";
import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as SessionStore from "./SessionStore.ts";
import * as TailscalePairing from "./TailscalePairing.ts";

const OWNER = "owner@example.com";
const HOST_ADDRESS = "100.95.60.35";
const MAC = "100.89.162.36";
const PHONE = "100.118.93.59";
const TAGGED_BOT = "100.89.41.32";
const FRIEND = "100.70.0.9";

const node = (
  stableNodeId: string,
  nodeName: string,
  loginName: string,
  tags: ReadonlyArray<string> = [],
): TailscalePeerIdentity => ({ stableNodeId, nodeName, loginName, tags });

// Shaped like agent-hub's tailnet on 2026-10-20, including tailscaled naming
// the host itself for its own address.
const PEERS = new Map<string, TailscalePeerIdentity>([
  [MAC, node("nMacStable", "macbook-pro", OWNER)],
  [PHONE, node("nPhoneStable", "poco-f8-ultra", OWNER)],
  [TAGGED_BOT, node("nBotStable", "lisky-box-1", "tagged-devices", ["tag:lisky"])],
  [FRIEND, node("nFriendStable", "friend-laptop", "friend@example.com")],
  [HOST_ADDRESS, node("nHostStable", "agent-hub", OWNER)],
]);

const statusPeer = (
  stableNodeId: string,
  nodeName: string,
  address: string,
  overrides: Partial<TailscaleStatusPeer> = {},
): TailscaleStatusPeer => ({
  stableNodeId,
  nodeName,
  dnsName: `${nodeName}.tail.ts.net`,
  addresses: [address],
  online: true,
  tags: [],
  os: "linux",
  loginName: OWNER,
  ...overrides,
});

const STATUS_PEERS: ReadonlyArray<TailscaleStatusPeer> = [
  statusPeer("nMacStable", "macbook-pro", MAC, { os: "macOS" }),
  statusPeer("nNasStable", "nas", "100.64.19.3"),
  statusPeer("nPhoneStable", "poco-f8-ultra", PHONE, { os: "android" }),
  statusPeer("nBotStable", "lisky-box", "100.97.155.23", {
    tags: ["tag:lisky"],
    loginName: "tagged-devices",
  }),
  statusPeer("nFriendStable", "friend-laptop", FRIEND, { loginName: "friend@example.com" }),
  statusPeer("nOldStable", "old-box", "100.64.10.1", { online: false }),
  statusPeer("nQuietStable", "quiet", "100.64.10.232"),
  statusPeer("nTwinStable", "twin", "100.64.10.192"),
];

/** Which addresses answer as T3 Code servers; the twin answers as this server itself. */
const layerProbe = (asked: string[], ownEnvironmentId: () => string) =>
  Layer.succeed(
    TailscalePairing.EnvironmentProbe,
    TailscalePairing.EnvironmentProbe.of({
      describe: (httpBaseUrl) =>
        Effect.sync(() => {
          asked.push(httpBaseUrl);
          const environmentId =
            httpBaseUrl === `http://${MAC}:3773/`
              ? "environment-mac"
              : httpBaseUrl === `https://macbook-pro.tail.ts.net/`
                ? "environment-mac"
                : httpBaseUrl === "https://nas.tail.ts.net/"
                  ? "environment-nas"
                  : httpBaseUrl === "http://100.64.10.192:3773/"
                    ? ownEnvironmentId()
                    : httpBaseUrl === "http://100.97.155.23:3773/" ||
                        httpBaseUrl === `http://${FRIEND}:3773/`
                      ? "environment-elsewhere"
                      : undefined;
          return environmentId === undefined
            ? Option.none()
            : Option.some({
                environmentId,
                label: environmentId.replace("environment-", "Server "),
                platform: { os: "linux", arch: "x64" },
                serverVersion: "0.0.0-test",
                capabilities: { repositoryIdentity: true },
              } as never);
        }),
    }),
  );

/** Counts `tailscale status` reads; set `failing` to make them fail like a stopped tailscaled. */
interface StatusReads {
  count: number;
  failing: boolean;
}

const HOST = {
  ownerLoginName: OWNER,
  addresses: [HOST_ADDRESS, "fd7a:115c:a1e0::e833:3c24"],
  magicDnsSuffix: "tail.ts.net",
};

const lookupDown = new TailscalePairing.TailscaleLookupError({ unknownPeer: false, cause: "down" });

const layerLookup = (options: {
  readonly hostUnavailable?: boolean;
  readonly asked: string[];
  readonly statusReads: StatusReads;
}) =>
  Layer.succeed(
    TailscalePairing.TailscaleNodeLookup,
    TailscalePairing.TailscaleNodeLookup.of({
      host: options.hostUnavailable ? Effect.fail(lookupDown) : Effect.succeed(HOST),
      whois: (address) => {
        options.asked.push(address);
        const peer = PEERS.get(address);
        return peer === undefined
          ? Effect.fail(
              new TailscalePairing.TailscaleLookupError({
                unknownPeer: true,
                cause: "peer not found",
              }),
            )
          : Effect.succeed(peer);
      },
      status: Effect.suspend(() => {
        options.statusReads.count += 1;
        return options.hostUnavailable || options.statusReads.failing
          ? Effect.fail(lookupDown)
          : Effect.succeed({ host: HOST, peers: STATUS_PEERS });
      }),
    }),
  );

const layerAuth = EnvironmentAuth.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provideMerge(ServerEnvironment.layerIdentity),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-tailscale-pairing-test-" }),
  ),
);

const layerTest = (
  options: {
    readonly enabled?: boolean;
    readonly hostUnavailable?: boolean;
    readonly asked?: string[];
    readonly probed?: string[];
    readonly statusReads?: StatusReads;
  } = {},
) =>
  Layer.effect(TailscalePairing.TailscalePairing, TailscalePairing.make).pipe(
    Layer.provide(
      layerLookup({
        ...options,
        asked: options.asked ?? [],
        statusReads: options.statusReads ?? { count: 0, failing: false },
      }),
    ),
    Layer.provide(layerProbe(options.probed ?? [], () => ownEnvironmentId)),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: options.enabled === false ? {} : { T3CODE_TAILSCALE_PAIRING: "true" },
        }),
      ),
    ),
    Layer.provideMerge(layerAuth),
    Layer.provideMerge(TestClock.layer()),
  );

const direct = (peerAddress: string, headers: Record<string, string> = {}) => ({
  peerAddress,
  headers,
});

// Tailscale Serve proxies from this machine and sets these headers itself.
const viaServe = (source: string, login: string | undefined, extra: Record<string, string> = {}) =>
  direct(HOST_ADDRESS, {
    host: "agent-hub.tail.ts.net",
    "x-forwarded-for": source,
    ...(login === undefined ? {} : { "tailscale-user-login": login }),
    ...extra,
  });

const refusal = (request: TailscalePairing.TailscalePairingRequest) =>
  Effect.flatMap(TailscalePairing.TailscalePairing, (pairing) =>
    pairing.issueCredential(request),
  ).pipe(
    Effect.flip,
    Effect.map((error) =>
      error._tag === "TailscalePairingRefusedError" ? error.reason : error._tag,
    ),
  );

/** Pairs like a native client: the credential is exchanged for a bearer session. */
const pairBearer = (request: TailscalePairing.TailscalePairingRequest) =>
  Effect.gen(function* () {
    const pairing = yield* TailscalePairing.TailscalePairing;
    const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const sessions = yield* SessionStore.SessionStore;
    const issued = yield* pairing.issueCredential(request);
    const access = yield* environmentAuth.exchangeBootstrapCredentialForAccessToken(
      issued.credential,
      undefined,
      { deviceType: "desktop", label: "Chosen by the client" },
    );
    return yield* sessions.verify(access.access_token);
  });

const tick = TestClock.adjust(Duration.seconds(1));

let ownEnvironmentId = "";

it.layer(NodeServices.layer)("Tailscale pairing", (it) => {
  it.effect("lists the owner's other T3 Code servers on the tailnet", () => {
    const probed: string[] = [];
    return Effect.gen(function* () {
      const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
      ownEnvironmentId = yield* identity.getEnvironmentId;
      const pairing = yield* TailscalePairing.TailscalePairing;
      const servers = yield* pairing.discoverServers();
      expect(servers).toEqual([
        {
          environmentId: "environment-mac",
          label: "Server mac",
          httpBaseUrl: `http://${MAC}:3773/`,
          nodeName: "macbook-pro",
        },
        {
          environmentId: "environment-nas",
          label: "Server nas",
          httpBaseUrl: "https://nas.tail.ts.net/",
          nodeName: "nas",
        },
      ]);
      // Phones, tagged nodes, other accounts and offline nodes are never asked.
      const probedHosts = new Set(probed.map((url) => new URL(url).hostname));
      for (const skipped of ["poco-f8-ultra", "lisky-box", "friend-laptop", "old-box"]) {
        const peer = STATUS_PEERS.find((entry) => entry.nodeName === skipped)!;
        expect([peer.addresses[0], peer.dnsName].filter((host) => probedHosts.has(host!))).toEqual(
          [],
        );
      }
    }).pipe(Effect.provide(layerTest({ probed })));
  });

  it.effect("reads tailscale status once per discovery and shares a success for 30 seconds", () => {
    const probed: string[] = [];
    const statusReads: StatusReads = { count: 0, failing: false };
    return Effect.gen(function* () {
      const pairing = yield* TailscalePairing.TailscalePairing;
      const [first, concurrent] = yield* Effect.all(
        [pairing.discoverServers(), pairing.discoverServers()],
        { concurrency: "unbounded" },
      );
      expect(statusReads.count).toBe(1);
      expect(concurrent).toEqual(first);
      const probesPerDiscovery = probed.length;

      yield* TestClock.adjust(Duration.seconds(29));
      expect(yield* pairing.discoverServers()).toEqual(first);
      expect([statusReads.count, probed.length]).toEqual([1, probesPerDiscovery]);

      yield* TestClock.adjust(Duration.seconds(2));
      yield* pairing.discoverServers();
      expect([statusReads.count, probed.length]).toEqual([2, probesPerDiscovery * 2]);
    }).pipe(Effect.provide(layerTest({ probed, statusReads })));
  });

  it.effect("does not share an unreadable tailscale status", () => {
    const statusReads: StatusReads = { count: 0, failing: true };
    return Effect.gen(function* () {
      const pairing = yield* TailscalePairing.TailscalePairing;
      expect(yield* pairing.discoverServers()).toEqual([]);
      statusReads.failing = false;
      expect((yield* pairing.discoverServers()).map((server) => server.nodeName)).toContain(
        "macbook-pro",
      );
      expect(statusReads.count).toBe(2);
    }).pipe(Effect.provide(layerTest({ statusReads })));
  });

  it.effect("finds nothing while it is off", () => {
    const probed: string[] = [];
    return Effect.gen(function* () {
      const pairing = yield* TailscalePairing.TailscalePairing;
      expect(yield* pairing.discoverServers()).toEqual([]);
      expect(probed).toEqual([]);
    }).pipe(Effect.provide(layerTest({ enabled: false, probed })));
  });

  it.effect(
    "pairs the owner's untagged device, directly or through Serve, as a standard device sign-in",
    () =>
      Effect.gen(function* () {
        const mac = yield* pairBearer(direct(MAC));
        expect(mac.subject).toBe("tailscale:nMacStable");
        expect(mac.method).toBe("bearer-access-token");
        expect(mac.scopes).toEqual(AuthStandardClientScopes);
        expect(mac.client.label).toBe("macbook-pro");

        const phone = yield* pairBearer(viaServe(PHONE, OWNER));
        expect(phone.subject).toBe("tailscale:nPhoneStable");
        expect(phone.client.label).toBe("poco-f8-ultra");
      }).pipe(Effect.provide(layerTest())),
  );

  it.effect(
    "refuses other accounts, tagged nodes, peers outside the tailnet and unknown ones",
    () =>
      Effect.gen(function* () {
        expect(yield* refusal(direct(TAGGED_BOT))).toBe("tagged");
        expect(yield* refusal(direct(FRIEND))).toBe("not_owner");
        expect(yield* refusal(direct("192.168.1.20"))).toBe("no_tailnet_identity");
        expect(yield* refusal(direct("100.100.100.123"))).toBe("no_tailnet_identity");
      }).pipe(Effect.provide(layerTest())),
  );

  it.effect("refuses when tailscaled cannot be asked", () =>
    Effect.gen(function* () {
      expect(yield* refusal(direct(MAC))).toBe("tailscale_unavailable");
    }).pipe(Effect.provide(layerTest({ hostUnavailable: true }))),
  );

  it.effect("trusts Serve's headers only on connections from this machine", () =>
    Effect.gen(function* () {
      // A tagged node claiming to be the owner's Mac, straight to the server.
      expect(
        yield* refusal(
          direct(TAGGED_BOT, { "x-forwarded-for": MAC, "tailscale-user-login": OWNER }),
        ),
      ).toBe("tagged");
      // A local connection without Serve's identity, which tailscaled would
      // otherwise attribute to this machine and its owner.
      expect(yield* refusal(direct(HOST_ADDRESS))).toBe("no_tailnet_identity");
      expect(yield* refusal(direct("127.0.0.1", { "x-forwarded-for": MAC }))).toBe(
        "no_tailnet_identity",
      );
      // Serve sends no user for a tagged node.
      expect(yield* refusal(viaServe(TAGGED_BOT, undefined))).toBe("no_tailnet_identity");
      expect(yield* refusal(viaServe(FRIEND, OWNER))).toBe("not_owner");
      expect(yield* refusal(viaServe(MAC, "friend@example.com"))).toBe("not_owner");
      expect(yield* refusal(viaServe(HOST_ADDRESS, OWNER))).toBe("no_tailnet_identity");
      expect(yield* refusal(viaServe(`${MAC}, ${PHONE}`, OWNER))).toBe("no_tailnet_identity");
      expect(yield* refusal(viaServe(MAC, OWNER, { "tailscale-funnel-request": "?1" }))).toBe(
        "no_tailnet_identity",
      );
    }).pipe(Effect.provide(layerTest())),
  );

  it.effect("accepts a browser only from this server's own tailnet origin", () =>
    Effect.gen(function* () {
      const host = `${HOST_ADDRESS}:3773`;
      expect(yield* refusal(direct(MAC, { host, origin: "https://attacker.example" }))).toBe(
        "origin_not_allowed",
      );
      // A page whose domain now resolves to the server is same-origin to the browser.
      expect(
        yield* refusal(
          direct(MAC, { host: "attacker.example:3773", origin: "http://attacker.example:3773" }),
        ),
      ).toBe("origin_not_allowed");

      expect((yield* pairBearer(direct(MAC, { host, origin: `http://${host}` }))).subject).toBe(
        "tailscale:nMacStable",
      );
      const served = viaServe(PHONE, OWNER, { origin: "https://agent-hub.tail.ts.net" });
      expect((yield* pairBearer(served)).subject).toBe("tailscale:nPhoneStable");
      expect(
        (yield* pairBearer(direct(MAC, { host: "agent-hub:3773", origin: "t3code://app" })))
          .subject,
      ).toBe("tailscale:nMacStable");
    }).pipe(Effect.provide(layerTest())),
  );

  it.effect("keeps a revoked device on pairing codes until it is unblocked", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const blocks = yield* TailscalePairing.makeBlockStore;
      // Two clients on one machine, such as the desktop app and a browser.
      const desktop = yield* pairBearer(direct(MAC));
      yield* tick;
      yield* pairBearer(direct(MAC));
      yield* tick;

      yield* sessions.revoke(desktop.sessionId);
      expect(yield* refusal(direct(MAC))).toBe("revoked");
      expect(yield* refusal(viaServe(MAC, OWNER))).toBe("revoked");

      const blocked = yield* blocks.listBlocked;
      expect(blocked.map((entry) => [entry.label, entry.stableNodeId])).toEqual([
        ["macbook-pro", "nMacStable"],
      ]);
      yield* tick;
      yield* blocks.unblock(blocked[0]!);
      expect(yield* blocks.listBlocked).toEqual([]);
      expect((yield* pairBearer(direct(MAC))).subject).toBe("tailscale:nMacStable");
    }).pipe(Effect.provide(layerTest())),
  );

  it.effect("lets a device pair again after its sign-in expires or is replaced", () =>
    Effect.gen(function* () {
      const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const pairing = yield* TailscalePairing.TailscalePairing;
      yield* pairBearer(direct(PHONE));
      yield* TestClock.adjust(Duration.days(31));
      expect((yield* pairBearer(direct(PHONE))).subject).toBe("tailscale:nPhoneStable");

      // A browser that pairs again, even with an ordinary code, replaces its
      // cookie session, which revokes the old one without the user asking.
      const first = yield* environmentAuth.createBrowserSession(
        (yield* pairing.issueCredential(direct(MAC))).credential,
        { deviceType: "desktop" },
      );
      yield* tick;
      yield* environmentAuth.createBrowserSession(
        (yield* environmentAuth.createPairingLink()).credential,
        { deviceType: "desktop" },
        first.sessionToken,
      );
      yield* tick;
      expect((yield* pairBearer(direct(MAC))).subject).toBe("tailscale:nMacStable");
    }).pipe(Effect.provide(layerTest())),
  );

  it.effect("does nothing while it is off", () => {
    const asked: string[] = [];
    return Effect.gen(function* () {
      expect(yield* refusal(direct(MAC))).toBe("disabled");
      expect(yield* refusal(viaServe(PHONE, OWNER))).toBe("disabled");
      expect(asked).toEqual([]);
    }).pipe(Effect.provide(layerTest({ enabled: false, asked })));
  });
});

const DAY = Duration.toMillis(Duration.days(1));

/** Renews a session as a connection from `request` would; the stored expiry afterwards. */
const renewFrom = (
  request: TailscalePairing.TailscalePairingRequest,
  session: { readonly sessionId: SessionStore.VerifiedSession["sessionId"] },
) =>
  Effect.gen(function* () {
    const pairing = yield* TailscalePairing.TailscalePairing;
    const sessions = yield* SessionStore.SessionStore;
    const expiresAt = yield* sessions.renewIfDue(session.sessionId, (stored) =>
      pairing.renewalSubject(request, stored),
    );
    return Option.getOrThrow(expiresAt).epochMilliseconds;
  });

/** A device paired with a typed or scanned code, as a native client. */
const pairWithCode = Effect.gen(function* () {
  const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const sessions = yield* SessionStore.SessionStore;
  const issued = yield* environmentAuth.issuePairingCredential();
  const access = yield* environmentAuth.exchangeBootstrapCredentialForAccessToken(
    issued.credential,
    undefined,
    { deviceType: "mobile", label: "Phone" },
  );
  return yield* sessions.verify(access.access_token);
});

it.layer(NodeServices.layer)("Tailscale session renewal", (it) => {
  it.effect("renews a device's session only from that device", () => {
    const asked: string[] = [];
    return Effect.gen(function* () {
      const mac = yield* pairBearer(direct(MAC));
      const deadline = mac.expiresAt!.epochMilliseconds;
      yield* TestClock.adjust(Duration.days(2));

      // Another device, the LAN and an address tailscaled does not know leave it alone.
      expect(yield* renewFrom(direct(PHONE), mac)).toBe(deadline);
      asked.length = 0;
      expect(yield* renewFrom(direct("192.168.1.20"), mac)).toBe(deadline);
      expect(asked).toEqual([]);
      expect(yield* renewFrom(direct("100.70.0.77"), mac)).toBe(deadline);

      const now = (yield* DateTime.now).epochMilliseconds;
      expect(yield* renewFrom(viaServe(MAC, OWNER), mac)).toBe(now + 30 * DAY);
    }).pipe(Effect.provide(layerTest({ asked })));
  });

  it.effect("binds a code-paired session to the owner's device it renews from", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const phone = yield* pairWithCode;
      expect(phone.subject).toBe("one-time-token");
      yield* TestClock.adjust(Duration.days(2));

      const now = (yield* DateTime.now).epochMilliseconds;
      expect(yield* renewFrom(direct(PHONE), phone)).toBe(now + 30 * DAY);
      expect((yield* sessions.verify(phone.token)).subject).toBe("tailscale:nPhoneStable");
      // Later renewals come only from the phone.
      yield* TestClock.adjust(Duration.days(2));
      expect(yield* renewFrom(direct(MAC), phone)).toBe(now + 30 * DAY);

      // Signing it out now blocks the phone's pairing without a code.
      yield* tick;
      yield* sessions.revoke(phone.sessionId);
      expect(yield* refusal(direct(PHONE))).toBe("revoked");
    }).pipe(Effect.provide(layerTest())),
  );

  it.effect("leaves code-paired sessions from other, local or blocked nodes alone", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const blockedPhone = yield* pairBearer(direct(PHONE));
      yield* tick;
      yield* sessions.revoke(blockedPhone.sessionId);
      yield* tick;
      const device = yield* pairWithCode;
      const cliIssued = yield* sessions.issue({ subject: "cli-issued-session" });
      yield* TestClock.adjust(Duration.days(2));

      for (const request of [
        direct(TAGGED_BOT),
        direct(FRIEND),
        direct(HOST_ADDRESS),
        direct("127.0.0.1"),
        viaServe(MAC, "friend@example.com"),
        direct(PHONE),
      ]) {
        expect(yield* renewFrom(request, device)).toBe(device.expiresAt!.epochMilliseconds);
      }
      expect((yield* sessions.verify(device.token)).subject).toBe("one-time-token");
      expect(yield* renewFrom(direct(MAC), cliIssued)).toBe(cliIssued.expiresAt.epochMilliseconds);
    }).pipe(Effect.provide(layerTest())),
  );

  it.effect("binds nothing while pairing is off, and a device's session still renews", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const device = yield* pairWithCode;
      const mac = yield* sessions.issue({ subject: "tailscale:nMacStable" });
      yield* TestClock.adjust(Duration.days(2));

      expect(yield* renewFrom(direct(MAC), device)).toBe(device.expiresAt!.epochMilliseconds);
      expect((yield* sessions.verify(device.token)).subject).toBe("one-time-token");
      const now = (yield* DateTime.now).epochMilliseconds;
      expect(yield* renewFrom(direct(MAC), mac)).toBe(now + 30 * DAY);
    }).pipe(Effect.provide(layerTest({ enabled: false }))),
  );
});
