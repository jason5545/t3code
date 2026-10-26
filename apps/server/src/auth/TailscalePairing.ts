import {
  AuthMcpClientAccess,
  AuthSessionId,
  AuthStandardClientScopes,
  ExecutionEnvironmentDescriptor,
  type AuthPairingCredentialResult,
  type TailnetServer,
} from "@t3tools/contracts";
import {
  isTailscaleAddress,
  isTailscaleIpv4Address,
  readTailscaleHostIdentity,
  readTailscalePeers,
  readTailscaleWhois,
  type TailscaleHostIdentity,
  type TailscalePeerIdentity,
  type TailscaleStatusPeer,
} from "@t3tools/tailscale";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import { ChildProcessSpawner } from "effect/process";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { DESKTOP_RENDERER_ORIGINS } from "../httpCors.ts";
import * as AuthSessions from "../persistence/AuthSessions.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import { MCP_CLIENT_SUBJECT } from "./mcpClientSubject.ts";

/**
 * Fork patch 7: a device on the owner's tailnet pairs without a code. Later
 * requests still need the session it pays for, and the origin check still
 * applies: a web page can reach tailnet addresses and a session runs terminals.
 */
const TailscalePairingEnabled = Config.Boolean("T3CODE_TAILSCALE_PAIRING").pipe(
  Config.withDefault(false),
);

const TAILSCALE_SESSION_SUBJECT_PREFIX = "tailscale:";
const TAILSCALE_MCP_SUBJECT_PREFIX = `${MCP_CLIENT_SUBJECT}:${TAILSCALE_SESSION_SUBJECT_PREFIX}`;
const PAIRING_CREDENTIAL_TTL = Duration.minutes(1);

const tailscaleSessionSubject = (stableNodeId: string) =>
  `${TAILSCALE_SESSION_SUBJECT_PREFIX}${stableNodeId}`;

const tailscaleMcpSubject = (stableNodeId: string) =>
  `${TAILSCALE_MCP_SUBJECT_PREFIX}${stableNodeId}`;

const MCP_ACCESS_ORDER = AuthMcpClientAccess.literals;
const isMcpClientAccess = Schema.is(AuthMcpClientAccess);

/**
 * `tag:lisky=auto-accept-edits,tag:ci=read-only`: tagged nodes whose MCP
 * sign-ins are approved without a person, each with the most access it may
 * get. Entries that do not parse are skipped, so a typo only leaves that tag
 * on manual approval.
 */
const parseMcpTagAccess = (value: string) => {
  const grants = new Map<string, AuthMcpClientAccess>();
  const skipped: Array<string> = [];
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const separator = trimmed.lastIndexOf("=");
    const tag = trimmed.slice(0, separator).trim();
    const access = trimmed.slice(separator + 1).trim();
    if (separator <= 0 || !tag.startsWith("tag:") || !isMcpClientAccess(access)) {
      skipped.push(trimmed);
      continue;
    }
    grants.set(tag, access);
  }
  return { grants, skipped };
};

const TailscaleMcpTags = Config.String("T3CODE_TAILSCALE_MCP_TAGS").pipe(Config.withDefault(""));

/**
 * Fork patch 22: an access level, such as `full-access`, lets the owner's own
 * untagged machines call `/mcp` without a token, the trust device pairing
 * already gives them. Unset, they sign in like any other MCP client.
 */
const TailscaleMcpOwnerAccess = Config.String("T3CODE_TAILSCALE_MCP_OWNER_ACCESS").pipe(
  Config.withDefault(""),
);

const isLoopbackRedirect = (redirectUri: string) => {
  try {
    const url = new URL(redirectUri);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
};

export const TailscalePairingRefusal = Schema.Literals([
  "disabled",
  "origin_not_allowed",
  "no_tailnet_identity",
  "tailscale_unavailable",
  "tagged",
  "not_owner",
  "revoked",
]);
export type TailscalePairingRefusal = typeof TailscalePairingRefusal.Type;

export class TailscalePairingRefusedError extends Schema.TaggedError<TailscalePairingRefusedError>()(
  "TailscalePairingRefusedError",
  { reason: TailscalePairingRefusal },
) {
  override get message(): string {
    return `Tailscale pairing was refused (${this.reason}).`;
  }
}

export class TailscalePairingStoreError extends Schema.TaggedError<TailscalePairingStoreError>()(
  "TailscalePairingStoreError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to read or write Tailscale pairing state.";
  }
}

export class TailscaleLookupError extends Schema.TaggedError<TailscaleLookupError>()(
  "TailscaleLookupError",
  {
    // tailscaled answered that it has no node for the address.
    unknownPeer: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return this.unknownPeer
      ? "tailscaled has no node for this address."
      : "Could not ask tailscaled about this connection.";
  }
}

/** What tailscaled says about this machine and about a connection's source. */
export class TailscaleNodeLookup extends Context.Service<
  TailscaleNodeLookup,
  {
    readonly host: Effect.Effect<TailscaleHostIdentity, TailscaleLookupError>;
    readonly whois: (address: string) => Effect.Effect<TailscalePeerIdentity, TailscaleLookupError>;
    readonly peers: Effect.Effect<readonly TailscaleStatusPeer[], TailscaleLookupError>;
  }
>()("t3/auth/TailscalePairing/TailscaleNodeLookup") {}

const layerNodeLookup = Layer.effect(
  TailscaleNodeLookup,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return TailscaleNodeLookup.of({
      host: readTailscaleHostIdentity.pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.mapError((cause) => new TailscaleLookupError({ unknownPeer: false, cause })),
      ),
      whois: (address) =>
        readTailscaleWhois(address).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.mapError(
            (cause) =>
              new TailscaleLookupError({
                unknownPeer: cause._tag === "TailscaleCommandExitError",
                cause,
              }),
          ),
        ),
      peers: readTailscalePeers.pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.mapError((cause) => new TailscaleLookupError({ unknownPeer: false, cause })),
      ),
    });
  }),
);

const PROBE_TIMEOUT = Duration.seconds(2);

/** Another server's public descriptor; none when nothing there answers as T3 Code. */
export class EnvironmentProbe extends Context.Service<
  EnvironmentProbe,
  {
    readonly describe: (
      httpBaseUrl: string,
    ) => Effect.Effect<Option.Option<ExecutionEnvironmentDescriptor>>;
  }
>()("t3/auth/TailscalePairing/EnvironmentProbe") {}

const decodeDescriptor = Schema.decodeUnknownEffect(ExecutionEnvironmentDescriptor);

const layerEnvironmentProbe = Layer.effect(
  EnvironmentProbe,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    return EnvironmentProbe.of({
      describe: (httpBaseUrl) =>
        http
          .execute(HttpClientRequest.get(new URL("/.well-known/t3/environment", httpBaseUrl)))
          .pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap((response) => response.json),
            Effect.flatMap(decodeDescriptor),
            Effect.timeoutOption(PROBE_TIMEOUT),
            Effect.orElseSucceed(() => Option.none()),
          ),
    });
  }),
);

// Phones run clients only.
const CLIENT_ONLY_OS = new Set(["android", "iOS"]);

/** Where a node may serve T3 Code: its tailnet IPv4 on the given ports, then Tailscale Serve. */
const serverUrls = (peer: TailscaleStatusPeer, ports: ReadonlyArray<number>) => {
  const address = peer.addresses.find(isTailscaleIpv4Address);
  return [
    ...(address === undefined ? [] : ports.map((port) => `http://${address}:${port}/`)),
    ...(peer.dnsName === null ? [] : [`https://${peer.dnsName}/`]),
  ];
};

/** One of the owner's other machines, as tailscaled last heard from it. */
export interface TailnetMachine {
  readonly name: string;
  readonly os: string | null;
  readonly online: boolean;
  /** When an offline machine was last seen; null while online or never seen. */
  readonly lastSeen: string | null;
}

export interface TailscalePairingRequest {
  /** The TCP peer of the connection itself, never a forwarded header. */
  readonly peerAddress: string | undefined;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export const pairingRequestOf = (
  request: HttpServerRequest.HttpServerRequest,
): TailscalePairingRequest => {
  const socket = (request.source as { readonly socket?: { readonly remoteAddress?: unknown } })
    ?.socket;
  return {
    peerAddress: typeof socket?.remoteAddress === "string" ? socket.remoteAddress : undefined,
    headers: request.headers,
  };
};

const normalizeAddress = (address: string) =>
  address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address.toLowerCase();

const isLoopbackAddress = (address: string) =>
  address.startsWith("127.") || address === "::1" || address === "localhost";

const hostnameOf = (host: string): string | null => {
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  } catch {
    return null;
  }
};

/**
 * A browser request must name this server by address or tailnet name. Without
 * a pairing code to guard it, a page that rebinds its own domain to a tailnet
 * address would otherwise count as same-origin.
 */
const isTailnetHostname = (hostname: string, magicDnsSuffix: string | null) =>
  /^\d{1,3}(\.\d{1,3}){3}$/u.test(hostname) ||
  hostname.includes(":") ||
  // MagicDNS short names have no dot; a public domain always does.
  !hostname.includes(".") ||
  (magicDnsSuffix !== null && hostname.endsWith(`.${magicDnsSuffix.toLowerCase()}`));

const isBrowserOriginAllowed = (
  headers: TailscalePairingRequest["headers"],
  trustedOrigins: ReadonlySet<string>,
  magicDnsSuffix: string | null,
) => {
  const origin = headers.origin;
  // Browsers send Origin on every POST, so its absence means a native client.
  if (origin === undefined) return true;
  if (trustedOrigins.has(origin)) return true;
  const host = headers.host;
  if (host === undefined) return false;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  const hostname = hostnameOf(originUrl.host);
  return (
    originUrl.host.toLowerCase() === host.toLowerCase() &&
    hostname !== null &&
    isTailnetHostname(hostname, magicDnsSuffix)
  );
};

const NodeBlockStateRow = Schema.Struct({
  subject: Schema.String,
  label: Schema.NullOr(Schema.String),
  lastIssuedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  lastRevokedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
type NodeBlockStateRow = typeof NodeBlockStateRow.Type;

export interface BlockedTailscaleNode {
  readonly subject: string;
  /** A device pairing or an MCP agent's automatic approval. */
  readonly kind: "device" | "mcp";
  readonly stableNodeId: string;
  readonly label: string | null;
  readonly revokedAt: DateTime.Utc;
}

/**
 * Revoking any session of a node, after the node's newest session was issued,
 * blocks the node. Replacing a session revokes it at the instant its
 * successor is issued, which is not a revocation by the user.
 */
const isBlocked = (
  row: NodeBlockStateRow,
): row is NodeBlockStateRow & {
  readonly lastRevokedAt: DateTime.Utc;
} =>
  row.lastRevokedAt !== null &&
  (row.lastIssuedAt === null ||
    row.lastRevokedAt.epochMilliseconds > row.lastIssuedAt.epochMilliseconds);

/**
 * Revocation state of the sessions Tailscale pairing issued, kept in the
 * existing `auth_sessions` table: a fork migration would collide with
 * upstream's numbered ones.
 */
export const makeBlockStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const authSessions = yield* AuthSessions.AuthSessionRepository;
  const crypto = yield* Crypto.Crypto;

  const nodeStateRows = SqlSchema.findAll({
    Request: Schema.Struct({ subject: Schema.NullOr(Schema.String) }),
    Result: NodeBlockStateRow,
    execute: ({ subject }) =>
      sql`
        SELECT
          node.subject AS "subject",
          (
            SELECT latest.client_label FROM auth_sessions AS latest
            WHERE latest.subject = node.subject
            ORDER BY latest.issued_at DESC
            LIMIT 1
          ) AS "label",
          MAX(node.issued_at) AS "lastIssuedAt",
          MAX(
            CASE
              WHEN node.revoked_at IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM auth_sessions AS successor
                WHERE successor.issued_at = node.revoked_at
              ) THEN node.revoked_at
            END
          ) AS "lastRevokedAt"
        FROM auth_sessions AS node
        WHERE ${
          subject === null
            ? sql`(node.subject LIKE ${`${TAILSCALE_SESSION_SUBJECT_PREFIX}%`}
                OR node.subject LIKE ${`${TAILSCALE_MCP_SUBJECT_PREFIX}%`})`
            : sql`node.subject = ${subject}`
        }
        GROUP BY node.subject
      `,
  });

  const toBlockedNode = (row: NodeBlockStateRow): BlockedTailscaleNode | null => {
    if (!isBlocked(row)) return null;
    const kind = row.subject.startsWith(TAILSCALE_MCP_SUBJECT_PREFIX) ? "mcp" : "device";
    const prefix = kind === "mcp" ? TAILSCALE_MCP_SUBJECT_PREFIX : TAILSCALE_SESSION_SUBJECT_PREFIX;
    return {
      subject: row.subject,
      kind,
      stableNodeId: row.subject.slice(prefix.length),
      label: row.label,
      revokedAt: row.lastRevokedAt,
    };
  };

  const isNodeBlocked = (subject: string) =>
    nodeStateRows({ subject }).pipe(
      Effect.map((rows) => rows.some((row) => toBlockedNode(row) !== null)),
      Effect.mapError((cause) => new TailscalePairingStoreError({ cause })),
    );

  const listBlocked = nodeStateRows({ subject: null }).pipe(
    Effect.map((rows) =>
      rows.flatMap((row) => {
        const blocked = toBlockedNode(row);
        return blocked === null ? [] : [blocked];
      }),
    ),
    Effect.mapError((cause) => new TailscalePairingStoreError({ cause })),
  );

  /**
   * Records an already-expired session for the node. It is newer than every
   * revocation, so the node pairs again, and it can never authenticate.
   */
  const unblock = Effect.fn("TailscalePairing.unblock")(
    function* (node: BlockedTailscaleNode) {
      const now = yield* DateTime.now;
      yield* authSessions.create({
        sessionId: AuthSessionId.make(yield* crypto.randomUUIDv4()),
        subject: node.subject,
        scopes: [],
        method: "bearer-access-token",
        client: {
          label: node.label,
          ipAddress: null,
          userAgent: null,
          deviceType: "unknown",
          os: null,
          browser: null,
        },
        issuedAt: now,
        expiresAt: now,
      });
    },
    Effect.mapError((cause) => new TailscalePairingStoreError({ cause })),
  );

  return { isNodeBlocked, listBlocked, unblock };
});

export class TailscalePairing extends Context.Service<
  TailscalePairing,
  {
    readonly issueCredential: (
      request: TailscalePairingRequest,
    ) => Effect.Effect<
      AuthPairingCredentialResult,
      | TailscalePairingRefusedError
      | TailscalePairingStoreError
      | EnvironmentAuth.ServerAuthInternalError
    >;
    /**
     * The access an MCP sign-in from an allowed tagged node gets without a
     * person, as the subject its session records; none leaves it for the
     * approval page.
     */
    readonly mcpAutoApproval: (
      request: TailscalePairingRequest,
      redirectUri: string,
    ) => Effect.Effect<
      Option.Option<{
        readonly access: AuthMcpClientAccess;
        readonly subject: string;
        readonly nodeName: string;
      }>
    >;
    /**
     * Other T3 Code servers on the owner's online, untagged machines, so a
     * client connected here can add them without typing an address.
     */
    readonly discoverServers: () => Effect.Effect<ReadonlyArray<TailnetServer>>;
    /**
     * The access a token-less MCP request from one of the owner's untagged
     * machines gets, as the subject its session records; none answers 401.
     */
    readonly mcpOwnerClient: (request: TailscalePairingRequest) => Effect.Effect<
      Option.Option<{
        readonly access: AuthMcpClientAccess;
        readonly subject: string;
        readonly nodeName: string;
      }>
    >;
    /** The owner's other computers, without probing them; none without tailscaled. */
    readonly ownerMachines: () => Effect.Effect<Option.Option<ReadonlyArray<TailnetMachine>>>;
  }
>()("t3/auth/TailscalePairing") {}

/**
 * What McpOAuth answers an authorize request from an allowed tagged node with, without
 * the approval page; none when the request needs a person or the service is not built.
 */
export const approveMcpSignIn = <A>(
  service: Option.Option<TailscalePairing["Service"]>,
  request: HttpServerRequest.HttpServerRequest,
  redirectUri: string,
  approve: (approval: {
    readonly access: AuthMcpClientAccess;
    readonly subject: string;
    readonly nodeName: string;
  }) => Effect.Effect<A>,
): Effect.Effect<Option.Option<A>> =>
  Option.match(service, {
    onNone: () => Effect.succeedNone,
    onSome: (pairing) =>
      pairing.mcpAutoApproval(pairingRequestOf(request), redirectUri).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeedNone,
            onSome: (approval) => Effect.asSome(approve(approval)),
          }),
        ),
      ),
  });

/** @public */
export const make = Effect.gen(function* () {
  const enabled = yield* TailscalePairingEnabled;
  const lookup = yield* TailscaleNodeLookup;
  const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const config = yield* ServerConfig.ServerConfig;
  const blocks = yield* makeBlockStore;
  const probe = yield* EnvironmentProbe;
  const environmentIdentity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const mcpTags = parseMcpTagAccess(yield* TailscaleMcpTags);
  if (mcpTags.skipped.length > 0) {
    yield* Effect.logWarning("Ignored unreadable T3CODE_TAILSCALE_MCP_TAGS entries.", {
      entries: mcpTags.skipped,
    });
  }
  const ownerAccessSetting = (yield* TailscaleMcpOwnerAccess).trim();
  const ownerMcpAccess = isMcpClientAccess(ownerAccessSetting) ? ownerAccessSetting : undefined;
  if (ownerAccessSetting !== "" && ownerMcpAccess === undefined) {
    yield* Effect.logWarning("Ignored an unreadable T3CODE_TAILSCALE_MCP_OWNER_ACCESS.", {
      value: ownerAccessSetting,
    });
  }

  const trustedOrigins = new Set<string>([
    ...(config.devUrl ? [config.devUrl.origin] : []),
    ...DESKTOP_RENDERER_ORIGINS,
    ...config.devAllowedOrigins,
  ]);

  const refuse = (reason: TailscalePairingRefusal) =>
    Effect.logInfo("Refused Tailscale pairing.").pipe(
      Effect.annotateLogs({ reason }),
      Effect.andThen(Effect.fail(new TailscalePairingRefusedError({ reason }))),
    );

  /**
   * The tailnet address the request came from. Serve connects from this machine and
   * replaces any `X-Forwarded-For` and `Tailscale-User-*` a client sends, so a local
   * peer is trusted only for those; whois on it would name this host's own owner.
   */
  const resolveSource = (
    request: TailscalePairingRequest,
    host: TailscaleHostIdentity,
    options: { readonly requireServedUser: boolean },
  ) => {
    if (request.peerAddress === undefined) return null;
    const peer = normalizeAddress(request.peerAddress);
    const isLocal = (address: string) =>
      isLoopbackAddress(address) || host.addresses.includes(address);
    if (!isLocal(peer)) {
      return isTailscaleAddress(peer) ? { address: peer, servedLogin: undefined } : null;
    }
    const forwarded = request.headers["x-forwarded-for"]?.trim();
    const servedLogin = request.headers["tailscale-user-login"];
    if (
      request.headers["tailscale-funnel-request"] !== undefined ||
      forwarded === undefined ||
      (options.requireServedUser && servedLogin === undefined)
    ) {
      return null;
    }
    const address = normalizeAddress(forwarded);
    return isTailscaleAddress(address) && !isLocal(address) ? { address, servedLogin } : null;
  };

  const issueCredential: TailscalePairing["Service"]["issueCredential"] = Effect.fn(
    "TailscalePairing.issueCredential",
  )(function* (request) {
    if (!enabled) return yield* refuse("disabled");
    const host = yield* lookup.host.pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not read the Tailscale host.", { cause }).pipe(
          Effect.andThen(refuse("tailscale_unavailable")),
        ),
      ),
    );
    // A tagged host has no owning account to match devices against.
    if (host.ownerLoginName === null) return yield* refuse("tailscale_unavailable");
    if (!isBrowserOriginAllowed(request.headers, trustedOrigins, host.magicDnsSuffix)) {
      return yield* refuse("origin_not_allowed");
    }
    const source = resolveSource(request, host, { requireServedUser: true });
    if (source === null) return yield* refuse("no_tailnet_identity");
    const peer = yield* lookup
      .whois(source.address)
      .pipe(
        Effect.catch((error) =>
          error.unknownPeer
            ? refuse("no_tailnet_identity")
            : Effect.logWarning("Could not ask tailscaled about a peer.", { cause: error }).pipe(
                Effect.andThen(refuse("tailscale_unavailable")),
              ),
        ),
      );
    if (peer.tags.length > 0) return yield* refuse("tagged");
    if (peer.loginName !== host.ownerLoginName) return yield* refuse("not_owner");
    if (source.servedLogin !== undefined && source.servedLogin !== peer.loginName) {
      return yield* refuse("not_owner");
    }
    const subject = tailscaleSessionSubject(peer.stableNodeId);
    if (yield* blocks.isNodeBlocked(subject)) return yield* refuse("revoked");

    const issued = yield* environmentAuth.createPairingLink({
      scopes: AuthStandardClientScopes,
      subject,
      label: peer.nodeName,
      ttl: PAIRING_CREDENTIAL_TTL,
    });
    yield* Effect.logInfo("Issued a Tailscale pairing credential.").pipe(
      Effect.annotateLogs({ node: peer.nodeName }),
    );
    return {
      id: issued.id,
      credential: issued.credential,
      ...(issued.label ? { label: issued.label } : {}),
      expiresAt: issued.expiresAt,
    } satisfies AuthPairingCredentialResult;
  });

  const mcpAutoApproval: TailscalePairing["Service"]["mcpAutoApproval"] = Effect.fn(
    "TailscalePairing.mcpAutoApproval",
  )(function* (request, redirectUri) {
    if (mcpTags.grants.size === 0) return Option.none();
    const decline = (reason: string) =>
      Effect.logInfo("Left an MCP sign-in for manual approval.").pipe(
        Effect.annotateLogs({ reason }),
        Effect.as(Option.none()),
      );
    // The code then only reaches the machine that asked for it; a page on
    // another site would need an https redirect, which a person approves.
    if (!isLoopbackRedirect(redirectUri)) return yield* decline("redirect_not_loopback");
    const host = yield* Effect.option(lookup.host);
    if (Option.isNone(host)) return yield* decline("tailscale_unavailable");
    // Serve sends no user for a tagged node, so only its forwarded address counts.
    const source = resolveSource(request, host.value, { requireServedUser: false });
    if (source === null) return yield* decline("no_tailnet_identity");
    const peer = yield* Effect.option(lookup.whois(source.address));
    if (Option.isNone(peer)) return yield* decline("no_tailnet_identity");
    const granted = peer.value.tags.flatMap((tag) => {
      const access = mcpTags.grants.get(tag);
      return access === undefined ? [] : [access];
    });
    const access = granted.reduce<AuthMcpClientAccess | undefined>(
      (lowest, candidate) =>
        lowest === undefined ||
        MCP_ACCESS_ORDER.indexOf(candidate) < MCP_ACCESS_ORDER.indexOf(lowest)
          ? candidate
          : lowest,
      undefined,
    );
    if (access === undefined) return yield* decline("tag_not_allowed");
    const subject = tailscaleMcpSubject(peer.value.stableNodeId);
    // An unreadable revocation state must not approve anything.
    if (yield* blocks.isNodeBlocked(subject).pipe(Effect.orElseSucceed(() => true))) {
      return yield* decline("revoked");
    }
    yield* Effect.logInfo("Approved an MCP sign-in for a tagged tailnet node.").pipe(
      Effect.annotateLogs({ node: peer.value.nodeName, access }),
    );
    return Option.some({ access, subject, nodeName: peer.value.nodeName });
  });

  const ports = [...new Set([ServerConfig.DEFAULT_PORT, config.port])];

  const findServer = (peer: TailscaleStatusPeer) =>
    Effect.forEach(serverUrls(peer, ports), probe.describe, { concurrency: "unbounded" }).pipe(
      Effect.map((descriptors) =>
        descriptors.flatMap((descriptor, index) =>
          Option.isSome(descriptor)
            ? [
                {
                  environmentId: descriptor.value.environmentId,
                  label: descriptor.value.label,
                  httpBaseUrl: serverUrls(peer, ports)[index]!,
                  nodeName: peer.nodeName,
                } satisfies TailnetServer,
              ]
            : [],
        ),
      ),
    );

  const discoverServers: TailscalePairing["Service"]["discoverServers"] = Effect.fn(
    "TailscalePairing.discoverServers",
  )(function* () {
    if (!enabled) return [];
    const host = yield* Effect.option(lookup.host);
    const peers = yield* Effect.option(lookup.peers);
    if (Option.isNone(host) || Option.isNone(peers) || host.value.ownerLoginName === null) {
      return [];
    }
    const owner = host.value.ownerLoginName;
    const ownEnvironmentId = yield* environmentIdentity.getEnvironmentId;
    const found = yield* Effect.forEach(
      // Tagged nodes belong to the `tagged-devices` account, so the owner check leaves them out.
      peers.value.filter(
        (peer) => peer.online && peer.loginName === owner && !CLIENT_ONLY_OS.has(peer.os ?? ""),
      ),
      findServer,
      { concurrency: "unbounded" },
    );
    // The first address that answered wins, so a direct route beats Serve.
    const byEnvironment = new Map<string, TailnetServer>();
    for (const server of found.flat()) {
      if (server.environmentId !== ownEnvironmentId && !byEnvironment.has(server.environmentId)) {
        byEnvironment.set(server.environmentId, server);
      }
    }
    return [...byEnvironment.values()];
  });

  const mcpOwnerClient: TailscalePairing["Service"]["mcpOwnerClient"] = Effect.fn(
    "TailscalePairing.mcpOwnerClient",
  )(function* (request) {
    if (ownerMcpAccess === undefined) return Option.none();
    const host = yield* Effect.option(lookup.host);
    if (Option.isNone(host) || host.value.ownerLoginName === null) return Option.none();
    const source = resolveSource(request, host.value, { requireServedUser: false });
    if (source === null) return Option.none();
    const peer = yield* Effect.option(lookup.whois(source.address));
    if (
      Option.isNone(peer) ||
      peer.value.tags.length > 0 ||
      peer.value.loginName !== host.value.ownerLoginName ||
      (source.servedLogin !== undefined && source.servedLogin !== peer.value.loginName)
    ) {
      return Option.none();
    }
    const subject = tailscaleMcpSubject(peer.value.stableNodeId);
    // An unreadable revocation state must not let anything in.
    if (yield* blocks.isNodeBlocked(subject).pipe(Effect.orElseSucceed(() => true))) {
      return Option.none();
    }
    return Option.some({ access: ownerMcpAccess, subject, nodeName: peer.value.nodeName });
  });

  const ownerMachines: TailscalePairing["Service"]["ownerMachines"] = Effect.fn(
    "TailscalePairing.ownerMachines",
  )(function* () {
    const host = yield* Effect.option(lookup.host);
    const peers = yield* Effect.option(lookup.peers);
    if (Option.isNone(host) || Option.isNone(peers) || host.value.ownerLoginName === null) {
      return Option.none();
    }
    const owner = host.value.ownerLoginName;
    return Option.some(
      peers.value
        .filter(
          (peer) =>
            peer.loginName === owner &&
            peer.tags.length === 0 &&
            !CLIENT_ONLY_OS.has(peer.os ?? ""),
        )
        .map((peer) => ({
          name: peer.nodeName,
          os: peer.os,
          online: peer.online,
          lastSeen: peer.online ? null : (peer.lastSeen ?? null),
        })),
    );
  });

  return TailscalePairing.of({
    issueCredential,
    mcpAutoApproval,
    discoverServers,
    mcpOwnerClient,
    ownerMachines,
  });
});

export const layer = Layer.effect(TailscalePairing, make).pipe(
  Layer.provide(layerNodeLookup),
  Layer.provide(layerEnvironmentProbe),
);
