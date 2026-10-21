import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export const DEFAULT_TAILSCALE_SERVE_PORT = 443;
/**
 * Bounds `tailscale status` and `tailscale debug prefs`. Allows the 1.8-2.6 s
 * `tailscale status` has been measured at when T3 Code spawns it on Windows.
 * A CLI that never answers takes longer than this to fail, because the kill
 * that follows the timeout also takes time (`taskkill` on Windows).
 */
const TAILSCALE_STATUS_TIMEOUT = Duration.millis(3_500);
const TAILSCALE_SERVE_TIMEOUT = Duration.seconds(10);
const TAILSCALE_PROBE_TIMEOUT = Duration.millis(2_500);

const tailscaleCommandForPlatform = (platform: NodeJS.Platform): "tailscale" | "tailscale.exe" =>
  platform === "win32" ? "tailscale.exe" : "tailscale";

const TailscaleCommandContext = {
  executable: Schema.Literals(["tailscale", "tailscale.exe"]),
  subcommand: Schema.Literals(["status", "serve", "debug", "whois"]),
  argumentCount: Schema.Number,
};

/**
 * Failure kinds we can name without quoting the CLI. Anything unrecognized
 * becomes "unknown" rather than falling back to raw text — stderr can contain
 * auth keys (`tskey-…`) and node names, and these labels are logged.
 */
export const TailscaleStderrDiagnostic = Schema.Literals([
  "no-existing-handler",
  "not-logged-in",
  "permission-denied",
  "unknown",
]);
export type TailscaleStderrDiagnostic = typeof TailscaleStderrDiagnostic.Type;

const STDERR_DIAGNOSTIC_PATTERNS: ReadonlyArray<
  readonly [RegExp, Exclude<TailscaleStderrDiagnostic, "unknown">]
> = [
  [/handler does not exist/i, "no-existing-handler"],
  [/not logged in|logged out|needs? login/i, "not-logged-in"],
  [/permission denied|access denied|must be root|operation not permitted/i, "permission-denied"],
];

const stderrDiagnosticOf = (stderr: string): TailscaleStderrDiagnostic | undefined => {
  if (stderr.trim().length === 0) {
    return undefined;
  }
  return STDERR_DIAGNOSTIC_PATTERNS.find(([pattern]) => pattern.test(stderr))?.[1] ?? "unknown";
};

export class TailscaleCommandSpawnError extends Schema.TaggedError<TailscaleCommandSpawnError>()(
  "TailscaleCommandSpawnError",
  {
    ...TailscaleCommandContext,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to spawn tailscale ${this.subcommand}.`;
  }
}

class TailscaleCommandOutputError extends Schema.TaggedError<TailscaleCommandOutputError>()(
  "TailscaleCommandOutputError",
  {
    ...TailscaleCommandContext,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read output from tailscale ${this.subcommand}.`;
  }
}

export class TailscaleCommandExitError extends Schema.TaggedError<TailscaleCommandExitError>()(
  "TailscaleCommandExitError",
  {
    ...TailscaleCommandContext,
    exitCode: Schema.Number,
    stdoutLength: Schema.optional(Schema.Number),
    stderrLength: Schema.Number,
    stderrDiagnostic: Schema.optional(TailscaleStderrDiagnostic),
  },
) {
  override get message(): string {
    return `tailscale ${this.subcommand} exited with code ${this.exitCode}.`;
  }
}

export class TailscaleCommandTimeoutError extends Schema.TaggedError<TailscaleCommandTimeoutError>()(
  "TailscaleCommandTimeoutError",
  {
    ...TailscaleCommandContext,
    timeoutMs: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `tailscale ${this.subcommand} timed out after ${this.timeoutMs}ms.`;
  }
}

export type TailscaleCommandError =
  | TailscaleCommandSpawnError
  | TailscaleCommandOutputError
  | TailscaleCommandExitError
  | TailscaleCommandTimeoutError;

export class TailscaleStatusParseError extends Schema.TaggedError<TailscaleStatusParseError>()(
  "TailscaleStatusParseError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to decode tailscale status JSON.";
  }
}

const TailscaleStatusSelf = Schema.Struct({
  DNSName: Schema.optional(Schema.Unknown),
  TailscaleIPs: Schema.optional(Schema.Unknown),
  CapMap: Schema.optional(Schema.Unknown),
});

const TailscaleStatusJson = Schema.Struct({
  Self: Schema.optional(TailscaleStatusSelf),
});

export type TailscaleStatusJson = typeof TailscaleStatusJson.Type;

export interface TailscaleStatus {
  readonly magicDnsName: string | null;
  readonly tailnetIpv4Addresses: readonly string[];
  /**
   * `tailscale serve --https` needs the `https` capability, which the control
   * plane grants once the tailnet enables HTTPS certificates. `null` when the
   * CLI reports no capability map (older CLI), so callers still attempt serve.
   */
  readonly httpsServeEnabled: boolean | null;
}

const collectStdout = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const collectStderr = collectStdout;

const decodeTailscaleStatusJson = Schema.decodeEffect(Schema.fromJsonString(TailscaleStatusJson));

function normalizeMagicDnsName(status: TailscaleStatusJson): string | null {
  const dnsName = status.Self?.DNSName;
  if (typeof dnsName !== "string") {
    return null;
  }

  const normalized = dnsName.trim().replace(/\.$/u, "");
  return normalized.length > 0 ? normalized : null;
}

export const parseTailscaleMagicDnsName = (
  rawStatusJson: string,
): Effect.Effect<string | null, TailscaleStatusParseError> =>
  decodeTailscaleStatusJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map(normalizeMagicDnsName),
  );

export function isTailscaleIpv4Address(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const [first, second, third, fourth] = parts.map((part) => Number.parseInt(part, 10));
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    [first, second, third, fourth].some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return first === 100 && second >= 64 && second <= 127;
}

export const parseTailscaleStatus = (
  rawStatusJson: string,
): Effect.Effect<TailscaleStatus, TailscaleStatusParseError> =>
  decodeTailscaleStatusJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((parsed) => {
      const rawIps = parsed.Self?.TailscaleIPs;
      const tailnetIpv4Addresses: Array<string> = [];
      if (Array.isArray(rawIps)) {
        for (const address of rawIps) {
          if (typeof address === "string" && isTailscaleIpv4Address(address)) {
            tailnetIpv4Addresses.push(address);
          }
        }
      }

      const capMap = parsed.Self?.CapMap;
      return {
        magicDnsName: normalizeMagicDnsName(parsed),
        tailnetIpv4Addresses,
        httpsServeEnabled:
          typeof capMap === "object" && capMap !== null && !Array.isArray(capMap)
            ? Object.hasOwn(capMap, "https")
            : null,
      };
    }),
  );

const readTailscaleOutput = Effect.fn("tailscale.readTailscaleOutput")(function* (
  subcommand: "status" | "debug" | "whois",
  args: readonly string[],
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const hostPlatform = yield* HostProcess.Platform;
  const executable = tailscaleCommandForPlatform(hostPlatform);
  const commandContext = {
    executable,
    subcommand,
    argumentCount: args.length,
  };
  return yield* Effect.gen(function* () {
    const child = yield* spawner.spawn(ChildProcess.make(executable, [...args])).pipe(
      Effect.mapError((cause) => new TailscaleCommandSpawnError({ ...commandContext, cause })),
      // Spawning can also fail as a defect rather than a typed error - a
      // non-directory entry on PATH makes node throw ENOTDIR synchronously.
      // `mapError` never sees that, so it would escape as an uncaught error.
      Effect.catchDefect((cause) =>
        Effect.fail(new TailscaleCommandSpawnError({ ...commandContext, cause })),
      ),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStdout(child.stdout),
        collectStderr(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError((cause) => new TailscaleCommandOutputError({ ...commandContext, cause })),
    );
    if (exitCode !== 0) {
      return yield* new TailscaleCommandExitError({
        ...commandContext,
        exitCode,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
        ...(stderrDiagnosticOf(stderr) !== undefined
          ? { stderrDiagnostic: stderrDiagnosticOf(stderr) }
          : {}),
      });
    }
    return stdout;
  }).pipe(
    Effect.scoped,
    Effect.timeout(TAILSCALE_STATUS_TIMEOUT),
    Effect.catchTags({
      TimeoutError: (cause) =>
        Effect.fail(
          new TailscaleCommandTimeoutError({
            ...commandContext,
            timeoutMs: Duration.toMillis(TAILSCALE_STATUS_TIMEOUT),
            cause,
          }),
        ),
    }),
  );
});

export const readTailscaleStatus = readTailscaleOutput("status", ["status", "--json"]).pipe(
  Effect.flatMap(parseTailscaleStatus),
);

const TailscaleExitNodeJson = Schema.Struct({
  ExitNodeStatus: Schema.optional(Schema.Struct({ Online: Schema.optional(Schema.Unknown) })),
  Peer: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        ExitNode: Schema.optional(Schema.Unknown),
        HostName: Schema.optional(Schema.Unknown),
        DNSName: Schema.optional(Schema.Unknown),
      }),
    ),
  ),
});

const decodeTailscaleExitNodeJson = Schema.decodeEffect(
  Schema.fromJsonString(TailscaleExitNodeJson),
);

export interface TailscaleExitNode {
  readonly name: string | null;
  readonly online: boolean;
}

/**
 * `ExitNodeStatus` is present only while an exit node is in use, but it has no
 * name. The name comes from the peer marked `ExitNode: true`.
 */
export const parseTailscaleExitNode = (
  rawStatusJson: string,
): Effect.Effect<TailscaleExitNode | null, TailscaleStatusParseError> =>
  decodeTailscaleExitNodeJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((parsed) => {
      if (parsed.ExitNodeStatus === undefined) return null;
      const peer = Object.values(parsed.Peer ?? {}).find(
        (candidate) => candidate.ExitNode === true,
      );
      // The DNS label is the tailnet machine name; HostName is the OS name and ignores renames.
      const dnsLabel = typeof peer?.DNSName === "string" ? (peer.DNSName.split(".")[0] ?? "") : "";
      const hostName = typeof peer?.HostName === "string" ? peer.HostName.trim() : "";
      return {
        name: dnsLabel || hostName || null,
        online: parsed.ExitNodeStatus.Online === true,
      };
    }),
  );

export const readTailscaleExitNode = readTailscaleOutput("status", ["status", "--json"]).pipe(
  Effect.flatMap(parseTailscaleExitNode),
);

const TailscalePrefsJson = Schema.Struct({
  RunSSH: Schema.optional(Schema.Unknown),
  WantRunning: Schema.optional(Schema.Unknown),
});

const decodeTailscalePrefsJson = Schema.decodeEffect(Schema.fromJsonString(TailscalePrefsJson));

/**
 * `tailscale status --json` does not report this for the local node. `tailscale
 * down` clears WantRunning but keeps RunSSH, so check both.
 */
export const parseTailscaleSshEnabled = (
  rawPrefsJson: string,
): Effect.Effect<boolean, TailscaleStatusParseError> =>
  decodeTailscalePrefsJson(rawPrefsJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((prefs) => prefs.RunSSH === true && prefs.WantRunning !== false),
  );

export const readTailscaleSshEnabled = readTailscaleOutput("debug", ["debug", "prefs"]).pipe(
  Effect.flatMap(parseTailscaleSshEnabled),
);

export function buildTailscaleHttpsBaseUrl(input: {
  readonly magicDnsName: string;
  readonly servePort?: number;
}): string {
  const url = new URL(`https://${input.magicDnsName}`);
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  if (servePort !== DEFAULT_TAILSCALE_SERVE_PORT) {
    url.port = String(servePort);
  }
  url.pathname = "/";
  return url.toString();
}

const runTailscaleCommand = Effect.fn("tailscale.runTailscaleCommand")(function* (
  args: readonly string[],
  timeoutInput: Duration.Input,
): Effect.fn.Return<void, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const hostPlatform = yield* HostProcess.Platform;
  const executable = tailscaleCommandForPlatform(hostPlatform);
  const commandContext = {
    executable,
    subcommand: "serve" as const,
    argumentCount: args.length,
  };
  const timeout = Duration.fromInputUnsafe(timeoutInput);
  return yield* Effect.gen(function* () {
    const child = yield* spawner.spawn(ChildProcess.make(executable, args)).pipe(
      Effect.mapError((cause) => new TailscaleCommandSpawnError({ ...commandContext, cause })),
      Effect.catchDefect((cause) =>
        Effect.fail(new TailscaleCommandSpawnError({ ...commandContext, cause })),
      ),
    );
    const [stderr, exitCode] = yield* Effect.all(
      [collectStderr(child.stderr), child.exitCode.pipe(Effect.map(Number))],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError((cause) => new TailscaleCommandOutputError({ ...commandContext, cause })),
    );
    if (exitCode !== 0) {
      return yield* new TailscaleCommandExitError({
        ...commandContext,
        exitCode,
        stderrLength: stderr.length,
        ...(stderrDiagnosticOf(stderr) !== undefined
          ? { stderrDiagnostic: stderrDiagnosticOf(stderr) }
          : {}),
      });
    }
  }).pipe(
    Effect.scoped,
    Effect.timeout(timeout),
    Effect.catchTags({
      TimeoutError: (cause) =>
        Effect.fail(
          new TailscaleCommandTimeoutError({
            ...commandContext,
            timeoutMs: Duration.toMillis(timeout),
            cause,
          }),
        ),
    }),
  );
});

export const ensureTailscaleServe = (input: {
  readonly localPort: number;
  readonly servePort?: number;
  readonly localHost?: string;
}): Effect.Effect<void, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> => {
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  const localHost = input.localHost ?? "127.0.0.1";
  const args = ["serve", "--bg", `--https=${servePort}`, `http://${localHost}:${input.localPort}`];
  return runTailscaleCommand(args, TAILSCALE_SERVE_TIMEOUT);
};

export const disableTailscaleServe = Effect.fn("tailscale.disableTailscaleServe")(function* (
  input: {
    readonly servePort?: number;
  } = {},
): Effect.fn.Return<void, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> {
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  return yield* runTailscaleCommand(
    ["serve", `--https=${servePort}`, "off"],
    TAILSCALE_SERVE_TIMEOUT,
  );
});

export const probeTailscaleHttpsEndpoint = Effect.fn("tailscale.probeTailscaleHttpsEndpoint")(
  function* (input: { readonly baseUrl: string; readonly timeout?: Duration.Input }) {
    const client = yield* HttpClient.HttpClient;
    const response = yield* Effect.gen(function* () {
      const url = new URL("/.well-known/t3/environment", input.baseUrl);
      const request = HttpClientRequest.get(url.toString());
      return yield* client.execute(request);
    }).pipe(Effect.timeoutOption(input.timeout ?? TAILSCALE_PROBE_TIMEOUT));

    return Option.match(response, {
      onNone: () => false,
      onSome: (httpResponse) => httpResponse.status >= 200 && httpResponse.status < 300,
    });
  },
  Effect.orElseSucceed(() => false),
);

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
          },
        ];
      });
    }),
  );

export const readTailscalePeers = readTailscaleOutput("status", ["status", "--json"]).pipe(
  Effect.flatMap(parseTailscalePeers),
);
