import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { checkPiProviderStatus, MINIMUM_PI_VERSION } from "./PiProvider.ts";

const encoder = new TextEncoder();

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

function piProbeSpawner(version: string, name = "pi") {
  return ChildProcessSpawner.make((command) => {
    const args = ChildProcess.isStandardCommand(command) ? command.args : [];
    return Effect.succeed(
      args.includes("--version")
        ? processHandle({ stdout: `${name}${name.endsWith("/") ? "" : " "}${version}\n` })
        : processHandle({ stderr: "RPC startup failed", exitCode: 1 }),
    );
  });
}

/** Answers the discovery requests a status probe sends, with one available model. */
function piRpcSpawner(version: string, name: string) {
  return ChildProcessSpawner.make((command) => {
    const args = ChildProcess.isStandardCommand(command) ? command.args : [];
    if (args.includes("--version")) {
      return Effect.succeed(processHandle({ stdout: `${name}${version}\n` }));
    }
    return Effect.gen(function* () {
      const stdout = yield* Queue.unbounded<Uint8Array, Cause.Done>();
      let buffer = "";
      const data: Record<string, unknown> = {
        get_state: { thinkingLevel: "medium" },
        get_available_models: { models: [{ provider: "anthropic", id: "claude-opus" }] },
        get_available_commands: { commands: [] },
      };
      const stdin = Sink.forEach((chunk: Uint8Array) =>
        Effect.gen(function* () {
          buffer += new TextDecoder().decode(chunk);
          for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
            const request = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
            buffer = buffer.slice(newline + 1);
            const type = String(request["type"]);
            const response = {
              type: "response",
              id: request["id"],
              command: type,
              success: true,
              data: data[type] ?? {},
            };
            yield* Queue.offer(stdout, encoder.encode(`${JSON.stringify(response)}\n`));
          }
        }),
      );
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(900_000_002),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin,
        stdout: Stream.fromQueue(stdout),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    });
  });
}

const settings = {
  enabled: true,
  binaryPath: "pi",
  launchArgs: "",
  customModels: [],
} as const;

describe("PiProvider", () => {
  it.effect("accepts OMP versioning independently of Pi", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus({ ...settings, binaryPath: "omp" }).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          piProbeSpawner("18.7.0", "omp/"),
        ),
      );
      assert.equal(snapshot.status, "ready");
      assert.equal(snapshot.version, "18.7.0");
      assert.equal(snapshot.auth.status, "unknown");
      assert.include(snapshot.message ?? "", "OMP is available");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("labels an authenticated OMP as OMP rather than Pi", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus({ ...settings, binaryPath: "omp" }).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          piRpcSpawner("18.7.0", "omp/"),
        ),
      );
      assert.equal(snapshot.auth.status, "authenticated");
      assert.equal(snapshot.auth.label, "OMP");
      assert.isTrue(snapshot.models.some((model) => model.slug === "anthropic/claude-opus"));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("requires the first published Pi version with entries and settlement hooks", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus(settings).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, piProbeSpawner("0.80.3")),
      );
      assert.equal(snapshot.status, "error");
      assert.equal(snapshot.version, "0.80.3");
      assert.include(snapshot.message ?? "", `Pi ${MINIMUM_PI_VERSION} or newer`);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps compatible Pi selectable when optional discovery fails", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus(settings).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, piProbeSpawner("0.84.3")),
      );
      assert.equal(snapshot.status, "ready");
      assert.equal(snapshot.auth.status, "unknown");
      assert.deepEqual(
        snapshot.models.map((model) => model.slug),
        ["default"],
      );
      assert.include(snapshot.message ?? "", "could not refresh its models and commands");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
