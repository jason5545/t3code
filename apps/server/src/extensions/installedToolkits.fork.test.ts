import { assert, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/ai";

import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ExtensionStore from "./ExtensionStore.ts";
import * as InstalledToolkits from "./installedToolkits.ts";

const greet = (description: string) => ({
  name: "hello_world_greet",
  description,
  readOnly: true,
  call: () => ({ greeting: description }),
});
const reset = { name: "hello_world_reset", description: "Resets.", call: () => 1 };
const helloWorld = (tools: ReadonlyArray<object>): ExtensionStore.LoadedServerModule => ({
  id: "hello-world",
  exports: { tools },
});

const BuiltInToolkit = Toolkit.make(
  Tool.make("built_in_ping", {
    description: "Pings.",
    success: Schema.String,
    dependencies: [McpInvocationContext.McpInvocationContext],
  }).annotate(Tool.Readonly, true),
);
const builtInHandlers = McpToolAccess.toLayer(BuiltInToolkit, {
  built_in_ping: McpToolAccess.reads(() => Effect.succeed("pong")),
});

const mcpClient = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "extensions", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "extensions", version: "1" },
  },
  getClient: Effect.die("unused"),
});
const caller: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:box"),
  requestNamespace: "client:extensions",
  thread: undefined,
  client: { sessionId: "extensions", label: "Extensions", access: "full-access", linked: false },
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
};
const call = (name: string) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) => server.callTool({ name, arguments: {} })),
    Effect.provideService(McpInvocationContext.McpInvocationContext, caller),
    Effect.provideService(McpSchema.McpServerClient, mcpClient),
    Effect.result,
  );
const answered = (result: Result.Result<McpSchema.CallToolResult, unknown>) =>
  Result.isSuccess(result) && result.success.isError !== true;

/**
 * A store whose server parts and switches the test changes. `settle` returns once the layer has
 * reconciled the new list: the stream is handled in order, so a second read of the same list
 * starts only after the first one was applied.
 */
const makeStore = Effect.gen(function* () {
  const modules = yield* SubscriptionRef.make<ReadonlyArray<ExtensionStore.LoadedServerModule>>([
    helloWorld([greet("Greets.")]),
  ]);
  const disabled = new Set<string>();
  const reads = yield* Queue.unbounded<ReadonlyArray<ExtensionStore.LoadedServerModule>>();
  const store = ExtensionStore.ExtensionStore.of({
    handle: () => Effect.die("unused"),
    isEnabled: (id) => !disabled.has(id),
    changes: SubscriptionRef.changes(modules),
    serverModules: SubscriptionRef.get(modules).pipe(
      Effect.tap((read) => Queue.offer(reads, read)),
    ),
  });
  const readOf = Effect.fn(function* (expected: ReadonlyArray<ExtensionStore.LoadedServerModule>) {
    while ((yield* Queue.take(reads)) !== expected) {
      // An earlier list's read.
    }
  });
  const settle = Effect.fn(function* (next: ReadonlyArray<ExtensionStore.LoadedServerModule>) {
    yield* SubscriptionRef.set(modules, next);
    yield* readOf(next);
    yield* SubscriptionRef.set(modules, next);
    yield* readOf(next);
  });
  return { store, disabled, settle };
});

const layerTest = (store: ExtensionStore.ExtensionStore["Service"]) =>
  Layer.mergeAll(
    InstalledToolkits.layer(McpHttpServer.toolkitRegistration),
    InstalledToolkits.hiddenWhileOff(
      "owner-machine-calls",
      McpHttpServer.toolkitRegistration(BuiltInToolkit, builtInHandlers),
    ),
  ).pipe(
    Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
    Layer.provide(Layer.succeed(ExtensionStore.ExtensionStore, store)),
    Layer.provide(Layer.mock(ThreadManagementService.ThreadManagementService)({})),
  );

const advertised = Effect.map(McpServer.McpServer, (mcp) =>
  mcp.tools.map(({ tool }) => ({
    name: tool.name,
    description: tool.description,
    readOnly: tool.annotations?.readOnlyHint,
  })),
);

it.effect("adds, replaces and hides an installed extension's tools while the server runs", () =>
  Effect.gen(function* () {
    const { store, settle } = yield* makeStore;
    yield* Effect.gen(function* () {
      assert.deepStrictEqual(yield* advertised, [
        { name: "hello_world_greet", description: "Greets.", readOnly: true },
        { name: "built_in_ping", description: "Pings.", readOnly: true },
      ]);
      assert.isTrue(answered(yield* call("hello_world_greet")));

      // An update replaces the description and adds a tool, without a restart.
      yield* settle([helloWorld([greet("Greets twice."), reset])]);
      assert.deepStrictEqual(yield* advertised, [
        { name: "hello_world_greet", description: "Greets twice.", readOnly: true },
        { name: "built_in_ping", description: "Pings.", readOnly: true },
        { name: "hello_world_reset", description: "Resets.", readOnly: false },
      ]);
      assert.isTrue(answered(yield* call("hello_world_reset")));

      // Turned off or removed: MCP cannot take a tool back, so it is hidden and refused.
      yield* settle([]);
      assert.isFalse(answered(yield* call("hello_world_greet")));
      assert.isFalse(answered(yield* call("hello_world_reset")));

      yield* settle([helloWorld([greet("Greets again.")])]);
      assert.isTrue(answered(yield* call("hello_world_greet")));
    }).pipe(Effect.provide(layerTest(store)));
  }),
);

it.effect("hides a built-in extension's toolkit while the extension is off", () =>
  Effect.gen(function* () {
    const { store, disabled } = yield* makeStore;
    yield* Effect.gen(function* () {
      assert.isTrue(answered(yield* call("built_in_ping")));
      disabled.add("owner-machine-calls");
      assert.isFalse(answered(yield* call("built_in_ping")));
      disabled.delete("owner-machine-calls");
      assert.isTrue(answered(yield* call("built_in_ping")));
    }).pipe(Effect.provide(layerTest(store)));
  }),
);
