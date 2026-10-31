// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { lookupClaudeNativeLatestVersion } from "./ClaudeNativeRelease.ts";

const releases: Record<string, string> = {
  "/claude-code-releases/latest": "2.1.314\n",
  "/claude-code-releases/stable": "2.1.308\n",
};
const releaseBucket = HttpClient.make((request) => {
  const body = releases[new URL(request.url).pathname];
  return Effect.succeed(
    HttpClientResponse.fromWeb(request, new Response(body ?? "", { status: body ? 200 : 404 })),
  );
});

const lookup = (settings: string | null, client = releaseBucket) => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "claude-native-release-"));
  const settingsPath = NodePath.join(dir, "settings.json");
  if (settings !== null) NodeFS.writeFileSync(settingsPath, settings);
  return lookupClaudeNativeLatestVersion(settingsPath).pipe(
    Effect.provide(NodeServices.layer),
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true }))),
  );
};

it.effect("follows the update channel claude update reads from settings.json", () =>
  Effect.gen(function* () {
    expect(yield* lookup(null)).toBe("2.1.314");
    expect(yield* lookup('{"autoUpdatesChannel":"latest"}')).toBe("2.1.314");
    expect(yield* lookup('{"autoUpdatesChannel":"stable"}')).toBe("2.1.308");
    expect(yield* lookup("not json")).toBe("2.1.314");
  }),
);

it.effect("reports an unknown latest when the bucket does not answer with a version", () =>
  Effect.gen(function* () {
    const html = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response("<html>blocked</html>"))),
    );
    const down = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response("", { status: 503 }))),
    );
    expect(yield* lookup(null, html)).toBeNull();
    expect(yield* lookup(null, down)).toBeNull();
  }),
);
