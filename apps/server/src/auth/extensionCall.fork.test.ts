import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentHttpApi } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpRouter from "effect/http/HttpRouter";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ExtensionCalls from "../extensions/ExtensionCalls.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as AuthHttp from "./http.ts";

/** Fork patch 30: who may call an extension's server part over `POST /api/extensions/call`. */
const DEV_TOKEN = "reusable-dev-auth-token-that-is-long-enough";
class AuthTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.auth) {}

const layerConfig = Layer.effect(
  ServerConfig.ServerConfig,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return {
      ...config,
      mode: "web",
      devUrl: new URL("http://127.0.0.1:5173"),
      devAuthToken: Redacted.make(DEV_TOKEN),
    } satisfies ServerConfig.ServerConfig["Service"];
  }),
).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-extension-call-http-" })));

const layerCalls = ExtensionCalls.layerWith([
  {
    id: "summarized-update-badge",
    contribution: {
      look: { readOnly: true, call: () => Effect.succeed("looked") },
      change: { call: () => Effect.succeed("changed") },
    },
  },
]).pipe(
  Layer.provide(ProjectionStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory))),
  Layer.provide(layerConfig),
);

const layerRoutes = HttpApiBuilder.layer(AuthTestApi).pipe(
  Layer.provide(AuthHttp.layer),
  Layer.provide(AuthHttp.layerAuthenticatedAuth),
  Layer.provide(layerCalls),
  Layer.provideMerge(
    EnvironmentAuth.layer.pipe(
      Layer.provide(ManagedPolicy.layerTest()),
      Layer.provide(SqlitePersistence.layerMemory),
      Layer.provide(ServerSecretStore.layer),
      Layer.provide(ServerEnvironment.layerIdentity),
      Layer.provide(layerConfig),
    ),
  ),
  Layer.provide(layerConfig),
  Layer.provideMerge(
    HttpPlatform.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      Layer.provideMerge(Etag.layerWeak),
    ),
  ),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const postJson = (path: string, body: unknown, cookie?: string) =>
  new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: encodeJson(body),
  });
const sessionCookie = (response: Response, prefix: string) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(prefix))
    ?.split(";", 1)[0] ?? "";

it.effect("needs orchestration:read for a read and orchestration:operate for a write", () =>
  Effect.gen(function* () {
    const random = yield* SecureRandom.SecureRandom;
    const requestContext = Context.make(SecureRandom.SecureRandom, random).pipe(
      Context.add(
        ServerSecretStore.ServerSecretStore,
        ServerSecretStore.ServerSecretStore.of({
          get: () => Effect.succeedNone,
          set: () => Effect.void,
          create: () => Effect.void,
          getOrCreateRandom: () => Effect.die("Not used by these routes."),
          remove: () => Effect.void,
        }),
      ),
    );
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => HttpRouter.toWebHandler(layerRoutes, { disableLogger: true })),
      (environment) =>
        Effect.promise(async () => {
          const call = (method: string, cookie?: string) =>
            environment.handler(
              postJson("/api/extensions/call", { id: "summarized-update-badge", method }, cookie),
              requestContext,
            );

          expect((await call("look")).status).toBe(401);

          const full = sessionCookie(
            await environment.handler(
              postJson("/api/auth/browser-session", { credential: DEV_TOKEN }),
              requestContext,
            ),
            "t3_dev_session_",
          );
          expect(await (await call("change", full)).json()).toEqual({
            ok: true,
            value: "changed",
          });

          const pairing = (await (
            await environment.handler(
              postJson("/api/auth/pairing-token", { scopes: ["orchestration:read"] }, full),
              requestContext,
            )
          ).json()) as { credential: string };
          const readOnly = sessionCookie(
            await environment.handler(
              postJson("/api/auth/browser-session", { credential: pairing.credential }),
              requestContext,
            ),
            "t3_session_",
          );
          const look = await call("look", readOnly);
          expect(look.status).toBe(200);
          expect(await look.json()).toEqual({ ok: true, value: "looked" });
          const change = await call("change", readOnly);
          expect(change.status).toBe(403);
          expect(await change.json()).toMatchObject({
            requiredPermission: "orchestration:operate",
          });
        }),
      (environment) => Effect.promise(() => environment.dispose()),
    );
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);
