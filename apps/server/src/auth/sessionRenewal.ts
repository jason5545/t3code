import { AuthSessionId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import * as AuthSessions from "../persistence/AuthSessions.ts";
import { isMcpClientSubject } from "./mcpClientSubject.ts";

/**
 * Fork patch 6: a sign-in renews while its device keeps connecting from that device,
 * like a Tailscale node key, so a copied token still dies at its deadline. The stored
 * expiry moves instead of re-minting tokens, so verification trusts it over `exp`.
 */
const RENEWED_SESSION_LIFETIME = Duration.days(30);
// One write per session per day at most, and a connection made at least every
// 29 days always finds its session alive.
const RENEW_WITHIN_REMAINING = Duration.days(29);

/**
 * The subject a connection may renew a session under: its own when the connection
 * comes from the device it belongs to, the device's when it adopts a session that
 * was paired with a code, or none. Only asked once a renewal is due.
 */
export type RenewalCheck = (
  session: AuthSessions.AuthSessionRecord,
) => Effect.Effect<Option.Option<string>>;

const neverRenew: RenewalCheck = () => Effect.succeedNone;

const ExtendSessionExpiryInput = Schema.Struct({
  sessionId: AuthSessionId,
  subject: Schema.String,
  previousSubject: Schema.String,
  expiresAt: Schema.DateTimeUtcFromString,
  now: Schema.DateTimeUtcFromString,
});

const remainingMillis = (session: AuthSessions.AuthSessionRecord, now: DateTime.DateTime) =>
  session.expiresAt.epochMilliseconds - now.epochMilliseconds;

const isUsable = (session: AuthSessions.AuthSessionRecord, now: DateTime.DateTime) =>
  session.revokedAt === null && remainingMillis(session, now) > 0;

const isRenewable = (session: AuthSessions.AuthSessionRecord): boolean =>
  session.revokedAt === null &&
  // MCP sign-ins last what the user chose with `t3 auth pairing create --session-ttl`.
  !isMcpClientSubject(session.subject) &&
  // T3 Connect re-mints its own short-lived access tokens.
  session.method !== "dpop-access-token" &&
  // A session issued shorter than the default keeps the lifetime it was given.
  session.expiresAt.epochMilliseconds - session.issuedAt.epochMilliseconds >=
    Duration.toMillis(RENEWED_SESSION_LIFETIME);

const isRenewalDue = (session: AuthSessions.AuthSessionRecord, now: DateTime.DateTime): boolean => {
  const remaining = remainingMillis(session, now);
  return (
    isRenewable(session) && remaining > 0 && remaining <= Duration.toMillis(RENEW_WITHIN_REMAINING)
  );
};

/** How long an open connection can wait before its session needs another look. */
const nextCheckIn = (session: AuthSessions.AuthSessionRecord, now: DateTime.DateTime) => {
  const remaining = Math.max(0, remainingMillis(session, now));
  const untilDue = remaining - Duration.toMillis(RENEW_WITHIN_REMAINING);
  return Duration.millis(isRenewable(session) && untilDue > 0 ? untilDue : remaining);
};

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const authSessions = yield* AuthSessions.AuthSessionRepository;

  // The guards repeat the revocation and expiry checks so one that lands
  // between the read and the write is never undone, and the subject guard
  // keeps two connections from adopting one session for different devices.
  const extendSessionExpiry = SqlSchema.findAll({
    Request: ExtendSessionExpiryInput,
    Result: Schema.Struct({ sessionId: AuthSessionId }),
    execute: ({ sessionId, subject, previousSubject, expiresAt, now }) =>
      sql`
        UPDATE auth_sessions
        SET expires_at = ${expiresAt}, subject = ${subject}
        WHERE session_id = ${sessionId}
          AND subject = ${previousSubject}
          AND revoked_at IS NULL
          AND expires_at > ${now}
        RETURNING session_id AS "sessionId"
      `,
  });

  /** The session's expiry after renewing it when due and allowed; none once it can no longer be used. */
  const renewSession = Effect.fn("SessionRenewal.renewSession")(function* (
    session: AuthSessions.AuthSessionRecord,
    check: RenewalCheck,
  ) {
    const now = yield* DateTime.now;
    if (!isUsable(session, now)) return Option.none<DateTime.Utc>();
    if (!isRenewalDue(session, now)) return Option.some(session.expiresAt);
    // A connection that cannot show it comes from the session's device leaves
    // the deadline alone; the session still works until then.
    const subject = yield* check(session);
    if (Option.isNone(subject)) return Option.some(session.expiresAt);
    const expiresAt = DateTime.add(now, {
      milliseconds: Duration.toMillis(RENEWED_SESSION_LIFETIME),
    });
    const extended = yield* extendSessionExpiry({
      sessionId: session.sessionId,
      subject: subject.value,
      previousSubject: session.subject,
      expiresAt,
      now,
    });
    if (extended.length > 0) {
      if (subject.value !== session.subject) {
        yield* Effect.logInfo("Bound a code-paired session to its tailnet device.").pipe(
          Effect.annotateLogs({ sessionId: session.sessionId, subject: subject.value }),
        );
      }
      return Option.some(expiresAt);
    }
    // A revocation, or another connection's renewal, landed in between.
    const latest = yield* authSessions.getById({ sessionId: session.sessionId });
    return Option.isSome(latest) && isUsable(latest.value, now)
      ? Option.some(latest.value.expiresAt)
      : Option.none<DateTime.Utc>();
  });

  /** The session's expiry after renewing it when due; none once it is unusable or renewal failed. */
  const renewIfDue = (
    sessionId: AuthSessionId,
    check: RenewalCheck = neverRenew,
  ): Effect.Effect<Option.Option<DateTime.Utc>> =>
    authSessions.getById({ sessionId }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeedNone,
          onSome: (session) => renewSession(session, check),
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Failed to renew session.").pipe(
          Effect.annotateLogs({ sessionId, cause }),
          Effect.as(Option.none()),
        ),
      ),
      Effect.withSpan("SessionStore.renewIfDue"),
    );

  /**
   * Resolves when the session's stored expiry passes while a connection stays
   * open. The connection itself counts as the device checking in, so a
   * renewable session is renewed once it falls due, and a deadline moved by
   * another connection is honoured instead of closing this one early.
   */
  // Untraced: it waits for as long as the connection stays open, so a span would stay open for days.
  const awaitExpiry = Effect.fnUntraced(function* (
    initial: AuthSessions.AuthSessionRecord,
    onRenewed: Effect.Effect<void>,
    check: RenewalCheck = neverRenew,
  ) {
    let session = initial;
    for (;;) {
      yield* Effect.sleep(nextCheckIn(session, yield* DateTime.now));
      const latest = yield* authSessions
        .getById({ sessionId: session.sessionId })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to re-read a connected session.").pipe(
              Effect.annotateLogs({ sessionId: session.sessionId, cause }),
              Effect.as(Option.some(session)),
            ),
          ),
        );
      if (Option.isNone(latest)) return;
      const expiresAt = yield* renewSession(latest.value, check).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to renew a connected session.").pipe(
            Effect.annotateLogs({ sessionId: session.sessionId, cause }),
            // Only the write can fail, and only for a usable session.
            Effect.as(Option.some(latest.value.expiresAt)),
          ),
        ),
      );
      if (Option.isNone(expiresAt)) return;
      if (expiresAt.value.epochMilliseconds !== latest.value.expiresAt.epochMilliseconds) {
        yield* onRenewed;
      }
      session = { ...latest.value, expiresAt: expiresAt.value };
    }
  });

  return { renewIfDue, awaitExpiry };
});
