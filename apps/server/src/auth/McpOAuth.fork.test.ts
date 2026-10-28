import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentHttpApi } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as McpOAuth from "./McpOAuth.ts";
import { encodeMcpApprovalSubject } from "./mcpApprovalCode.ts";
import * as McpOAuthHttp from "./mcpOAuthHttp.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AuthHttp from "./http.ts";

// The route harness mirrors McpOAuth.test.ts so fork cases stay out of the upstream file.
class AuthTestApi extends HttpApi.make("environment")
  .add(EnvironmentHttpApi.groups.auth)
  .add(EnvironmentHttpApi.groups.mcpOAuth) {}

const layerConfig = ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-oauth-fork-test-" });
const layerEnvironmentAuth = EnvironmentAuth.layer.pipe(
  Layer.provide(Sqlite.layerMemory),
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provideMerge(ServerEnvironment.layerIdentity),
  Layer.provide(layerConfig),
);
const makeLayerRoutes = (capture: (auth: EnvironmentAuth.EnvironmentAuth["Service"]) => void) =>
  Layer.mergeAll(
    Layer.effectDiscard(
      EnvironmentAuth.EnvironmentAuth.pipe(Effect.tap((auth) => Effect.sync(() => capture(auth)))),
    ),
    HttpApiBuilder.layer(AuthTestApi).pipe(
      Layer.provide(AuthHttp.layer),
      Layer.provide(
        McpOAuthHttp.layer.pipe(
          Layer.provide(McpOAuth.layer.pipe(Layer.provide(ServerSettings.layerTest()))),
        ),
      ),
      Layer.provide(AuthHttp.layerAuthenticatedAuth),
    ),
  ).pipe(
    Layer.provideMerge(layerEnvironmentAuth),
    Layer.provide(layerConfig),
    Layer.provideMerge(
      HttpPlatform.layer.pipe(
        Layer.provideMerge(NodeServices.layer),
        Layer.provideMerge(Etag.layerWeak),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const ORIGIN = "https://box.example.ts.net";
const REDIRECT = "http://localhost/callback";
const verifier = "a".repeat(43) + "-verifier-for-tests";
const challenge = "DeB41nTVkPwpbbYecrnqtVq7VXLezustdHAK4SWt13c";

const at = (path: string, init?: RequestInit) =>
  new Request(`http://127.0.0.1${path}`, {
    ...init,
    headers: { host: "box.example.ts.net", "x-forwarded-proto": "https", ...init?.headers },
  });
const form = (body: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body).toString(),
});

type Handler = (request: Request) => Effect.Effect<Response>;

const withRoutes = <A, E>(
  use: (handler: Handler, auth: EnvironmentAuth.EnvironmentAuth["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const context = Context.make(Crypto.Crypto, crypto);
    let routerAuth: EnvironmentAuth.EnvironmentAuth["Service"] | undefined;
    const layerRoutes = makeLayerRoutes((auth) => {
      routerAuth = auth;
    });
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => HttpRouter.toWebHandler(layerRoutes, { disableLogger: true })),
      (web) =>
        Effect.gen(function* () {
          const handler: Handler = (request) => Effect.promise(() => web.handler(request, context));
          yield* handler(at("/.well-known/oauth-authorization-server"));
          return yield* use(handler, routerAuth!);
        }),
      (web) => Effect.promise(() => web.dispose()),
    );
  }).pipe(Effect.provide(NodeServices.layer));

const json = <A>(response: Response) => Effect.promise(() => response.json() as Promise<A>);

const decide = (
  handler: Handler,
  authorization: Record<string, string>,
  decision: Record<string, string>,
) =>
  handler(
    at("/oauth/mcp/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: encodeJson({ authorization, decision }),
    }),
  ).pipe(
    Effect.flatMap((response) =>
      json<{ redirectTo?: string; message?: string }>(response).pipe(
        Effect.map((payload) => ({ status: response.status, ...payload })),
      ),
    ),
  );

const registeredClientId = (handler: Handler) =>
  handler(
    at("/oauth/mcp/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: encodeJson({
        client_name: "Claude Code",
        redirect_uris: [REDIRECT],
        grant_types: ["authorization_code", "refresh_token"],
        token_endpoint_auth_method: "none",
      }),
    }),
  ).pipe(
    Effect.flatMap((response) => json<{ client_id: string }>(response)),
    Effect.map((body) => body.client_id),
  );

const authorizeParams = (clientId: string) => ({
  response_type: "code",
  client_id: clientId,
  redirect_uri: "http://localhost:51234/callback",
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "state-1",
  resource: `${ORIGIN}/mcp`,
});

it.live(
  "an MCP approval code sets the sign-in lifetime, may be reused, and never pairs a client",
  () =>
    withRoutes((handler, auth) =>
      Effect.gen(function* () {
        const clientId = yield* registeredClientId(handler);
        const approve = (code: string) =>
          decide(handler, authorizeParams(clientId), {
            _tag: "pairing-code",
            access: "auto-accept-edits",
            code,
          });
        const signInDays = (code: string) =>
          Effect.gen(function* () {
            const approved = yield* approve(code);
            expect(approved.status).toBe(200);
            const token = yield* handler(
              at(
                "/oauth/mcp/token",
                form({
                  grant_type: "authorization_code",
                  code: new URL(approved.redirectTo!).searchParams.get("code")!,
                  redirect_uri: authorizeParams(clientId).redirect_uri,
                  client_id: clientId,
                  code_verifier: verifier,
                  resource: `${ORIGIN}/mcp`,
                }),
              ),
            ).pipe(Effect.flatMap(json<{ expires_in: number }>));
            return Math.round(token.expires_in / 86_400);
          });
        const pairsClient = (code: string) =>
          auth
            .exchangeBootstrapCredentialForAccessToken(code, undefined, { deviceType: "desktop" })
            .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));

        const reusable = yield* auth.createPairingLink({
          ttl: Duration.days(7),
          subject: encodeMcpApprovalSubject({ sessionTtl: Duration.days(180), reusable: true }),
        });
        expect(yield* pairsClient(reusable.credential)).toBe(false);
        expect(yield* signInDays(reusable.credential)).toBe(180);
        expect(yield* signInDays(reusable.credential)).toBe(180);
        expect(yield* auth.revokePairingLink(reusable.id)).toBe(true);
        expect((yield* approve(reusable.credential)).status).toBe(400);

        const once = yield* auth.createPairingLink({
          subject: encodeMcpApprovalSubject({ sessionTtl: Duration.days(90), reusable: false }),
        });
        expect(yield* pairsClient(once.credential)).toBe(false);
        expect(yield* signInDays(once.credential)).toBe(90);
        expect((yield* approve(once.credential)).status).toBe(400);

        const plain = yield* auth.issuePairingCredential();
        expect(yield* signInDays(plain.credential)).toBe(30);
      }),
    ),
);
