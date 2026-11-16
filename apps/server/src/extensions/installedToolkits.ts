import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
// oxlint-disable-next-line t3code/no-raw-mcp-registration -- tools still register through toolkitRegistration; McpServer is only read for visibility and list_changed
import { McpSchema, McpServer, Tool, Toolkit } from "effect/ai";

import type * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ExtensionStore from "./ExtensionStore.ts";

/**
 * Fork patch 30: MCP tools from installed extensions, named after their extension's id. A tool
 * that is not `readOnly` needs a full-access caller. MCP cannot take a tool back, so one whose
 * extension is off or removed stays registered, hidden from lists and calls.
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
  { name, description, readOnly }: InstalledTool,
  live: ReadonlyMap<string, InstalledTool>,
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
      .annotate(Tool.Destructive, !readOnly)
      .annotate(McpSchema.EnabledWhen, () => live.has(name)),
  );
  const run = (args: { readonly [key: string]: unknown }) =>
    Effect.tryPromise({
      try: () => {
        const tool = live.get(name);
        if (tool === undefined) throw new Error("its extension is off or was removed");
        return Promise.resolve(tool.call(args));
      },
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

/** Hides a built-in extension's toolkit, and refuses its calls, while the extension is off. */
export const hiddenWhileOff = <A, E, R>(id: string, toolkit: Layer.Layer<A, E, R>) =>
  toolkit.pipe(
    Layer.provide(
      McpServer.visibility(
        Effect.map(
          Effect.serviceOption(ExtensionStore.ExtensionStore),
          (store) => () => Effect.succeed(Option.isNone(store) || store.value.isEnabled(id)),
        ),
      ).layer,
    ),
  );

/**
 * Takes `toolkitRegistration` as an argument: `McpHttpServer.ts` is loading when it calls this.
 * Registers each installed tool through the memo map the MCP layers were built with, so a tool
 * added later joins the same `McpServer`, and tells clients after every change to the list.
 */
export const layer = (register: typeof McpHttpServer.toolkitRegistration) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const store = yield* Effect.serviceOption(ExtensionStore.ExtensionStore);
      if (Option.isNone(store)) return;
      const server = yield* McpServer.McpServer;
      // Present while layers build; without it a registration would build a second McpServer.
      const memoMap = yield* Effect.serviceOption(Layer.CurrentMemoMap);
      if (Option.isNone(memoMap)) {
        return yield* Effect.logWarning("Extension tools need the layers' memo map.");
      }
      const scope = yield* Effect.scope;
      const services = yield* Effect.context<Layer.Services<ReturnType<typeof registerTool>>>();
      const live = new Map<string, InstalledTool>();
      const advertised = new Map<string, string>();

      const reconcile = Effect.gen(function* () {
        const tools = (yield* store.value.serverModules).flatMap(readInstalledTools);
        const names = new Set(tools.map(({ name }) => name));
        for (const name of live.keys()) if (!names.has(name)) live.delete(name);
        for (const tool of tools) live.set(tool.name, tool);
        for (const tool of tools) {
          const shape = `${tool.readOnly}:${tool.description}`;
          if (advertised.get(tool.name) === shape) continue;
          advertised.set(tool.name, shape);
          yield* Layer.buildWithMemoMap(
            registerTool(register, tool, live),
            memoMap.value,
            scope,
          ).pipe(Effect.provideContext(services));
        }
        yield* server.notifications["notifications/tools/list_changed"]({});
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("The extension tools could not be updated.", { cause }),
        ),
      );

      yield* reconcile;
      // The first value is the list just reconciled; a change before the stream starts is
      // still among the later ones, and reconciling twice changes nothing.
      yield* store.value.changes.pipe(
        Stream.runForEach(() => reconcile),
        Effect.forkScoped,
      );
    }),
  ).pipe(Layer.provide(McpServer.McpServer.layer));
