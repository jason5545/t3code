import {
  AuthOrchestrationReadScope,
  EnvironmentOperationForbiddenError,
  type AuthSessionId,
  type EnvironmentInternalError,
  type ServerAuthSessionMethod,
} from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpServerRequest } from "effect/http";

import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import type * as AuthHttp from "./http.ts";
import type * as SessionStore from "./SessionStore.ts";
import * as TailscalePairing from "./TailscalePairing.ts";

/**
 * Fork patches 6 and 7 in the `auth` HTTP group: Tailscale pairing, tailnet server
 * discovery, and renewing a browser's session cookie. `http.ts` hands over the
 * helpers these need, so this module never imports it at runtime.
 */
export const make = Effect.fn("AuthHttpFork.make")(function* (helpers: {
  readonly sessions: SessionStore.SessionStore["Service"];
  readonly annotateEnvironmentRequest: typeof AuthHttp.annotateEnvironmentRequest;
  readonly requireEnvironmentScope: typeof AuthHttp.requireEnvironmentScope;
  readonly failEnvironmentInternal: typeof AuthHttp.failEnvironmentInternal;
  readonly appendCredentialResponseHeaders: Effect.Effect<
    void,
    never,
    HttpServerRequest.HttpServerRequest
  >;
  readonly appendSessionCookie: (
    cookieName: string,
    token: string,
    expiresAt: DateTime.DateTime,
  ) => Effect.Effect<void, EnvironmentInternalError, HttpServerRequest.HttpServerRequest>;
}) {
  // Optional so routes built without it (tests) refuse instead of requiring it.
  const tailscalePairing = yield* Effect.serviceOption(TailscalePairing.TailscalePairing);

  const failPairingRefused = (refusal: TailscalePairing.TailscalePairingRefusal) =>
    Effect.currentParentSpan.pipe(
      Effect.map((span) => span.traceId),
      Effect.orElseSucceed(() => "unavailable"),
      Effect.flatMap((traceId) =>
        Effect.fail(
          new EnvironmentOperationForbiddenError({
            code: "operation_forbidden",
            // Only a blocked node learns why; the requester is that node itself.
            reason:
              refusal === "revoked" ? "tailscale_pairing_revoked" : "tailscale_pairing_refused",
            traceId,
          }),
        ),
      ),
    );

  const tailscalePairingHandler = Effect.fn("environment.auth.tailscalePairing")(
    function* () {
      yield* helpers.annotateEnvironmentRequest("tailscalePairing");
      const request = yield* HttpServerRequest.HttpServerRequest;
      yield* helpers.appendCredentialResponseHeaders;
      return yield* Option.match(tailscalePairing, {
        onNone: () =>
          Effect.fail(new TailscalePairing.TailscalePairingRefusedError({ reason: "disabled" })),
        onSome: (service) => service.issueCredential(TailscalePairing.pairingRequestOf(request)),
      });
    },
    Effect.catchTags({
      TailscalePairingRefusedError: (error) => failPairingRefused(error.reason),
      TailscalePairingStoreError: (error) =>
        helpers.failEnvironmentInternal("pairing_credential_issuance_failed", error),
    }),
    Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
      helpers.failEnvironmentInternal("pairing_credential_issuance_failed", error),
    ),
  );

  const tailnetServers = Effect.fn("environment.auth.tailnetServers")(function* () {
    yield* helpers.annotateEnvironmentRequest("tailnetServers");
    yield* helpers.requireEnvironmentScope(AuthOrchestrationReadScope);
    return yield* Option.match(tailscalePairing, {
      onNone: () => Effect.succeed([]),
      onSome: (service) => service.discoverServers(),
    });
  });

  /**
   * A browser drops its cookie at the deadline the cookie was set with, whatever the
   * server renews. Renewing just before the socket opens lets the same response carry
   * the new deadline.
   */
  const renewBrowserSessionCookie = Effect.fn("environment.auth.renewBrowserSessionCookie")(
    function* (session: {
      readonly sessionId: AuthSessionId;
      readonly method: ServerAuthSessionMethod;
    }) {
      if (session.method !== "browser-session-cookie") return;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const credential = EnvironmentAuth.selectRequestCredential(
        request,
        helpers.sessions.cookieName,
        helpers.sessions.legacyCookieName,
      );
      if (credential?.source !== "cookie") return;
      const expiresAt = yield* helpers.sessions.renewIfDue(
        session.sessionId,
        TailscalePairing.renewalCheckOf(tailscalePairing, request),
      );
      if (Option.isSome(expiresAt)) {
        yield* helpers.appendSessionCookie(
          helpers.sessions.cookieName,
          credential.token,
          expiresAt.value,
        );
      }
    },
  );

  return { tailscalePairing: tailscalePairingHandler, tailnetServers, renewBrowserSessionCookie };
});
