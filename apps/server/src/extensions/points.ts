import type { Extension } from "@t3tools/shared/extensions";
import type * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Layer from "effect/Layer";
import type * as Path from "effect/Path";

import type * as ServerConfig from "../config.ts";
import type * as McpHttpServer from "../mcp/McpHttpServer.ts";
import type * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

/**
 * What a built-in extension call can use. Each must be a service `server.ts` provides where it
 * builds `ExtensionCalls.layer`; add one there and here when a call needs it.
 */
export type ExtensionCallServices =
  | FileSystem.FileSystem
  | Path.Path
  | ServerConfig.ServerConfig
  | ProjectionStore.ProjectionStoreV2;

export interface BuiltInExtensionCall {
  /** A read needs `orchestration:read`; anything else needs `orchestration:operate`. */
  readonly readOnly?: boolean;
  /** Takes the web part's input as decoded JSON; the result goes back as JSON. */
  readonly call: (input: unknown) => Effect.Effect<unknown, unknown, ExtensionCallServices>;
}

/** Where fork extensions add to the server. Services stay optional layers in `server.ts`. */
export interface ServerExtensionPoints {
  /**
   * MCP toolkits advertised beside the built-in ones. Each takes `toolkitRegistration` as an
   * argument, because `McpHttpServer.ts` is still loading when it reads this point.
   */
  readonly mcpToolkits: (
    register: typeof McpHttpServer.toolkitRegistration,
  ) => Layer.Layer<never, never, Layer.Services<typeof McpHttpServer.layerThreadToolkit>>;
  /** Methods the extension's web code calls with `POST /api/extensions/call`, by name. */
  readonly extensionCalls: { readonly [method: string]: BuiltInExtensionCall };
}

export type ServerExtension = Extension<ServerExtensionPoints>;
