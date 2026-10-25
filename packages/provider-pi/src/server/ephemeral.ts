/**
 * Fork patch 11: an ephemeral thread's OMP process runs like any OMP thread but
 * keeps its sessions in the thread's Scratch folder, which the purge removes,
 * and has no title model, T3 MCP or OMP memory; an overlay keeps every model
 * call on this machine.
 */
import { isLoopbackBaseUrl } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";

import { buildPiRpcLaunch } from "./mcpInjection.ts";
import { makePiRpcConnection, PiRpcError, piRecordField, piRecordString } from "./rpc.ts";

export interface OmpModelEndpoint {
  readonly provider: string;
  readonly baseUrl: string | undefined;
}

const isLocalEndpoint = (model: OmpModelEndpoint) =>
  model.baseUrl !== undefined && isLoopbackBaseUrl(model.baseUrl);

const yamlList = (values: ReadonlyArray<string>) =>
  values.length === 0 ? " []" : values.map((value) => `\n  - ${JSON.stringify(value)}`).join("");

/**
 * `disabledProviders` is what OMP's model registry filters, so the vision
 * fallback cannot reach a hosted model; `enabledProviders` does not restrict
 * models.
 */
export function ompEphemeralOverlay(models: ReadonlyArray<OmpModelEndpoint>): string {
  const local = new Set(models.filter(isLocalEndpoint).map((model) => model.provider));
  const remote = new Set(
    models.map((model) => model.provider).filter((provider) => !local.has(provider)),
  );
  return `${[
    `disabledProviders:${yamlList([...remote])}`,
    `enabledModels:${yamlList([...local].map((provider) => `${provider}/*`))}`,
    'memory:\n  backend: "off"',
  ].join("\n")}\n`;
}

/** Appended after the user's launch args so none of them can lift a restriction. */
export function ompEphemeralLaunchArgs(
  overlayPath: string,
  sessionDir: string,
): ReadonlyArray<string> {
  return ["--no-title", "--session-dir", sessionDir, "--config", overlayPath];
}

/** No T3 MCP; the T3 extension still loads for the approval hook. */
export function buildOmpEphemeralLaunch(input: {
  readonly launchArgs: ReadonlyArray<string>;
  readonly restrictions: ReadonlyArray<string>;
  readonly environment: NodeJS.ProcessEnv;
  readonly extensionPath: string;
  readonly runtimeMode: Parameters<typeof buildPiRpcLaunch>[0]["runtimeMode"];
}) {
  return buildPiRpcLaunch({
    launchArgs: [...input.launchArgs, ...input.restrictions],
    environment: input.environment,
    mcpSession: undefined,
    extensionPath: input.extensionPath,
    ...(input.runtimeMode === undefined ? {} : { runtimeMode: input.runtimeMode }),
  });
}

/**
 * The overlay names every hosted provider, so a throwaway process lists OMP's
 * models first, with the same launch args, and is gone before the real one starts.
 */
export const prepareOmpEphemeralLaunch = Effect.fn("PiAdapter.prepareOmpEphemeralLaunch")(
  function* (input: {
    readonly command: string;
    readonly launchArgs: ReadonlyArray<string>;
    readonly environment: NodeJS.ProcessEnv;
    readonly cwd: string;
    readonly overlayPath: string;
  }) {
    const discovery = buildPiRpcLaunch({
      launchArgs: input.launchArgs,
      environment: input.environment,
      mcpSession: undefined,
      extensionPath: undefined,
      ephemeral: true,
    });
    const listed = yield* Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* makePiRpcConnection({
          command: input.command,
          args: discovery.args,
          cwd: input.cwd,
          env: discovery.env,
        });
        yield* Stream.fromQueue(connection.events).pipe(
          Stream.runDrain,
          Effect.ignore,
          Effect.forkScoped,
        );
        return yield* connection.request({ type: "get_available_models" });
      }),
    );
    const rows = piRecordField(listed, "models");
    const models: ReadonlyArray<OmpModelEndpoint> = Array.isArray(rows)
      ? rows.flatMap((row) => {
          const provider = piRecordString(row, "provider");
          return provider === undefined
            ? []
            : [{ provider, baseUrl: piRecordString(row, "baseUrl") }];
        })
      : [];
    if (!models.some(isLocalEndpoint)) {
      return yield* new PiRpcError({
        operation: "launch",
        detail: "OMP lists no model served from this machine",
      });
    }
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem
      .writeFileString(input.overlayPath, ompEphemeralOverlay(models))
      .pipe(Effect.mapError((cause) => new PiRpcError({ operation: "launch", cause })));
    return ompEphemeralLaunchArgs(input.overlayPath, `${input.cwd}/.omp-sessions`);
  },
);
