import type { Extension } from "@t3tools/shared/extensions";
import type * as Layer from "effect/Layer";

import type * as McpHttpServer from "../mcp/McpHttpServer.ts";

/** Where fork extensions add to the server. Services stay optional layers in `server.ts`. */
export interface ServerExtensionPoints {
  /**
   * MCP toolkits advertised beside the built-in ones. Each takes `toolkitRegistration` as an
   * argument, because `McpHttpServer.ts` is still loading when it reads this point.
   */
  readonly mcpToolkits: (
    register: typeof McpHttpServer.toolkitRegistration,
  ) => Layer.Layer<never, never, Layer.Services<typeof McpHttpServer.layerThreadToolkit>>;
}

export type ServerExtension = Extension<ServerExtensionPoints>;
