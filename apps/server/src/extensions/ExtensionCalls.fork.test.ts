// @effect-diagnostics nodeBuiltinImport:off - hashes the fixtures the way the marketplace does.
import * as NodeCrypto from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { ExtensionCallRequest, ExtensionsRequest } from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ExtensionCalls from "./ExtensionCalls.ts";
import * as ExtensionHostApi from "./ExtensionHostApi.ts";
import * as ExtensionStore from "./ExtensionStore.ts";

const INDEX_URL = "https://market.test/extensions/index.json";
const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

const serverCode = (version: string) => `export default { calls: {
  ping: { readOnly: true, call: (input) => ({ pong: input, version: ${JSON.stringify(version)} }) },
  rename(input) { return this.ping.call(input).version + ":" + input; },
  hang: () => new Promise(() => {}),
  boom: () => { throw new Error("it broke"); },
  huge: () => "x".repeat(2 * 1024 * 1024),
  api: { readOnly: true, call: async (_input, { t3 }) => ({
    apiVersion: t3?.apiVersion ?? null,
    run: t3 === undefined ? "absent" : (await t3.runs.activity("thread:none")).run,
  }) },
} };`;

/** A marketplace whose files the test can change between installs. */
const makeMarketplace = () => {
  const files = new Map<string, string>();
  const publish = (version: string) => {
    const code = serverCode(version);
    files.set("https://market.test/extensions/hello-world/server.mjs", code);
    files.set(
      INDEX_URL,
      JSON.stringify({
        extensions: [
          {
            id: "hello-world",
            title: "Hello",
            description: "Says hello.",
            version,
            server: { url: "hello-world/server.mjs", sha256: sha256(code) },
          },
        ],
      }),
    );
  };
  publish("1.0.0");
  return { files, publish };
};

const builtIns = [
  {
    id: "summarized-update-badge",
    contribution: {
      // Uses a server service, as the board's calls will.
      where: {
        readOnly: true,
        call: (input: unknown) =>
          Effect.map(Path.Path, (path) => path.join("/board", String(input))),
      },
    },
  },
];

const layerTest = (files: ReadonlyMap<string, string>) =>
  ExtensionCalls.layerWith(builtIns).pipe(
    Layer.provide(ExtensionHostApi.layer),
    Layer.provideMerge(ExtensionStore.layer),
    Layer.provide(ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory))),
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              files.has(request.url)
                ? new Response(files.get(request.url))
                : new Response("", { status: 404 }),
            ),
          ),
        ),
      ),
    ),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-extension-calls-" })),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ T3CODE_EXTENSION_MARKETPLACE_URL: INDEX_URL }),
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

const manage = (request: ExtensionsRequest) =>
  Effect.flatMap(ExtensionStore.ExtensionStore, (store) => store.handle(request));

/** Runs a call as the endpoint does once the scope is checked; `readOnly` is what it checked. */
const call = (request: ExtensionCallRequest) =>
  Effect.gen(function* () {
    const prepared = yield* (yield* ExtensionCalls.ExtensionCalls).prepare(request);
    if (prepared._tag === "Refused") return { refused: prepared.error };
    return { readOnly: prepared.readOnly, result: yield* prepared.run };
  });

it.effect("runs a built-in method with the server's services until it is turned off", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(
      yield* call({ id: "summarized-update-badge", method: "where", input: "strips" }),
      { readOnly: true, result: { ok: true, value: "/board/strips" } },
    );
    yield* manage({ action: "setEnabled", id: "summarized-update-badge", enabled: false });
    assert.deepStrictEqual(
      yield* call({ id: "summarized-update-badge", method: "where", input: "strips" }),
      { refused: '"summarized-update-badge" is turned off.' },
    );
  }).pipe(Effect.provide(layerTest(makeMarketplace().files))),
);

it.effect("runs an installed method for its own id only, and refuses it once off", () =>
  Effect.gen(function* () {
    yield* manage({ action: "install", id: "hello-world" });
    assert.deepStrictEqual(yield* call({ id: "hello-world", method: "ping", input: { n: 1 } }), {
      readOnly: true,
      result: { ok: true, value: { pong: { n: 1 }, version: "1.0.0" } },
    });
    // A plain function is a write, and runs with its `calls` object as `this`.
    assert.deepStrictEqual(yield* call({ id: "hello-world", method: "rename", input: "a" }), {
      readOnly: false,
      result: { ok: true, value: "1.0.0:a" },
    });
    // An installed call reads the server through `context.t3`.
    assert.deepStrictEqual(yield* call({ id: "hello-world", method: "api" }), {
      readOnly: true,
      result: { ok: true, value: { apiVersion: 3, run: null } },
    });
    // The id picks the server part: no other extension's methods are reachable through it.
    assert.deepStrictEqual(yield* call({ id: "other-extension", method: "ping" }), {
      refused: '"other-extension" is not installed.',
    });
    assert.deepStrictEqual(yield* call({ id: "summarized-update-badge", method: "ping" }), {
      refused: '"summarized-update-badge" has no method "ping".',
    });
    assert.deepStrictEqual(yield* call({ id: "hello-world", method: "where" }), {
      refused: '"hello-world" has no method "where".',
    });
    assert.deepStrictEqual(yield* call({ id: "hello-world", method: "toString" }), {
      refused: '"hello-world" has no method "toString".',
    });

    yield* manage({ action: "setEnabled", id: "hello-world", enabled: false });
    assert.deepStrictEqual(yield* call({ id: "hello-world", method: "ping" }), {
      refused: '"hello-world" is turned off.',
    });
    yield* manage({ action: "setEnabled", id: "hello-world", enabled: true });
    yield* manage({ action: "remove", id: "hello-world" });
    assert.deepStrictEqual(yield* call({ id: "hello-world", method: "ping" }), {
      refused: '"hello-world" is not installed.',
    });
  }).pipe(Effect.provide(layerTest(makeMarketplace().files))),
);

it.effect("answers a failing, oversized or silent handler with an error", () =>
  Effect.gen(function* () {
    yield* manage({ action: "install", id: "hello-world" });
    assert.deepStrictEqual(yield* call({ id: "hello-world", method: "boom" }), {
      readOnly: false,
      result: { ok: false, error: "hello-world.boom failed: it broke" },
    });
    assert.deepStrictEqual(yield* call({ id: "hello-world", method: "huge" }), {
      readOnly: false,
      result: { ok: false, error: "hello-world.huge returned more than 1 MiB." },
    });
    // Loading the server part reads a file, so it happens before the clock moves.
    const hang = yield* (yield* ExtensionCalls.ExtensionCalls).prepare({
      id: "hello-world",
      method: "hang",
    });
    assert.strictEqual(hang._tag, "Ready");
    if (hang._tag !== "Ready") return;
    const hanging = yield* Effect.forkChild(hang.run);
    yield* TestClock.adjust("30 seconds");
    assert.deepStrictEqual(yield* Fiber.join(hanging), {
      ok: false,
      error: "hello-world.hang failed: no answer within 30 seconds",
    });
    // The server keeps answering.
    assert.deepStrictEqual(yield* call({ id: "hello-world", method: "ping", input: 2 }), {
      readOnly: true,
      result: { ok: true, value: { pong: 2, version: "1.0.0" } },
    });
  }).pipe(Effect.provide(layerTest(makeMarketplace().files))),
);

it.effect("runs a reinstalled server part's new code without a restart", () => {
  const marketplace = makeMarketplace();
  return Effect.gen(function* () {
    yield* manage({ action: "install", id: "hello-world" });
    assert.deepStrictEqual(yield* call({ id: "hello-world", method: "ping", input: 0 }), {
      readOnly: true,
      result: { ok: true, value: { pong: 0, version: "1.0.0" } },
    });
    marketplace.publish("2.0.0");
    assert.strictEqual((yield* manage({ action: "install", id: "hello-world" })).error, null);
    assert.deepStrictEqual(yield* call({ id: "hello-world", method: "ping", input: 0 }), {
      readOnly: true,
      result: { ok: true, value: { pong: 0, version: "2.0.0" } },
    });
  }).pipe(Effect.provide(layerTest(marketplace.files)));
});
