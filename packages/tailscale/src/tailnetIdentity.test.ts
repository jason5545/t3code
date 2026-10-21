import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { TailscaleCommandExitError } from "./tailscale.ts";
import {
  isTailscaleAddress,
  parseTailscaleHostIdentity,
  parseTailscalePeers,
  parseTailscaleWhois,
  readTailscaleWhois,
} from "./tailnetIdentity.ts";

const encoder = new TextEncoder();

// Spawner mock mirrors tailscale.test.ts, pinned to the posix executable name.
function layerMockSpawner(
  handler: (
    command: string,
    args: ReadonlyArray<string>,
  ) => { stdout?: string; stderr?: string; code?: number },
) {
  return Layer.merge(
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) => {
        const childProcess = command as unknown as {
          readonly command: string;
          readonly args: ReadonlyArray<string>;
        };
        const result = handler(childProcess.command, childProcess.args);
        return Effect.succeed(
          ChildProcessSpawner.makeHandle({
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
          }),
        );
      }),
    ),
    Layer.succeed(HostProcess.Platform, "linux"),
  );
}

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
