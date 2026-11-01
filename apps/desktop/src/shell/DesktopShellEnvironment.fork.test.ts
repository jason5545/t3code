// @effect-diagnostics nodeBuiltinImport:off -- The process fixture mocks the user's login shell.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeOS from "node:os";
import { vi } from "vite-plus/test";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopShellEnvironment from "./DesktopShellEnvironment.ts";

vi.mock("node:os", { spy: true });

const textEncoder = new TextEncoder();

function envOutput(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .flatMap(([name, value]) => [
      `__T3CODE_ENV_${name}_START__`,
      value,
      `__T3CODE_ENV_${name}_END__`,
    ])
    .join("\n");
}

function makeProcess(output: string): ChildProcessSpawner.ChildProcessHandle {
  const stdout = Stream.make(textEncoder.encode(output));
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(123),
    stdout,
    stderr: Stream.empty,
    all: stdout,
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
}

function runFromLoginShell(
  env: NodeJS.ProcessEnv,
  shellOutput: string,
  stateDir: string,
  wait: "discovery" | "install",
) {
  const layer = DesktopShellEnvironment.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          DesktopEnvironment.DesktopEnvironment,
          DesktopEnvironment.DesktopEnvironment.of({
            platform: "darwin",
            stateDir,
            homeDirectory: "/test-home",
          } as DesktopEnvironment.DesktopEnvironment["Service"]),
        ),
        NodeServices.layer,
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() =>
            wait === "install" ? Effect.never : Effect.succeed(makeProcess(shellOutput)),
          ),
        ),
      ),
    ),
  );
  const program = Effect.gen(function* () {
    const shellEnvironment = yield* DesktopShellEnvironment.DesktopShellEnvironment;
    return yield* wait === "install"
      ? shellEnvironment.installIntoProcess
      : shellEnvironment.awaitDiscovery;
  }).pipe(Effect.provide(layer));

  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env;
      process.env = env;
      const spy = vi.spyOn(NodeOS, "userInfo").mockReturnValue({
        ...NodeOS.userInfo(),
        shell: null,
      });
      return { previous, spy };
    }),
    () => program,
    ({ previous, spy }) =>
      Effect.sync(() => {
        spy.mockRestore();
        process.env = previous;
      }),
  );
}

const FORK_SHELL_OUTPUT = envOutput({
  PATH: "/opt/homebrew/bin:/usr/bin",
  T3CODE_CONTEXT_HANDOFF_TOKEN_CAP: "48000",
  T3CODE_TAILSCALE_MCP_OWNER_ACCESS: "full-access",
  T3CODE_TAILSCALE_PAIRING: "true",
});

describe("DesktopShellEnvironment (fork)", () => {
  it.effect(
    "hydrates the provider handoff budget, owner MCP access and Tailscale pairing from the login shell",
    () =>
      Effect.gen(function* () {
        const stateDir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped();
        const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };

        yield* runFromLoginShell(env, FORK_SHELL_OUTPUT, stateDir, "discovery");

        assert.equal(env.T3CODE_CONTEXT_HANDOFF_TOKEN_CAP, "48000");
        assert.equal(env.T3CODE_TAILSCALE_MCP_OWNER_ACCESS, "full-access");
        assert.equal(env.T3CODE_TAILSCALE_PAIRING, "true");
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("restores them from the shell cache before the backend starts", () =>
    Effect.gen(function* () {
      const stateDir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped();
      yield* runFromLoginShell(
        { SHELL: "/bin/zsh", PATH: "/usr/bin" },
        FORK_SHELL_OUTPUT,
        stateDir,
        "discovery",
      );
      const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };

      assert.isTrue(yield* runFromLoginShell(env, "", stateDir, "install"));

      assert.equal(env.T3CODE_CONTEXT_HANDOFF_TOKEN_CAP, "48000");
      assert.equal(env.T3CODE_TAILSCALE_MCP_OWNER_ACCESS, "full-access");
      assert.equal(env.T3CODE_TAILSCALE_PAIRING, "true");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps an inherited provider handoff budget", () =>
    Effect.gen(function* () {
      const stateDir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped();
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        T3CODE_CONTEXT_HANDOFF_TOKEN_CAP: "32000",
      };

      yield* runFromLoginShell(env, FORK_SHELL_OUTPUT, stateDir, "discovery");

      assert.equal(env.T3CODE_CONTEXT_HANDOFF_TOKEN_CAP, "32000");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
