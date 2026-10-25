/**
 * Fork patch 11: an ephemeral thread's OMP process. The conversation lives only
 * in that process: no session file, no title model, no T3 MCP. A settings
 * overlay keeps every model call, background roles such as vision and
 * subagents included, on models served from this machine.
 */
import { isLoopbackBaseUrl } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";

import { buildPiRpcLaunch } from "./mcpInjection.ts";
import { makePiRpcConnection, PiRpcError, piRecordField, piRecordString } from "./rpc.ts";

/**
 * OMP 18.12.6's config sources other than `native`. Disabling `native` would
 * also drop `models.yml`, which defines the local provider; it is the one
 * source that can still add MCP servers.
 */
export const OMP_FOREIGN_CONFIG_SOURCES = [
  "cursor",
  "mcp-json",
  "windsurf",
  "vscode",
  "claude-plugins",
  "agent-plugins",
  "omp-plugins",
  "opencode",
  "claude",
  "gemini",
  "codex",
] as const;

/**
 * OMP 18.12.6's default built-in tools minus everything that runs code or
 * reaches the network: no `bash` or `eval`, no `web_search`, and no `task`,
 * whose subagents take their tools from the agent definition, not `--tools`
 * (nor `wait`, which only waits on them). `write` and `edit` still follow the
 * approval mode.
 */
export const OMP_EPHEMERAL_TOOLS: ReadonlyArray<string> = [
  "ask",
  "edit",
  "glob",
  "grep",
  "read",
  "todo",
  "write",
];

/**
 * Tools the running process offers beyond the allowlist, from `get_state`'s
 * `dumpTools`. Undefined when OMP does not report them.
 */
export function ompToolsBeyondAllowlist(state: unknown): ReadonlyArray<string> | undefined {
  const tools = piRecordField(state, "dumpTools");
  if (!Array.isArray(tools)) return undefined;
  const allowed = new Set(OMP_EPHEMERAL_TOOLS);
  return tools.flatMap((tool) => {
    const name = piRecordString(tool, "name");
    return name === undefined || allowed.has(name) ? [] : [name];
  });
}

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
 * fallback cannot reach a hosted model; `enabledProviders` only opts foreign
 * config sources in and does not restrict models.
 */
export function ompEphemeralOverlay(models: ReadonlyArray<OmpModelEndpoint>): string {
  const local = new Set(models.filter(isLocalEndpoint).map((model) => model.provider));
  const remote = new Set(
    models.map((model) => model.provider).filter((provider) => !local.has(provider)),
  );
  return `${[
    `disabledProviders:${yamlList([...remote, ...OMP_FOREIGN_CONFIG_SOURCES])}`,
    `enabledModels:${yamlList([...local].map((provider) => `${provider}/*`))}`,
    'memory:\n  backend: "off"',
    "fetch:\n  enabled: false",
    "github:\n  enabled: false",
    "browser:\n  enabled: false",
    "images:\n  urls:\n    enabled: false",
  ].join("\n")}\n`;
}

/**
 * Appended after the user's launch args so none of them can lift a restriction.
 * No `--no-extensions`: the local provider's credentials come from an OMP
 * extension, so without them OMP finds no usable model and exits.
 */
export function ompEphemeralLaunchArgs(overlayPath: string): ReadonlyArray<string> {
  return ["--no-title", `--tools=${OMP_EPHEMERAL_TOOLS.join(",")}`, "--config", overlayPath];
}

/** No session file and no T3 MCP; the T3 extension still loads for its approval hook. */
export function buildOmpEphemeralLaunch(input: {
  readonly launchArgs: ReadonlyArray<string>;
  readonly restrictions: ReadonlyArray<string>;
  readonly environment: NodeJS.ProcessEnv;
  readonly extensionPath: string | undefined;
  readonly runtimeMode: Parameters<typeof buildPiRpcLaunch>[0]["runtimeMode"];
}) {
  return buildPiRpcLaunch({
    launchArgs: [...input.launchArgs, ...input.restrictions],
    environment: input.environment,
    mcpSession: undefined,
    extensionPath: input.extensionPath,
    ...(input.runtimeMode === undefined ? {} : { runtimeMode: input.runtimeMode }),
    ephemeral: true,
  });
}

/**
 * The overlay names every hosted provider, so a throwaway process lists OMP's
 * models first and is gone before the real one starts. It keeps extensions:
 * without the local provider's credentials it would list no local model.
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
    return ompEphemeralLaunchArgs(input.overlayPath);
  },
);
