// @effect-diagnostics nodeBuiltinImport:off - hashes downloads and resolves module file URLs.
import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";

import type {
  ExtensionEntry,
  ExtensionMarketplaceEntry,
  ExtensionsRequest,
  ExtensionsSnapshot,
  ExtensionWebModule,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { BUILT_IN_EXTENSIONS } from "@t3tools/shared/builtInExtensions";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/http";

import * as ServerConfig from "../config.ts";

/**
 * Fork patch 30: the extensions this server carries or installed from the marketplace, kept
 * under `<state>/extensions`. Built-in ones can only be turned off. Every change applies while
 * the server runs: `changes` tells the MCP layer to load, hide or replace server parts.
 */
const MarketplaceUrl = Config.String("T3CODE_EXTENSION_MARKETPLACE_URL").pipe(
  Config.withDefault("https://t3.hiroki.im/extensions/index.json"),
);

const MAX_MODULE_BYTES = 2 * 1024 * 1024;
// Below the 10 seconds a connect attempt may hang, so the person hears back sooner.
const FETCH_TIMEOUT = Duration.seconds(6);
const EXTENSION_ID = /^[a-z][a-z0-9-]{1,63}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const ModuleReference = Schema.Struct({ url: Schema.String, sha256: Schema.String });
const MarketplaceExtension = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  version: Schema.String,
  server: Schema.optional(ModuleReference),
  web: Schema.optional(ModuleReference),
});
const decodeMarketplaceIndex = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ extensions: Schema.Array(MarketplaceExtension) })),
);

const InstalledExtension = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  version: Schema.String,
  server: Schema.Boolean,
  web: Schema.Boolean,
});
type InstalledExtension = typeof InstalledExtension.Type;
const ExtensionState = Schema.Struct({
  disabled: Schema.Array(Schema.String),
  installed: Schema.Array(InstalledExtension),
});
type ExtensionState = typeof ExtensionState.Type;
const ExtensionStateJson = Schema.fromJsonString(ExtensionState);
const decodeState = Schema.decodeUnknownOption(ExtensionStateJson);
const encodeState = Schema.encodeSync(ExtensionStateJson);

const EMPTY_STATE: ExtensionState = { disabled: [], installed: [] };
const BUILT_IN_IDS = new Set(BUILT_IN_EXTENSIONS.map(({ id }) => id));
const REQUIRED_IDS = new Set(
  BUILT_IN_EXTENSIONS.flatMap(({ id, required }) => (required ? [id] : [])),
);

export class ExtensionError extends Schema.TaggedError<ExtensionError>()("ExtensionError", {
  /** Shown to the person as it is. */
  detail: Schema.String,
}) {}
const refuse = (detail: string) => new ExtensionError({ detail });

/** A module may come from any https host, or from this machine for testing a marketplace. */
const resolveModuleUrl = (reference: string, base: string) =>
  Effect.try({
    try: () => new URL(reference, base),
    catch: () => refuse(`"${reference}" is not a URL.`),
  }).pipe(
    Effect.filterOrFail(
      (url) =>
        url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)),
      (url) => refuse(`${url.href} must be an https address.`),
    ),
  );

export interface LoadedServerModule {
  readonly id: string;
  /** The module's default export, unchecked. */
  readonly exports: unknown;
}

export class ExtensionStore extends Context.Service<
  ExtensionStore,
  {
    /** Runs a request and answers with the resulting state; a refusal is the snapshot's `error`. */
    readonly handle: (request: ExtensionsRequest) => Effect.Effect<ExtensionsSnapshot>;
    /** Whether an extension is on now. */
    readonly isEnabled: (id: string) => boolean;
    /** The current list first, then once after every change to it. */
    readonly changes: Stream.Stream<unknown>;
    /** The server parts of the installed extensions that are on now. */
    readonly serverModules: Effect.Effect<ReadonlyArray<LoadedServerModule>>;
    /** One installed extension's server part, refused while it is off or absent. */
    readonly serverModule: (id: string) => Effect.Effect<LoadedServerModule, ExtensionError>;
  }
>()("t3/extensions/ExtensionStore") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const marketplaceUrl = yield* MarketplaceUrl;
  const directory = path.join(config.stateDir, "extensions");
  const stateFile = path.join(directory, "state.json");
  const moduleFile = (id: string, part: "server" | "web") =>
    path.join(directory, id, part === "server" ? "server.mjs" : "web.js");

  const state = yield* fileSystem.readFileString(stateFile).pipe(
    Effect.map((text) => Option.getOrElse(decodeState(text), () => EMPTY_STATE)),
    Effect.orElseSucceed(() => EMPTY_STATE),
    Effect.flatMap(SubscriptionRef.make),
  );
  const mutations = yield* Semaphore.make(1);

  const save = (next: ExtensionState) =>
    writeFileStringAtomically({ filePath: stateFile, contents: encodeState(next) }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.mapError(() => refuse("The extension list could not be saved.")),
      Effect.andThen(SubscriptionRef.set(state, next)),
    );

  const fetchText = Effect.fn("ExtensionStore.fetchText")(function* (url: URL) {
    const response = yield* http.get(url.href).pipe(
      Effect.mapError(() => refuse(`${url.href} could not be reached.`)),
      Effect.timeoutOrElse({
        duration: FETCH_TIMEOUT,
        orElse: () => Effect.fail(refuse("The marketplace did not answer in time.")),
      }),
    );
    if (response.status !== 200) {
      return yield* refuse(`${url.href} answered ${response.status}.`);
    }
    return yield* response.text.pipe(
      Effect.mapError(() => refuse(`${url.href} could not be read.`)),
    );
  });

  const readMarketplace = resolveModuleUrl(marketplaceUrl, marketplaceUrl).pipe(
    Effect.flatMap(fetchText),
    Effect.flatMap((text) =>
      decodeMarketplaceIndex(text).pipe(
        Effect.mapError(() => refuse("The marketplace index is not in the expected format.")),
      ),
    ),
    Effect.map(({ extensions }) =>
      extensions.filter(({ id }) => EXTENSION_ID.test(id) && !BUILT_IN_IDS.has(id)),
    ),
  );

  const download = Effect.fn("ExtensionStore.download")(function* (
    id: string,
    part: "server" | "web",
    reference: typeof ModuleReference.Type,
  ) {
    const code = yield* resolveModuleUrl(reference.url, marketplaceUrl).pipe(
      Effect.flatMap(fetchText),
    );
    const bytes = new TextEncoder().encode(code);
    if (bytes.byteLength > MAX_MODULE_BYTES) {
      return yield* refuse(`${id}'s ${part} part is larger than 2 MiB.`);
    }
    const digest = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== reference.sha256.toLowerCase()) {
      return yield* refuse(`${id}'s ${part} part does not match the marketplace's hash.`);
    }
    return code;
  });

  const writeModules = Effect.fn("ExtensionStore.writeModules")(
    function* (id: string, parts: ReadonlyArray<readonly ["server" | "web", string]>) {
      yield* fileSystem.remove(path.join(directory, id), { recursive: true, force: true });
      yield* fileSystem.makeDirectory(path.join(directory, id), { recursive: true });
      for (const [part, code] of parts) {
        yield* fileSystem.writeFileString(moduleFile(id, part), code);
      }
    },
    (effect, id) => Effect.mapError(effect, () => refuse(`${id} could not be written to disk.`)),
  );

  const install = Effect.fn("ExtensionStore.install")(function* (id: string) {
    const offered = (yield* readMarketplace).find((extension) => extension.id === id);
    if (offered === undefined) return yield* refuse(`The marketplace does not list "${id}".`);
    const parts: Array<readonly ["server" | "web", string]> = [];
    if (offered.server) parts.push(["server", yield* download(id, "server", offered.server)]);
    if (offered.web) parts.push(["web", yield* download(id, "web", offered.web)]);
    if (parts.length === 0) return yield* refuse(`"${id}" has nothing to install.`);
    yield* writeModules(id, parts);
    const current = yield* SubscriptionRef.get(state);
    yield* save({
      disabled: current.disabled.filter((disabled) => disabled !== id),
      installed: [
        ...current.installed.filter((installed) => installed.id !== id),
        {
          id,
          title: offered.title,
          description: offered.description,
          version: offered.version,
          server: offered.server !== undefined,
          web: offered.web !== undefined,
        },
      ],
    });
  });

  const remove = Effect.fn("ExtensionStore.remove")(function* (id: string) {
    if (BUILT_IN_IDS.has(id)) {
      return yield* refuse("A built-in extension can be turned off, not removed.");
    }
    const current = yield* SubscriptionRef.get(state);
    if (!current.installed.some((installed) => installed.id === id)) {
      return yield* refuse(`"${id}" is not installed.`);
    }
    yield* save({
      disabled: current.disabled.filter((disabled) => disabled !== id),
      installed: current.installed.filter((installed) => installed.id !== id),
    });
    yield* fileSystem
      .remove(path.join(directory, id), { recursive: true, force: true })
      .pipe(Effect.ignore);
  });

  const setEnabled = Effect.fn("ExtensionStore.setEnabled")(function* (
    id: string,
    enabled: boolean,
  ) {
    const current = yield* SubscriptionRef.get(state);
    if (!BUILT_IN_IDS.has(id) && !current.installed.some((installed) => installed.id === id)) {
      return yield* refuse(`"${id}" is not installed.`);
    }
    if (!enabled && REQUIRED_IDS.has(id)) {
      return yield* refuse("This extension cannot be turned off.");
    }
    const disabled = current.disabled.filter((other) => other !== id);
    yield* save({ ...current, disabled: enabled ? disabled : [...disabled, id] });
  });

  const readWebModules = (current: ExtensionState) =>
    Effect.forEach(
      current.installed.filter(({ id, web }) => web && !current.disabled.includes(id)),
      ({ id, version }) =>
        fileSystem.readFileString(moduleFile(id, "web")).pipe(
          Effect.map((code): Option.Option<ExtensionWebModule> =>
            Option.some({ id, version, code }),
          ),
          Effect.orElseSucceed(() => Option.none<ExtensionWebModule>()),
        ),
    ).pipe(Effect.map((modules) => modules.flatMap(Option.toArray)));

  const entries = (current: ExtensionState): ReadonlyArray<ExtensionEntry> => [
    ...BUILT_IN_EXTENSIONS.map(({ id, title, description, required }) => ({
      id,
      title,
      description,
      version: null,
      builtIn: true,
      required: required === true,
      enabled: !current.disabled.includes(id),
    })),
    ...current.installed.map(({ id, title, description, version }) => ({
      id,
      title,
      description,
      version,
      builtIn: false,
      required: false,
      enabled: !current.disabled.includes(id),
    })),
  ];

  const handle: ExtensionStore["Service"]["handle"] = Effect.fn("ExtensionStore.handle")(
    function* (request) {
      const action =
        request.action === "install"
          ? install(request.id)
          : request.action === "remove"
            ? remove(request.id)
            : request.action === "setEnabled"
              ? setEnabled(request.id, request.enabled)
              : Effect.void;
      const actionError = yield* mutations
        .withPermit(action)
        .pipe(
          Effect.as(null),
          Effect.catchTags({ ExtensionError: (error) => Effect.succeed(error.detail) }),
        );
      // Only when asked: the marketplace is another server, and a change to the list must not
      // wait for it.
      const wantsMarketplace = request.action === "read" && request.marketplace === true;
      const marketplace: {
        readonly offered: ReadonlyArray<ExtensionMarketplaceEntry> | null;
        readonly error: string | null;
      } = wantsMarketplace
        ? yield* readMarketplace.pipe(
            Effect.map((offered) => ({
              offered: offered.map(({ id, title, description, version }) => ({
                id,
                title,
                description,
                version,
              })),
              error: null,
            })),
            Effect.catchTags({
              ExtensionError: (error) => Effect.succeed({ offered: null, error: error.detail }),
            }),
          )
        : { offered: null, error: null };
      const current = yield* SubscriptionRef.get(state);
      return {
        extensions: entries(current),
        marketplaceUrl,
        marketplace: marketplace.offered,
        // After a change the client replaces what it loaded, so it always gets the web parts.
        webModules:
          request.action !== "read" || request.webModules === true
            ? yield* readWebModules(current)
            : null,
        error: actionError ?? marketplace.error,
      };
    },
  );

  // Node keeps every module it imported, so the URL carries the file's hash: a reinstall loads
  // the new code, and an unchanged file is the module already loaded.
  const importServerModule = Effect.fn("ExtensionStore.importServerModule")(function* (id: string) {
    const file = moduleFile(id, "server");
    const code = yield* fileSystem
      .readFileString(file)
      .pipe(Effect.mapError(() => refuse(`${file} could not be read.`)));
    const hash = NodeCrypto.createHash("sha256").update(code).digest("hex");
    return yield* Effect.tryPromise({
      try: () =>
        import(`${NodeURL.pathToFileURL(file).href}?v=${hash}`) as Promise<{
          readonly default?: unknown;
        }>,
      catch: (cause) => refuse(String(cause)),
    });
  });

  const serverModule = Effect.fn("ExtensionStore.serverModule")(function* (id: string) {
    const current = SubscriptionRef.getUnsafe(state);
    const installed = current.installed.find((extension) => extension.id === id);
    if (installed === undefined) return yield* refuse(`"${id}" is not installed.`);
    if (current.disabled.includes(id)) return yield* refuse(`"${id}" is turned off.`);
    if (!installed.server) return yield* refuse(`"${id}" has no server part.`);
    const module = yield* importServerModule(id);
    return { id, exports: module.default };
  });

  const serverModules = Effect.suspend(() => {
    const current = SubscriptionRef.getUnsafe(state);
    return Effect.forEach(
      current.installed.filter(({ id, server }) => server && !current.disabled.includes(id)),
      ({ id }) =>
        importServerModule(id).pipe(
          Effect.map((module): Option.Option<LoadedServerModule> =>
            Option.some({ id, exports: module.default }),
          ),
          Effect.catch((cause) =>
            Effect.logWarning("An extension's server part could not be loaded.", {
              id,
              cause: cause.detail,
            }).pipe(Effect.as(Option.none<LoadedServerModule>())),
          ),
        ),
    ).pipe(Effect.map((modules) => modules.flatMap(Option.toArray)));
  });

  return ExtensionStore.of({
    handle,
    isEnabled: (id) => !SubscriptionRef.getUnsafe(state).disabled.includes(id),
    changes: SubscriptionRef.changes(state),
    serverModules,
    serverModule,
  });
});

export const layer = Layer.effect(ExtensionStore, make);
