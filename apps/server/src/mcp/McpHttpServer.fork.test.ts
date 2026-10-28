import { expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import { EnvironmentId, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import * as McpHttpServer from "./McpHttpServer.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as McpToolAccess from "./McpToolAccess.ts";
import * as ServerSettings from "../serverSettings.ts";

const ownerMachine: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-mcp-fork-test"),
  requestNamespace: "client:owner-machine",
  thread: undefined,
  client: { sessionId: "owner-machine", label: "agent-hub (Tailscale)", access: "full-access" },
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

it.effect("lets the client authenticator admit a request that carries no token", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const ProbeToolkit = Toolkit.make(
        Tool.make("probe", {
          description: "Reports the caller.",
          success: Schema.Struct({ caller: Schema.String }),
          failure: OrchestratorMcpFailure,
          failureMode: "return",
          dependencies: [McpInvocationContext.McpInvocationContext],
        }),
      );
      const serverLayer = McpHttpServer.toolkitRegistration(
        ProbeToolkit,
        McpToolAccess.toLayer(ProbeToolkit, {
          probe: McpToolAccess.reads(() =>
            McpInvocationContext.McpInvocationContext.pipe(
              Effect.map((scope) => ({ caller: scope.requestNamespace })),
            ),
          ),
        }),
      ).pipe(
        Layer.provideMerge(
          McpHttpServer.layerMcpTransport.pipe(Layer.provide(ServerSettings.layerTest())),
        ),
        Layer.provide(
          Layer.mock(McpSessionRegistry.McpSessionRegistry)({
            resolve: () => Effect.undefined,
          }),
        ),
        Layer.provide(
          Layer.succeed(McpHttpServer.McpClientAuthenticator, {
            // Stands in for a tailnet whois on the connection's peer.
            authenticate: (request) =>
              Effect.succeed(request.headers["x-test-peer"] === "owner" ? ownerMachine : undefined),
          }),
        ),
      );
      yield* HttpRouter.serve(serverLayer, { disableListenLog: true, disableLogger: true }).pipe(
        Layer.build,
      );
      const httpClient = yield* HttpClient.HttpClient;
      const initialize = (peer: string) =>
        httpClient.post("/mcp", {
          headers: { accept: "application/json, text/event-stream", "x-test-peer": peer },
          body: HttpBody.text(
            `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}`,
            "application/json",
          ),
        });

      expect((yield* initialize("owner")).status).toBe(200);
      const stranger = yield* initialize("stranger");
      expect(stranger.status).toBe(401);
      expect(stranger.headers["www-authenticate"]).toContain("resource_metadata=");
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
