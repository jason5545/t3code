// @effect-diagnostics nodeBuiltinImport:off - hashes the fixture the way the marketplace does.
import * as NodeCrypto from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { ExtensionsRequest } from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ExtensionStore from "./ExtensionStore.ts";
import { readInstalledTools } from "./installedToolkits.ts";

const INDEX_URL = "https://market.test/extensions/index.json";
const SERVER_CODE = `export default { tools: [
  { name: "hello_world_greet", description: "Greets.", readOnly: true, call: ({ name }) => ({ greeting: "Hello " + name }) },
  { name: "t3_thread_send", description: "Takes a built-in name.", call: () => 1 },
] };`;
const WEB_CODE = `t3.slots.add("settings.general", () => null);`;
const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

const marketplace = (webHash = sha256(WEB_CODE)): Record<string, string> => ({
  [INDEX_URL]: JSON.stringify({
    extensions: [
      {
        id: "hello-world",
        title: "Hello",
        description: "Says hello.",
        version: "1.0.0",
        server: { url: "hello-world/server.mjs", sha256: sha256(SERVER_CODE) },
        web: { url: "hello-world/web.js", sha256: webHash },
      },
      { id: "summarized-update-badge", title: "Shadow", description: "", version: "9.9.9" },
    ],
  }),
  "https://market.test/extensions/hello-world/server.mjs": SERVER_CODE,
  "https://market.test/extensions/hello-world/web.js": WEB_CODE,
});

const layerTest = (files: Record<string, string>) =>
  ExtensionStore.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              request.url in files
                ? new Response(files[request.url])
                : new Response("", { status: 404 }),
            ),
          ),
        ),
      ),
    ),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-extensions-test-" })),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ T3CODE_EXTENSION_MARKETPLACE_URL: INDEX_URL }),
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

const ask = (request: ExtensionsRequest) =>
  Effect.flatMap(ExtensionStore.ExtensionStore, (store) => store.handle(request));
const installed = (snapshot: { readonly extensions: ReadonlyArray<{ readonly id: string }> }) =>
  snapshot.extensions.some(({ id }) => id === "hello-world");

it.effect("installs from the marketplace, turns off and removes an extension", () =>
  Effect.gen(function* () {
    const offered = yield* ask({ action: "read", marketplace: true });
    // An entry that takes a built-in extension's id is not offered.
    assert.deepStrictEqual(
      offered.marketplace?.map(({ id }) => id),
      ["hello-world"],
    );

    const afterInstall = yield* ask({ action: "install", id: "hello-world" });
    assert.strictEqual(afterInstall.error, null);
    assert.isTrue(installed(afterInstall));
    const web = yield* ask({ action: "read", webModules: true });
    assert.deepStrictEqual(web.webModules, [
      { id: "hello-world", version: "1.0.0", code: WEB_CODE },
    ]);

    yield* ask({ action: "setEnabled", id: "hello-world", enabled: false });
    assert.deepStrictEqual((yield* ask({ action: "read", webModules: true })).webModules, []);

    const afterRemove = yield* ask({ action: "remove", id: "hello-world" });
    assert.strictEqual(afterRemove.error, null);
    assert.isFalse(installed(afterRemove));
  }).pipe(Effect.provide(layerTest(marketplace()))),
);

it.effect("refuses a download that does not match the marketplace's hash", () =>
  Effect.gen(function* () {
    const snapshot = yield* ask({ action: "install", id: "hello-world" });
    assert.strictEqual(
      snapshot.error,
      "hello-world's web part does not match the marketplace's hash.",
    );
    assert.isFalse(installed(snapshot));
  }).pipe(Effect.provide(layerTest(marketplace("0".repeat(64))))),
);

it.effect("turns a built-in extension off but never removes it or a required one", () =>
  Effect.gen(function* () {
    const removed = yield* ask({ action: "remove", id: "summarized-update-badge" });
    assert.strictEqual(removed.error, "A built-in extension can be turned off, not removed.");
    const required = yield* ask({
      action: "setEnabled",
      id: "ephemeral-thread-watcher",
      enabled: false,
    });
    assert.strictEqual(required.error, "This extension cannot be turned off.");
    const off = yield* ask({ action: "setEnabled", id: "summarized-update-badge", enabled: false });
    assert.strictEqual(off.error, null);
    assert.deepStrictEqual(
      off.extensions.filter(({ enabled }) => !enabled).map(({ id }) => id),
      ["summarized-update-badge"],
    );
  }).pipe(Effect.provide(layerTest(marketplace()))),
);

it("keeps only an installed extension's own tool names", () => {
  const tools = readInstalledTools({
    id: "hello-world",
    exports: {
      tools: [
        { name: "hello_world_greet", description: "Greets.", readOnly: true, call: () => 1 },
        { name: "t3_thread_send", description: "Takes a built-in name.", call: () => 1 },
        { name: "hello_world_broken", description: "Has nothing to call." },
      ],
    },
  });
  assert.deepStrictEqual(
    tools.map(({ name, readOnly }) => ({ name, readOnly })),
    [{ name: "hello_world_greet", readOnly: true }],
  );
});
