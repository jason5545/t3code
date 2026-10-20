import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";
import * as HostProcess from "@t3tools/shared/HostProcess";

import {
  buildTailscaleHttpsBaseUrl,
  disableTailscaleServe,
  ensureTailscaleServe,
  isTailscaleAddress,
  isTailscaleIpv4Address,
  parseTailscaleHostIdentity,
  parseTailscaleMagicDnsName,
  parseTailscalePeers,
  parseTailscaleSshEnabled,
  parseTailscaleStatus,
  parseTailscaleWhois,
  readTailscaleSshEnabled,
  readTailscaleStatus,
  readTailscaleWhois,
  TAILSCALE_STATUS_TIMEOUT,
  TailscaleCommandExitError,
  TailscaleCommandSpawnError,
  TailscaleCommandTimeoutError,
  TailscaleStatusParseError,
} from "./tailscale.ts";

const encoder = new TextEncoder();

function assertCarriesNoSecret(error: object, secret: string): void {
  const seen = new WeakSet<object>();

  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      assert.notInclude(value, secret, `${path} leaked stderr`);
      return;
    }
    if (typeof value !== "object" || value === null || seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${String(index)}]`));
      return;
    }
    // `message` and `cause` are getters on Error subclasses, so they are not
    // own enumerable properties and Object.entries alone would skip them.
    walk((value as { message?: unknown }).message, `${path}.message`);
    walk((value as { cause?: unknown }).cause, `${path}.cause`);
    for (const [key, nested] of Object.entries(value)) {
      walk(nested, `${path}.${key}`);
    }
  };

  walk(error, "error");
}
const tailscaleStatusJson = `{"Self":{"DNSName":"desktop.tail.ts.net.","TailscaleIPs":["100.100.100.100","fd7a:115c:a1e0::1","192.168.1.20"]}}`;
const tailscaleStatusWithSingleIpJson = `{"Self":{"DNSName":"desktop.tail.ts.net.","TailscaleIPs":["100.90.1.2"]}}`;

function mockHandle(result: { stdout?: string; stderr?: string; code?: number }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout ?? "")),
    stderr: Stream.make(encoder.encode(result.stderr ?? "")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function neverFinishingMockHandle() {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.never,
    isRunning: Effect.succeed(true),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

// The executable name depends on the host platform (`tailscale.exe` on
// Windows), so pin it: these tests assert the posix spelling.
function layerSpawner(spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) {
  return Layer.merge(
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Layer.succeed(HostProcess.Platform, "linux"),
  );
}

function layerMockSpawner(
  handler: (
    command: string,
    args: ReadonlyArray<string>,
  ) => { stdout?: string; stderr?: string; code?: number },
) {
  return layerSpawner(
    ChildProcessSpawner.make((command) => {
      const childProcess = command as unknown as {
        readonly command: string;
        readonly args: ReadonlyArray<string>;
      };
      return Effect.succeed(mockHandle(handler(childProcess.command, childProcess.args)));
    }),
  );
}

describe("tailscale", () => {
  it.effect("detects Tailnet IPv4 addresses", () =>
    Effect.sync(() => {
      assert.equal(isTailscaleIpv4Address("100.64.0.1"), true);
      assert.equal(isTailscaleIpv4Address("100.127.255.254"), true);
      assert.equal(isTailscaleIpv4Address("100.128.0.1"), false);
      assert.equal(isTailscaleIpv4Address("192.168.1.44"), false);
    }),
  );

  it.effect("parses MagicDNS names from tailscale status", () =>
    Effect.gen(function* () {
      const dnsName = yield* parseTailscaleMagicDnsName(tailscaleStatusJson);
      assert.equal(dnsName, "desktop.tail.ts.net");
      assert.equal(yield* parseTailscaleMagicDnsName("{}"), null);
    }),
  );

  it.effect("parses status facts", () =>
    Effect.gen(function* () {
      const status = yield* parseTailscaleStatus(tailscaleStatusJson);
      assert.deepEqual(status, {
        magicDnsName: "desktop.tail.ts.net",
        tailnetIpv4Addresses: ["100.100.100.100"],
      });
    }),
  );

  it.effect("preserves status decoding failures without exposing cause text", () =>
    Effect.gen(function* () {
      const error = yield* parseTailscaleStatus("{not-json").pipe(Effect.flip);

      assert.instanceOf(error, TailscaleStatusParseError);
      assert.equal(error.message, "Failed to decode tailscale status JSON.");
      assert.isDefined(error.cause);
      assert.notInclude(error.message, String(error.cause));
    }),
  );

  it.effect("reads Tailscale SSH enablement from local prefs", () => {
    const prefsJson =
      '{\n\t"ControlURL": "https://controlplane.tailscale.com",\n\t"RunSSH": true,\n\t"WantRunning": true\n}\n';
    const layer = layerMockSpawner((command, args) => {
      assert.equal(command, "tailscale");
      assert.deepEqual(args, ["debug", "prefs"]);
      return { stdout: prefsJson };
    });

    return Effect.gen(function* () {
      assert.isTrue(yield* readTailscaleSshEnabled.pipe(Effect.provide(layer)));
      assert.isFalse(yield* parseTailscaleSshEnabled('{"RunSSH":false,"WantRunning":true}'));
      assert.isFalse(yield* parseTailscaleSshEnabled('{"RunSSH":true,"WantRunning":false}'));
      assert.isFalse(yield* parseTailscaleSshEnabled("{}"));
      const error = yield* parseTailscaleSshEnabled("{not-json").pipe(Effect.flip);
      assert.instanceOf(error, TailscaleStatusParseError);
    });
  });

  it.effect("builds clean HTTPS base URLs", () =>
    Effect.sync(() => {
      assert.equal(
        buildTailscaleHttpsBaseUrl({ magicDnsName: "desktop.tail.ts.net" }),
        "https://desktop.tail.ts.net/",
      );
      assert.equal(
        buildTailscaleHttpsBaseUrl({ magicDnsName: "desktop.tail.ts.net", servePort: 8443 }),
        "https://desktop.tail.ts.net:8443/",
      );
    }),
  );

  it.effect("reads tailscale status through the process spawner service", () => {
    const layer = layerMockSpawner((command, args) => {
      assert.equal(command, "tailscale");
      assert.deepEqual(args, ["status", "--json"]);
      return {
        stdout: tailscaleStatusWithSingleIpJson,
      };
    });

    return Effect.gen(function* () {
      const status = yield* readTailscaleStatus.pipe(Effect.provide(layer));
      assert.deepEqual(status, {
        magicDnsName: "desktop.tail.ts.net",
        tailnetIpv4Addresses: ["100.90.1.2"],
      });
    });
  });

  it.effect("preserves tailscale spawn failures as causes", () => {
    const systemCause = new Error("private executable lookup detail");
    const cause = PlatformError.systemError({
      _tag: "NotFound",
      module: "ChildProcess",
      method: "spawn",
      cause: systemCause,
    });
    const layer = layerSpawner(ChildProcessSpawner.make(() => Effect.fail(cause)));

    return Effect.gen(function* () {
      const error = yield* readTailscaleStatus.pipe(Effect.flip, Effect.provide(layer));

      assert.instanceOf(error, TailscaleCommandSpawnError);
      assert.equal(error.executable, "tailscale");
      assert.equal(error.subcommand, "status");
      assert.equal(error.argumentCount, 2);
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message, "Failed to spawn tailscale status.");
      assert.notInclude(error.message, systemCause.message);
    });
  });

  it.effect("turns spawn defects into typed spawn failures", () => {
    // A non-directory entry on PATH makes node's spawn throw ENOTDIR
    // synchronously. The platform spawner calls `NodeChildProcess.spawn` from
    // inside an `Effect.callback` registration, so that throw arrives as a
    // defect rather than a typed error - the shape reproduced here.
    const defect = Object.assign(new Error("spawn tailscale ENOTDIR"), { code: "ENOTDIR" });
    const layer = layerSpawner(
      ChildProcessSpawner.make(() =>
        Effect.callback<never, never>(() => {
          throw defect;
        }),
      ),
    );

    return Effect.gen(function* () {
      const statusError = yield* readTailscaleStatus.pipe(Effect.flip, Effect.provide(layer));
      assert.instanceOf(statusError, TailscaleCommandSpawnError);
      assert.equal(statusError.subcommand, "status");
      assert.strictEqual(statusError.cause, defect);

      const serveError = yield* ensureTailscaleServe({ localPort: 13773, servePort: 8443 }).pipe(
        Effect.flip,
        Effect.provide(layer),
      );
      assert.instanceOf(serveError, TailscaleCommandSpawnError);
      assert.equal(serveError.subcommand, "serve");
      assert.strictEqual(serveError.cause, defect);

      const degraded = yield* readTailscaleStatus.pipe(
        Effect.orElseSucceed(() => null),
        Effect.provide(layer),
      );
      assert.equal(degraded, null);
    });
  });

  it.effect("keeps nonzero exit diagnostics structured", () => {
    const layer = layerMockSpawner(() => ({
      code: 7,
      stderr: "not logged in tskey-auth-secret-token-value",
    }));

    return Effect.gen(function* () {
      const error = yield* readTailscaleStatus.pipe(Effect.flip, Effect.provide(layer));

      assert.instanceOf(error, TailscaleCommandExitError);
      assert.equal(error.executable, "tailscale");
      assert.equal(error.subcommand, "status");
      assert.equal(error.argumentCount, 2);
      assert.equal(error.exitCode, 7);
      assert.equal(error.stdoutLength, 0);
      assert.equal(error.stderrLength, 43);
      assert.notProperty(error, "command");
      assert.notProperty(error, "stderr");
      assert.notInclude(error.message, "tskey-auth-secret-token-value");
      assert.equal(error.message, "tailscale status exited with code 7.");
      assert.equal(error.stderrDiagnostic, "not-logged-in");
      assertCarriesNoSecret(error, "tskey-auth-secret-token-value");
    });
  });

  it.effect("classifies unrecognized stderr without quoting it", () => {
    const layer = layerMockSpawner(() => ({
      code: 3,
      stderr: "something novel went wrong for node fluffy-badger tskey-auth-secret-token-value",
    }));

    return Effect.gen(function* () {
      const error = yield* readTailscaleStatus.pipe(Effect.flip, Effect.provide(layer));

      assert.instanceOf(error, TailscaleCommandExitError);
      assert.equal(error.stderrDiagnostic, "unknown");
      assertCarriesNoSecret(error, "tskey-auth-secret-token-value");
      assertCarriesNoSecret(error, "fluffy-badger");
    });
  });

  it.effect("times out tailscale status through TestClock", () => {
    const layer = Layer.merge(
      TestClock.layer(),
      layerSpawner(ChildProcessSpawner.make(() => Effect.succeed(neverFinishingMockHandle()))),
    );

    return Effect.gen(function* () {
      const fiber = yield* readTailscaleStatus.pipe(Effect.flip, Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* TestClock.adjust(TAILSCALE_STATUS_TIMEOUT);
      const error = yield* Fiber.join(fiber);

      assert.instanceOf(error, TailscaleCommandTimeoutError);
      assert.equal(error.executable, "tailscale");
      assert.equal(error.subcommand, "status");
      assert.equal(error.argumentCount, 2);
      assert.equal(error.timeoutMs, 3_500);
      assert.isTrue(Cause.isTimeoutError(error.cause));
      assert.equal(error.message, "tailscale status timed out after 3500ms.");
    }).pipe(Effect.provide(layer));
  });

  it.effect("configures tailscale serve through the process spawner service", () => {
    const layer = layerMockSpawner((command, args) => {
      assert.equal(command, "tailscale");
      assert.deepEqual(args, ["serve", "--bg", "--https=8443", "http://127.0.0.1:13773"]);
      return {};
    });

    return ensureTailscaleServe({ localPort: 13773, servePort: 8443 }).pipe(Effect.provide(layer));
  });

  it.effect("retains tailscale serve exit diagnostics", () => {
    const layer = layerMockSpawner(() => ({
      code: 1,
      stderr: "serve permission denied tskey-auth-secret-token-value",
    }));

    return Effect.gen(function* () {
      const error = yield* ensureTailscaleServe({ localPort: 13773, servePort: 8443 }).pipe(
        Effect.flip,
        Effect.provide(layer),
      );

      assert.instanceOf(error, TailscaleCommandExitError);
      assert.equal(error.executable, "tailscale");
      assert.equal(error.subcommand, "serve");
      assert.equal(error.argumentCount, 4);
      assert.equal(error.exitCode, 1);
      assert.equal(error.stderrLength, 53);
      assert.notProperty(error, "command");
      assert.notProperty(error, "stderr");
      assert.notInclude(error.message, "tskey-auth-secret-token-value");
      assert.equal(error.stderrDiagnostic, "permission-denied");
      assertCarriesNoSecret(error, "tskey-auth-secret-token-value");
    });
  });

  it.effect("disables tailscale serve through the process spawner service", () => {
    const commands: {
      readonly command: string;
      readonly args: ReadonlyArray<string>;
    }[] = [];
    const layer = layerMockSpawner((command, args) => {
      commands.push({ command, args });
      assert.equal(command, "tailscale");
      assert.deepEqual(args, ["serve", "--https=8443", "off"]);
      return {};
    });

    return Effect.gen(function* () {
      yield* disableTailscaleServe({ servePort: 8443 }).pipe(Effect.provide(layer));
      assert.deepEqual(commands, [
        { command: "tailscale", args: ["serve", "--https=8443", "off"] },
      ]);
    });
  });
});

// Shapes recorded from tailscale 1.104.1 on Linux, trimmed to the fields read.
const hostStatusJson = JSON.stringify({
  MagicDNSSuffix: "tail.ts.net",
  Self: {
    UserID: 7596696651576590,
    TailscaleIPs: ["100.95.60.35", "fd7a:115c:a1e0::e833:3c24"],
  },
  User: {
    "3750524227998267": { ID: 3750524227998267, LoginName: "tagged-devices" },
    "7596696651576590": { ID: 7596696651576590, LoginName: "owner@example.com" },
  },
});
const ownWhoisJson = JSON.stringify({
  Node: {
    StableID: "nnzhCheWFo11CNTRL",
    Name: "macbook-pro.tail.ts.net.",
    ComputedName: "macbook-pro",
    User: 7596696651576590,
  },
  UserProfile: { ID: 7596696651576590, LoginName: "owner@example.com" },
});
const taggedWhoisJson = JSON.stringify({
  Node: {
    StableID: "nJP1Dh4v6L11CNTRL",
    Name: "lisky-box-1.tail.ts.net.",
    ComputedName: "lisky-box-1",
    Tags: ["tag:lisky"],
    User: 3750524227998267,
  },
  UserProfile: { ID: 3750524227998267, LoginName: "tagged-devices" },
});

describe("tailscale identities", () => {
  it.effect("reads the host's owner, tailnet addresses and MagicDNS suffix", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* parseTailscaleHostIdentity(hostStatusJson), {
        ownerLoginName: "owner@example.com",
        addresses: ["100.95.60.35", "fd7a:115c:a1e0::e833:3c24"],
        magicDnsSuffix: "tail.ts.net",
      });
    }),
  );

  it.effect("gives a tagged host no owner", () =>
    Effect.gen(function* () {
      const status = JSON.parse(hostStatusJson);
      status.Self.Tags = ["tag:server"];
      const identity = yield* parseTailscaleHostIdentity(JSON.stringify(status));
      assert.equal(identity.ownerLoginName, null);
    }),
  );

  it.effect("reads a peer's stable node id, name, tags and account", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* parseTailscaleWhois(ownWhoisJson), {
        stableNodeId: "nnzhCheWFo11CNTRL",
        nodeName: "macbook-pro",
        tags: [],
        loginName: "owner@example.com",
      });
      assert.deepStrictEqual(yield* parseTailscaleWhois(taggedWhoisJson), {
        stableNodeId: "nJP1Dh4v6L11CNTRL",
        nodeName: "lisky-box-1",
        tags: ["tag:lisky"],
        loginName: "tagged-devices",
      });
    }),
  );

  it.effect("asks tailscaled about the address alone and reports a missing peer", () =>
    Effect.gen(function* () {
      let seenArgs: ReadonlyArray<string> = [];
      const found = yield* readTailscaleWhois("100.89.162.36").pipe(
        Effect.provide(
          layerMockSpawner((_command, args) => {
            seenArgs = args;
            return { stdout: ownWhoisJson };
          }),
        ),
      );
      assert.deepStrictEqual(seenArgs, ["whois", "--json", "100.89.162.36"]);
      assert.equal(found.stableNodeId, "nnzhCheWFo11CNTRL");

      const missing = yield* readTailscaleWhois("100.100.100.123").pipe(
        Effect.provide(layerMockSpawner(() => ({ stderr: "peer not found", code: 1 }))),
        Effect.flip,
      );
      assert.instanceOf(missing, TailscaleCommandExitError);
      assert.equal(missing.subcommand, "whois");
    }),
  );

  it.effect("lists peers with their account, tags and MagicDNS name", () =>
    Effect.gen(function* () {
      const status = JSON.parse(hostStatusJson);
      status.Peer = {
        "nodekey:a": {
          ID: "nnzhCheWFo11CNTRL",
          HostName: "MacBook Pro-810a",
          DNSName: "macbook-pro-810a.tail.ts.net.",
          TailscaleIPs: ["100.89.162.36", "fd7a:115c:a1e0::6701:a290"],
          Online: true,
          Tags: null,
          UserID: 7596696651576590,
          OS: "macOS",
        },
        "nodekey:b": {
          ID: "nGVJU6Tgfa11CNTRL",
          HostName: "lisky-box",
          DNSName: "lisky-box.tail.ts.net.",
          TailscaleIPs: ["100.97.155.23"],
          Online: false,
          Tags: ["tag:lisky"],
          UserID: 3750524227998267,
          OS: "linux",
        },
      };
      assert.deepStrictEqual(yield* parseTailscalePeers(JSON.stringify(status)), [
        {
          stableNodeId: "nnzhCheWFo11CNTRL",
          nodeName: "macbook-pro-810a",
          dnsName: "macbook-pro-810a.tail.ts.net",
          addresses: ["100.89.162.36", "fd7a:115c:a1e0::6701:a290"],
          online: true,
          tags: [],
          os: "macOS",
          loginName: "owner@example.com",
        },
        {
          stableNodeId: "nGVJU6Tgfa11CNTRL",
          nodeName: "lisky-box",
          dnsName: "lisky-box.tail.ts.net",
          addresses: ["100.97.155.23"],
          online: false,
          tags: ["tag:lisky"],
          os: "linux",
          loginName: "tagged-devices",
        },
      ]);
    }),
  );

  it.effect("recognizes both tailnet address ranges", () =>
    Effect.sync(() => {
      assert.equal(isTailscaleAddress("100.89.162.36"), true);
      assert.equal(isTailscaleAddress("fd7a:115c:a1e0::6701:a290"), true);
      assert.equal(isTailscaleAddress("192.168.1.20"), false);
      assert.equal(isTailscaleAddress("fe80::1"), false);
    }),
  );
});
