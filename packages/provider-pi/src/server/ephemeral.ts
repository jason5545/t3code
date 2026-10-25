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
import { T3_PI_EPHEMERAL_ROOT_ENV } from "./ephemeralWriteGuard.ts";
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
    // The write guard judges replace-mode edits only; see ephemeralWriteGuard.ts.
    'edit:\n  mode: "replace"',
  ].join("\n")}\n`;
}

/** The OMP instance's `ephemeralExtensionPaths` setting, one path per line. */
export function ompEphemeralExtensionPaths(setting: string): ReadonlyArray<string> {
  return setting
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Drops every extension the user's launch args name; `--hook` loads one too. */
function withoutExtensionArgs(args: ReadonlyArray<string>): ReadonlyArray<string> {
  const kept: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "-e" || arg === "--extension" || arg === "--hook") {
      index += 1;
      continue;
    }
    if (arg.startsWith("-e=") || arg.startsWith("--extension=") || arg.startsWith("--hook=")) {
      continue;
    }
    kept.push(arg);
  }
  return kept;
}

/**
 * Discovery stays off and only the configured extensions load: the local
 * provider's credentials usually come from one, and nothing else may run.
 * Explicit `--extension` paths still load under `--no-extensions`.
 */
function ompOnlyExtensions(extensionPaths: ReadonlyArray<string>): ReadonlyArray<string> {
  return ["--no-extensions", ...extensionPaths.flatMap((path) => ["--extension", path])];
}

/** Appended after the user's launch args so none of them can lift a restriction. */
export function ompEphemeralLaunchArgs(
  overlayPath: string,
  extensionPaths: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return [
    "--no-title",
    `--tools=${OMP_EPHEMERAL_TOOLS.join(",")}`,
    "--config",
    overlayPath,
    ...ompOnlyExtensions(extensionPaths),
  ];
}

/**
 * No session file and no T3 MCP. Besides the configured extensions, the T3
 * extension loads: its hook keeps `write` and `edit` inside `root`, the
 * thread's Scratch folder.
 */
export function buildOmpEphemeralLaunch(input: {
  readonly launchArgs: ReadonlyArray<string>;
  readonly restrictions: ReadonlyArray<string>;
  readonly environment: NodeJS.ProcessEnv;
  readonly extensionPath: string;
  readonly root: string;
  readonly runtimeMode: Parameters<typeof buildPiRpcLaunch>[0]["runtimeMode"];
}) {
  const launch = buildPiRpcLaunch({
    launchArgs: [...withoutExtensionArgs(input.launchArgs), ...input.restrictions],
    environment: input.environment,
    mcpSession: undefined,
    extensionPath: input.extensionPath,
    ...(input.runtimeMode === undefined ? {} : { runtimeMode: input.runtimeMode }),
    ephemeral: true,
  });
  const env: NodeJS.ProcessEnv = { ...launch.env, [T3_PI_EPHEMERAL_ROOT_ENV]: input.root };
  return { ...launch, env };
}

/**
 * The overlay names every hosted provider, so a throwaway process lists OMP's
 * models first, with the same extensions, and is gone before the real one starts.
 */
export const prepareOmpEphemeralLaunch = Effect.fn("PiAdapter.prepareOmpEphemeralLaunch")(
  function* (input: {
    readonly command: string;
    readonly launchArgs: ReadonlyArray<string>;
    readonly environment: NodeJS.ProcessEnv;
    readonly cwd: string;
    readonly overlayPath: string;
    readonly extensionPaths: ReadonlyArray<string>;
  }) {
    const discovery = buildPiRpcLaunch({
      launchArgs: [
        ...withoutExtensionArgs(input.launchArgs),
        ...ompOnlyExtensions(input.extensionPaths),
      ],
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
        detail:
          input.extensionPaths.length === 0
            ? "OMP lists no model served from this machine. If an OMP extension provides your local model, add its path to this OMP instance's Ephemeral extensions setting (ephemeralExtensionPaths)"
            : "OMP lists no model served from this machine with the extensions in this OMP instance's Ephemeral extensions setting (ephemeralExtensionPaths)",
      });
    }
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem
      .writeFileString(input.overlayPath, ompEphemeralOverlay(models))
      .pipe(Effect.mapError((cause) => new PiRpcError({ operation: "launch", cause })));
    return ompEphemeralLaunchArgs(input.overlayPath, input.extensionPaths);
  },
);
