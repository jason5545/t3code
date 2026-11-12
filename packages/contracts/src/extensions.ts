import * as Schema from "effect/Schema";

/** Fork patch 30: extensions a server carries or installed from the marketplace. */
export const ExtensionEntry = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  /** Null for an extension the build carries. */
  version: Schema.NullOr(Schema.String),
  builtIn: Schema.Boolean,
  /** A built-in the rest of its feature depends on; it cannot be turned off. */
  required: Schema.Boolean,
  enabled: Schema.Boolean,
});
export type ExtensionEntry = typeof ExtensionEntry.Type;

export const ExtensionMarketplaceEntry = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  version: Schema.String,
});
export type ExtensionMarketplaceEntry = typeof ExtensionMarketplaceEntry.Type;

/** An installed extension's web part: a script body that receives the extension API as `t3`. */
export const ExtensionWebModule = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  code: Schema.String,
});
export type ExtensionWebModule = typeof ExtensionWebModule.Type;

export const ExtensionsRequest = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("read"),
    marketplace: Schema.optional(Schema.Boolean),
    webModules: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ action: Schema.Literals(["install", "remove"]), id: Schema.String }),
  Schema.Struct({
    action: Schema.Literal("setEnabled"),
    id: Schema.String,
    enabled: Schema.Boolean,
  }),
]);
export type ExtensionsRequest = typeof ExtensionsRequest.Type;

export const ExtensionsSnapshot = Schema.Struct({
  extensions: Schema.Array(ExtensionEntry),
  marketplaceUrl: Schema.String,
  /** Null unless the request asked for it. */
  marketplace: Schema.NullOr(Schema.Array(ExtensionMarketplaceEntry)),
  /** Enabled installed extensions' web parts; null unless the request asked for them. */
  webModules: Schema.NullOr(Schema.Array(ExtensionWebModule)),
  /** Why the request's action or the marketplace read failed, for the person to read. */
  error: Schema.NullOr(Schema.String),
});
export type ExtensionsSnapshot = typeof ExtensionsSnapshot.Type;
