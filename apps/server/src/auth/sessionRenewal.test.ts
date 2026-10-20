import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthSessionId, EnvironmentHttpApi, EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as SessionStore from "./SessionStore.ts";
import * as AuthHttp from "./http.ts";

const DAY = Duration.toMillis(Duration.days(1));

const layerServerConfig = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-auth-session-renewal-test-",
});

const layerSessionStore = SessionStore.layer.pipe(
  Layer.provide(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("test-environment")),
    }),
  ),
  Layer.provide(layerServerConfig),
);

const layerTest = Layer.mergeAll(
  layerSessionStore,
  SqlitePersistence.layerMemory,
  TestClock.layer(),
);

const storedExpiry = (sessionId: AuthSessionId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly expiresAt: string }>`
      SELECT expires_at AS "expiresAt" FROM auth_sessions WHERE session_id = ${sessionId}
    `;
    return Date.parse(rows[0]!.expiresAt);
  });

const reconnect = (sessions: SessionStore.SessionStore["Service"], sessionId: AuthSessionId) =>
  sessions.markConnected(sessionId).pipe(Effect.andThen(sessions.markDisconnected(sessionId)));

it.layer(NodeServices.layer)("session renewal", (it) => {
  it.effect.each(["bearer-access-token", "browser-session-cookie"] as const)(
    "extends a %s device session to 30 days when it connects, past its token's own deadline",
    (method) =>
      Effect.gen(function* () {
        const sessions = yield* SessionStore.SessionStore;
        const device = yield* sessions.issue({ subject: "one-time-token", method });

        yield* TestClock.adjust(Duration.days(20));
        yield* reconnect(sessions, device.sessionId);
        const renewedAt = (yield* DateTime.now).epochMilliseconds;
        expect(yield* storedExpiry(device.sessionId)).toBe(renewedAt + 30 * DAY);

        yield* TestClock.adjust(Duration.days(25));
        const verified = yield* sessions.verify(device.token);
        expect(verified.sessionId).toBe(device.sessionId);
        expect(verified.expiresAt?.epochMilliseconds).toBe(renewedAt + 30 * DAY);

        yield* TestClock.adjust(Duration.days(6));
        expect((yield* Effect.flip(sessions.verify(device.token)))._tag).toBe(
          "SessionTokenExpiredError",
        );
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("writes nothing while more than 29 days are left", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const device = yield* sessions.issue({ subject: "one-time-token" });

      yield* TestClock.adjust(Duration.hours(23));
      yield* reconnect(sessions, device.sessionId);
      expect(yield* storedExpiry(device.sessionId)).toBe(device.expiresAt.epochMilliseconds);

      yield* TestClock.adjust(Duration.hours(2));
      yield* reconnect(sessions, device.sessionId);
      const renewedAt = (yield* DateTime.now).epochMilliseconds;
      expect(yield* storedExpiry(device.sessionId)).toBe(renewedAt + 30 * DAY);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("never revives a revoked or expired session", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const revoked = yield* sessions.issue({ subject: "one-time-token" });
      const expired = yield* sessions.issue({ subject: "one-time-token" });

      yield* TestClock.adjust(Duration.days(20));
      yield* sessions.revoke(revoked.sessionId);
      yield* reconnect(sessions, revoked.sessionId);
      expect(yield* sessions.renewIfDue(revoked.sessionId)).toEqual(Option.none());
      expect(yield* storedExpiry(revoked.sessionId)).toBe(revoked.expiresAt.epochMilliseconds);
      expect((yield* Effect.flip(sessions.verify(revoked.token)))._tag).toBe(
        "SessionTokenRevokedError",
      );

      yield* TestClock.adjust(Duration.days(11));
      yield* reconnect(sessions, expired.sessionId);
      expect(yield* sessions.renewIfDue(expired.sessionId)).toEqual(Option.none());
      expect(yield* storedExpiry(expired.sessionId)).toBe(expired.expiresAt.epochMilliseconds);
      expect((yield* Effect.flip(sessions.verify(expired.token)))._tag).toBe(
        "SessionTokenExpiredError",
      );
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps the lifetime of MCP sign-ins and of sessions issued shorter", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const mcp = yield* sessions.issue({ subject: "mcp-client", method: "bearer-access-token" });
      const shortLived = yield* sessions.issue({
        subject: "cli-issued-session",
        method: "bearer-access-token",
        ttl: Duration.days(7),
      });

      yield* TestClock.adjust(Duration.days(5));
      yield* reconnect(sessions, shortLived.sessionId);
      expect(yield* storedExpiry(shortLived.sessionId)).toBe(
        shortLived.expiresAt.epochMilliseconds,
      );

      yield* TestClock.adjust(Duration.days(20));
      yield* reconnect(sessions, mcp.sessionId);
      expect(yield* sessions.renewIfDue(mcp.sessionId)).toEqual(Option.some(mcp.expiresAt));
      expect(yield* storedExpiry(mcp.sessionId)).toBe(mcp.expiresAt.epochMilliseconds);

      yield* TestClock.adjust(Duration.days(6));
      expect((yield* Effect.flip(sessions.verify(mcp.token)))._tag).toBe(
        "SessionTokenExpiredError",
      );
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps renewing a session whose connection stays open past the original deadline", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const device = yield* sessions.issue({
        subject: "one-time-token",
        method: "bearer-access-token",
      });
      yield* sessions.markConnected(device.sessionId);
      const invalidated = yield* Deferred.make<void>();
      const watcher = yield* sessions
        .awaitInvalidation(device.sessionId)
        .pipe(
          Effect.andThen(Deferred.succeed(invalidated, undefined)),
          Effect.forkScoped({ startImmediately: true }),
        );

      for (let day = 0; day < 45; day += 1) {
        yield* TestClock.adjust(Duration.days(1));
      }

      expect(yield* Deferred.isDone(invalidated)).toBe(false);
      const now = (yield* DateTime.now).epochMilliseconds;
      const verified = yield* sessions.verify(device.token);
      expect(verified.expiresAt!.epochMilliseconds - now).toBeGreaterThanOrEqual(29 * DAY);

      yield* sessions.revoke(device.sessionId);
      yield* Fiber.join(watcher);
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );
});

const DEV_TOKEN = "reusable-dev-auth-token-that-is-long-enough";
class AuthTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.auth) {}

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const post = (path: string, headers: Readonly<Record<string, string>>, body?: unknown) =>
  new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: encodeJson(body) }),
  });
const sessionCookie = (response: Response) =>
  response.headers.getSetCookie().find((cookie) => cookie.startsWith("t3_session_"));
const cookieExpiry = (cookie: string | undefined) =>
  Date.parse(/Expires=([^;]+)/.exec(cookie ?? "")?.[1] ?? "");

it.effect("resets the browser cookie's deadline when a socket ticket renews its session", () =>
  Effect.gen(function* () {
    const realClock = yield* Clock.Clock;
    let offsetMillis = 0;
    const nowMillis = () => realClock.currentTimeMillisUnsafe() + offsetMillis;
    const shiftedClock: Clock.Clock = {
      currentTimeMillisUnsafe: nowMillis,
      currentTimeMillis: Effect.sync(nowMillis),
      currentTimeNanosUnsafe: () => BigInt(nowMillis()) * 1_000_000n,
      currentTimeNanos: Effect.sync(() => BigInt(nowMillis()) * 1_000_000n),
      monotonicTimeNanosUnsafe: () => BigInt(nowMillis()) * 1_000_000n,
      monotonicTimeNanos: Effect.sync(() => BigInt(nowMillis()) * 1_000_000n),
      sleep: (duration) => realClock.sleep(duration),
    };
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
    ).pipe(Layer.provide(layerServerConfig));
    const layerRoutes = HttpApiBuilder.layer(AuthTestApi).pipe(
      Layer.provide(AuthHttp.layer),
      Layer.provide(AuthHttp.layerAuthenticatedAuth),
      Layer.provideMerge(
        EnvironmentAuth.layer.pipe(
          Layer.provide(SqlitePersistence.layerMemory),
          Layer.provide(ServerSecretStore.layer),
          Layer.provide(ServerEnvironment.layerIdentity),
          Layer.provide(layerConfig),
        ),
      ),
      Layer.provide(layerConfig),
      Layer.provideMerge(
        HttpPlatform.layer.pipe(
          Layer.provideMerge(NodeServices.layer),
          Layer.provideMerge(Etag.layerWeak),
        ),
      ),
      Layer.provide(NodeServices.layer),
      Layer.provide(Layer.succeed(Clock.Clock, shiftedClock)),
    );
    const requestContext = Context.make(Crypto.Crypto, yield* Crypto.Crypto).pipe(
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
        Effect.tryPromise(async () => {
          const devCookie = (
            await environment.handler(
              post("/api/auth/browser-session", {}, { credential: DEV_TOKEN }),
              requestContext,
            )
          ).headers
            .getSetCookie()
            .find((cookie) => cookie.startsWith("t3_dev_session_"))
            ?.split(";", 1)[0];
          const pairing = (await (
            await environment.handler(
              post("/api/auth/pairing-token", { cookie: devCookie ?? "" }, {}),
              requestContext,
            )
          ).json()) as { credential: string };
          const paired = sessionCookie(
            await environment.handler(
              post("/api/auth/browser-session", {}, { credential: pairing.credential }),
              requestContext,
            ),
          );
          const pairedCookie = paired?.split(";", 1)[0] ?? "";
          expect(pairedCookie).toMatch(/^t3_session_[^=]+=.+/);

          offsetMillis = 20 * DAY;
          const ticket = await environment.handler(
            post("/api/auth/websocket-ticket", { cookie: pairedCookie }),
            requestContext,
          );
          expect(ticket.status).toBe(200);
          const renewed = sessionCookie(ticket);
          expect(renewed?.split(";", 1)[0]).toBe(pairedCookie);
          expect(cookieExpiry(renewed) - cookieExpiry(paired)).toBeGreaterThan(19 * DAY);
          expect(cookieExpiry(renewed) - nowMillis()).toBeGreaterThan(29 * DAY);
        }),
      (environment) => Effect.promise(() => environment.dispose()),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
