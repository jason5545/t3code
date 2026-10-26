import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  isTailscaleIpv4Address,
  readTailscaleOutput,
  TailscaleStatusParseError,
} from "./tailscale.ts";

/*
 * Fork patch 7: tailnet identities for device pairing, tagged MCP sign-ins and
 * tailnet server discovery, read from `tailscale status --json` and `tailscale whois`.
 */

const TAILSCALE_IPV6_PREFIX = "fd7a:115c:a1e0:";

/** Tailscale's CGNAT IPv4 range or its fd7a:115c:a1e0::/48 IPv6 range. */
export function isTailscaleAddress(address: string): boolean {
  return isTailscaleIpv4Address(address) || address.toLowerCase().startsWith(TAILSCALE_IPV6_PREFIX);
}

const TailscaleHostStatusJson = Schema.Struct({
  MagicDNSSuffix: Schema.optional(Schema.Unknown),
  Self: Schema.optional(
    Schema.Struct({
      UserID: Schema.optional(Schema.Unknown),
      Tags: Schema.optional(Schema.Unknown),
      TailscaleIPs: Schema.optional(Schema.Unknown),
    }),
  ),
  User: Schema.optional(Schema.Unknown),
});

const decodeTailscaleHostStatusJson = Schema.decodeEffect(
  Schema.fromJsonString(TailscaleHostStatusJson),
);

export interface TailscaleHostIdentity {
  /** The account that owns this machine; null when the machine is tagged or reports no owner. */
  readonly ownerLoginName: string | null;
  readonly addresses: readonly string[];
  readonly magicDnsSuffix: string | null;
}

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const isNonEmptyArray = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

export const parseTailscaleHostIdentity = (
  rawStatusJson: string,
): Effect.Effect<TailscaleHostIdentity, TailscaleStatusParseError> =>
  decodeTailscaleHostStatusJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((status) => {
      const self = status.Self;
      // User IDs are int64s that JSON.parse may round; both sides round alike,
      // so match the profile by its decoded `ID` instead of the map key.
      const owner =
        self === undefined || isNonEmptyArray(self.Tags) || typeof status.User !== "object"
          ? undefined
          : Object.values(status.User ?? {}).find(
              (profile): profile is { readonly LoginName?: unknown } =>
                typeof profile === "object" &&
                profile !== null &&
                (profile as { readonly ID?: unknown }).ID === self.UserID,
            );
      const rawAddresses = self?.TailscaleIPs;
      return {
        ownerLoginName: nonEmptyString(owner?.LoginName),
        addresses: Array.isArray(rawAddresses)
          ? rawAddresses.filter(
              (address): address is string =>
                typeof address === "string" && isTailscaleAddress(address),
            )
          : [],
        magicDnsSuffix: nonEmptyString(status.MagicDNSSuffix)?.replace(/\.$/u, "") ?? null,
      };
    }),
  );

export const readTailscaleHostIdentity = readTailscaleOutput("status", ["status", "--json"]).pipe(
  Effect.flatMap(parseTailscaleHostIdentity),
);

const TailscaleWhoisJson = Schema.Struct({
  Node: Schema.Struct({
    StableID: Schema.NonEmptyString,
    ComputedName: Schema.optional(Schema.Unknown),
    Name: Schema.optional(Schema.Unknown),
    Tags: Schema.optional(Schema.Unknown),
  }),
  UserProfile: Schema.optional(
    Schema.Struct({
      LoginName: Schema.optional(Schema.Unknown),
    }),
  ),
});

const decodeTailscaleWhoisJson = Schema.decodeEffect(Schema.fromJsonString(TailscaleWhoisJson));

export interface TailscalePeerIdentity {
  readonly stableNodeId: string;
  readonly nodeName: string;
  readonly tags: readonly string[];
  /** Tagged nodes report the placeholder account `tagged-devices`. */
  readonly loginName: string | null;
}

export const parseTailscaleWhois = (
  rawWhoisJson: string,
): Effect.Effect<TailscalePeerIdentity, TailscaleStatusParseError> =>
  decodeTailscaleWhoisJson(rawWhoisJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map(({ Node, UserProfile }) => ({
      stableNodeId: Node.StableID,
      nodeName:
        nonEmptyString(Node.ComputedName) ??
        nonEmptyString(Node.Name)?.split(".")[0] ??
        Node.StableID,
      tags: Array.isArray(Node.Tags)
        ? Node.Tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      loginName: nonEmptyString(UserProfile?.LoginName),
    })),
  );

/** Which tailnet node and account own a connection's source address, as tailscaled sees it. */
export const readTailscaleWhois = (address: string) =>
  readTailscaleOutput("whois", ["whois", "--json", address]).pipe(
    Effect.flatMap(parseTailscaleWhois),
  );

const TailscalePeersStatusJson = Schema.Struct({
  Peer: Schema.optional(Schema.Unknown),
  User: Schema.optional(Schema.Unknown),
});

const decodeTailscalePeersStatusJson = Schema.decodeEffect(
  Schema.fromJsonString(TailscalePeersStatusJson),
);

export interface TailscaleStatusPeer {
  readonly stableNodeId: string;
  readonly nodeName: string;
  /** MagicDNS name without its trailing dot; null when MagicDNS is off. */
  readonly dnsName: string | null;
  readonly addresses: readonly string[];
  readonly online: boolean;
  readonly tags: readonly string[];
  readonly os: string | null;
  readonly loginName: string | null;
  /** When tailscaled last heard from an offline peer; absent while it is online. */
  readonly lastSeen?: string;
}

const stringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/** The other nodes `tailscale status --json` lists, with the account each belongs to. */
export const parseTailscalePeers = (
  rawStatusJson: string,
): Effect.Effect<readonly TailscaleStatusPeer[], TailscaleStatusParseError> =>
  decodeTailscalePeersStatusJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((status) => {
      const profiles = Object.values(
        typeof status.User === "object" && status.User !== null ? status.User : {},
      ) as ReadonlyArray<{ readonly ID?: unknown; readonly LoginName?: unknown }>;
      const peers = Object.values(
        typeof status.Peer === "object" && status.Peer !== null ? status.Peer : {},
      ) as ReadonlyArray<Record<string, unknown>>;
      return peers.flatMap((peer) => {
        const stableNodeId = nonEmptyString(peer.ID);
        if (stableNodeId === null) return [];
        const dnsName = nonEmptyString(peer.DNSName)?.replace(/\.$/u, "") ?? null;
        const owner = profiles.find((profile) => profile.ID === peer.UserID);
        // Online peers report Go's zero time.
        const lastSeen = nonEmptyString(peer.LastSeen);
        return [
          {
            stableNodeId,
            nodeName: dnsName?.split(".")[0] ?? nonEmptyString(peer.HostName) ?? stableNodeId,
            dnsName,
            addresses: stringArray(peer.TailscaleIPs).filter(isTailscaleAddress),
            online: peer.Online === true,
            tags: stringArray(peer.Tags),
            os: nonEmptyString(peer.OS),
            loginName: nonEmptyString(owner?.LoginName),
            ...(lastSeen !== null && !lastSeen.startsWith("0001-") && { lastSeen }),
          },
        ];
      });
    }),
  );

export const readTailscalePeers = readTailscaleOutput("status", ["status", "--json"]).pipe(
  Effect.flatMap(parseTailscalePeers),
);
