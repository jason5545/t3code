import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { checkPiProviderStatus } from "./status.ts";

// Spawners mirror status.test.ts, but answer `--version` as `omp/<version>` the way OMP does.
const OMP_VERSION_PREFIX = "omp/";
const encoder = new TextEncoder();
const decodeRpcRequest = Schema.decodeSync(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, type: Schema.String })),
);
const encodeJsonLine = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function processHandle(input: {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
}) {
  const bytes = (value: string | undefined) =>
    value === undefined || value.length === 0
      ? Stream.empty
      : Stream.succeed(encoder.encode(value));
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(900_000_001),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(input.exitCode ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: bytes(input.stdout),
    stderr: bytes(input.stderr),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function ompProbeSpawner(version: string) {
  return ChildProcessSpawner.make((command) => {
    const args = ChildProcess.isStandardCommand(command) ? command.args : [];
    return Effect.succeed(
      args.includes("--version")
        ? processHandle({ stdout: `${OMP_VERSION_PREFIX}${version}\n` })
        : processHandle({ stderr: "RPC startup failed", exitCode: 1 }),
    );
  });
}

const ompDiscoverySpawner = (inventory: unknown) =>
  Effect.gen(function* () {
    const stdout = yield* Queue.unbounded<Uint8Array, Cause.Done>();
    let stdinBuffer = "";
    const stdin = Sink.forEach((chunk: Uint8Array) =>
      Effect.gen(function* () {
        stdinBuffer += new TextDecoder().decode(chunk);
        while (true) {
          const newline = stdinBuffer.indexOf("\n");
          if (newline === -1) return;
          const line = stdinBuffer.slice(0, newline);
          stdinBuffer = stdinBuffer.slice(newline + 1);
          if (line.length === 0) continue;
          const request = decodeRpcRequest(line);
          const data =
            request.type === "get_available_models"
              ? inventory
              : request.type === "get_commands"
                ? { commands: [] }
                : {};
          yield* Queue.offer(
            stdout,
            encoder.encode(
              `${encodeJsonLine({ type: "response", id: request.id, command: request.type, success: true, data })}\n`,
            ),
          );
        }
      }),
    );
    return ChildProcessSpawner.make((command) => {
      const args = ChildProcess.isStandardCommand(command) ? command.args : [];
      return Effect.succeed(
        args.includes("--version")
          ? processHandle({ stdout: `${OMP_VERSION_PREFIX}0.84.3\n` })
          : ChildProcessSpawner.makeHandle({
              ...processHandle({}),
              exitCode: Effect.never,
              isRunning: Effect.succeed(true),
              stdin,
              stdout: Stream.fromQueue(stdout),
            }),
      );
    });
  });

const settings = {
  enabled: true,
  binaryPath: "omp",
  launchArgs: "",
  customModels: [],
} as const;

describe("PiProvider running OMP", () => {
  it.effect("accepts OMP versioning independently of Pi", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus(settings).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, ompProbeSpawner("18.7.0")),
      );
      assert.equal(snapshot.status, "ready");
      assert.equal(snapshot.version, "18.7.0");
      assert.equal(snapshot.auth.status, "unknown");
      assert.include(snapshot.message ?? "", "OMP is available");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("labels an authenticated OMP as OMP rather than Pi", () =>
    Effect.gen(function* () {
      const spawner = yield* ompDiscoverySpawner({
        models: [{ provider: "anthropic", id: "claude-opus" }],
      });
      const snapshot = yield* checkPiProviderStatus(settings).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      assert.equal(snapshot.auth.status, "authenticated");
      assert.equal(snapshot.auth.label, "OMP");
      assert.isTrue(snapshot.models.some((model) => model.slug === "anthropic/claude-opus"));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
