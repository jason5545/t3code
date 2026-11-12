import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import type * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ExtensionStore from "./ExtensionStore.ts";

/**
 * Fork patch 30: MCP tools from installed extensions. A server part's default export is
 * `{ tools: [{ name, description, readOnly?, call(args) }] }`. A tool's name starts with its
 * extension's id (dashes as underscores), so it cannot take a built-in tool's name. A tool that
 * is not `readOnly` needs a full-access caller, like the tools that change the environment.
 */
const CALL_TIMEOUT = Duration.minutes(2);

const failure = (message: string) =>
  new OrchestratorMcpFailure({ code: "provider_unavailable", message });

interface InstalledTool {
  readonly name: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly call: (args: unknown) => unknown;
}

const decodeTools = Schema.decodeUnknownOption(
  Schema.Struct({
    tools: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        description: Schema.String,
        readOnly: Schema.optional(Schema.Boolean),
        call: Schema.optional(Schema.Unknown),
      }),
    ),
  }),
);

export const readInstalledTools = (
  module: ExtensionStore.LoadedServerModule,
): ReadonlyArray<InstalledTool> => {
  const prefix = `${module.id.replaceAll("-", "_")}_`;
  return Option.match(decodeTools(module.exports), {
    onNone: () => [],
    onSome: ({ tools }) =>
      tools.flatMap(({ name, description, readOnly, call }) =>
        typeof call === "function" && name.startsWith(prefix) && /^[a-z][a-z0-9_]*$/.test(name)
          ? [{ name, description, readOnly: readOnly === true, call: (args) => call(args) }]
          : [],
      ),
  });
};

const registerTool = (
  register: typeof McpHttpServer.toolkitRegistration,
  { name, description, readOnly, call }: InstalledTool,
) => {
  const toolkit = Toolkit.make(
    Tool.make(name, {
      description,
      parameters: Schema.Record(Schema.String, Schema.Unknown),
      success: Schema.Unknown,
      failure: OrchestratorMcpFailure,
      failureMode: "return" as const,
      dependencies: [
        McpInvocationContext.McpInvocationContext,
        ThreadManagementService.ThreadManagementService,
      ],
    })
      .annotate(Tool.Readonly, readOnly)
      .annotate(Tool.Destructive, !readOnly),
  );
  const run = (args: { readonly [key: string]: unknown }) =>
    Effect.tryPromise({
      try: () => Promise.resolve(call(args)),
      catch: (cause) => failure(`The extension's tool failed: ${String(cause)}`),
    }).pipe(
      Effect.timeoutOrElse({
        duration: CALL_TIMEOUT,
        orElse: () => Effect.fail(failure("The extension's tool did not answer within 2 minutes.")),
      }),
    );
  return register(
    toolkit,
    McpToolAccess.toLayer(toolkit, {
      [name]: readOnly ? McpToolAccess.reads(run) : McpToolAccess.writesEnvironment(run),
    }),
  );
};

/** Takes `toolkitRegistration` as an argument: `McpHttpServer.ts` is loading when it calls this. */
export const layer = (register: typeof McpHttpServer.toolkitRegistration) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const store = yield* Effect.serviceOption(ExtensionStore.ExtensionStore);
      if (Option.isNone(store)) return Layer.empty;
      const tools = (yield* store.value.serverModules).flatMap(readInstalledTools);
      return Layer.mergeAll(Layer.empty, ...tools.map((tool) => registerTool(register, tool)));
    }),
  );
