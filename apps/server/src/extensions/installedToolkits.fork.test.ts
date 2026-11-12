import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpServer } from "effect/ai";

import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ExtensionStore from "./ExtensionStore.ts";
import * as InstalledToolkits from "./installedToolkits.ts";

const layerTest = InstalledToolkits.layer(McpHttpServer.toolkitRegistration).pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provide(
    Layer.mock(ExtensionStore.ExtensionStore)({
      enabledAtStartup: () => true,
      serverModules: Effect.succeed([
        {
          id: "hello-world",
          exports: {
            tools: [
              { name: "hello_world_greet", description: "Greets.", readOnly: true, call: () => 1 },
              { name: "hello_world_reset", description: "Resets.", call: () => 1 },
            ],
          },
        },
      ]),
    }),
  ),
  Layer.provide(Layer.mock(ThreadManagementService.ThreadManagementService)({})),
);

it.effect("advertises an installed extension's tools beside the server's own", () =>
  Effect.gen(function* () {
    const mcp = yield* McpServer.McpServer;
    assert.deepStrictEqual(
      mcp.tools.map(({ tool }) => ({
        name: tool.name,
        description: tool.description,
        readOnly: tool.annotations?.readOnlyHint,
      })),
      [
        { name: "hello_world_greet", description: "Greets.", readOnly: true },
        { name: "hello_world_reset", description: "Resets.", readOnly: false },
      ],
    );
  }).pipe(Effect.provide(layerTest)),
);
