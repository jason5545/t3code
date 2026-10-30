import type { EnvironmentId, TailnetServer } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "../state/environmentHttpAuth.ts";
import * as EnvironmentRegistry from "./registry.ts";
import * as EnvironmentSupervisor from "./supervisor.ts";

/**
 * Fork patch 7: T3 Code servers on the user's tailnet, found without typing
 * an address. Adding one pairs over Tailscale, so it needs no code either.
 */
export type DiscoveredTailnetServer = TailnetServer;

const DISCOVERY_TIMEOUT_MS = 15_000;

/** Keeps the first server per environment and drops the ones this client already has. */
export const mergeDiscoveredServers = (
  lists: ReadonlyArray<ReadonlyArray<DiscoveredTailnetServer>>,
  registered: ReadonlySet<EnvironmentId>,
): ReadonlyArray<DiscoveredTailnetServer> => {
  const byEnvironment = new Map<EnvironmentId, DiscoveredTailnetServer>();
  for (const server of lists.flat()) {
    if (!registered.has(server.environmentId) && !byEnvironment.has(server.environmentId)) {
      byEnvironment.set(server.environmentId, server);
    }
  }
  return [...byEnvironment.values()];
};

/** One environment's list; fails on a transport or HTTP error, so the caller can back off. */
const askEnvironment = Effect.fn("clientRuntime.connection.askEnvironmentForTailnetServers")(
  function* (environmentId: EnvironmentId) {
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
    );
    return yield* registry.run(
      environmentId,
      Effect.gen(function* () {
        const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
        const prepared = yield* SubscriptionRef.get(supervisor.prepared);
        if (Option.isNone(prepared)) return Option.none<ReadonlyArray<DiscoveredTailnetServer>>();
        const servers = yield* executeAuthenticatedEnvironmentHttpRequest({
          prepared: prepared.value,
          signer,
          remoteAuthorization,
          group: "auth",
          method: "GET",
          url: (urls) => urls.tailnetServers(),
          timeoutMs: DISCOVERY_TIMEOUT_MS,
          request: ({ client, headers }) => client.tailnetServers({ headers }),
        });
        return Option.some<ReadonlyArray<DiscoveredTailnetServer>>(servers);
      }),
    );
  },
);

/** Asks each connected environment which other servers its tailnet has. */
const discoverServersThroughEnvironments = Effect.fn(
  "clientRuntime.connection.discoverServersThroughEnvironments",
)(function* () {
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  const entries = yield* SubscriptionRef.get(registry.entries);
  return yield* Effect.forEach(
    [...entries.keys()],
    (environmentId) =>
      askEnvironment(environmentId).pipe(
        Effect.map(Option.getOrElse((): ReadonlyArray<DiscoveredTailnetServer> => [])),
        // Servers without the endpoint, or with discovery off, just add nothing.
        Effect.orElseSucceed((): ReadonlyArray<DiscoveredTailnetServer> => []),
      ),
    { concurrency: "unbounded" },
  );
});

/**
 * Servers to offer, from every connected environment. A client with none has
 * no one to ask; it adds its first server by address or tailnet machine name.
 */
export const discoverTailnetServers = Effect.fn("clientRuntime.connection.discoverTailnetServers")(
  function* () {
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const viaEnvironments = yield* discoverServersThroughEnvironments();
    const registered = new Set((yield* SubscriptionRef.get(registry.entries)).keys());
    return mergeDiscoveredServers(viaEnvironments, registered);
  },
);

const MINUTE_MS = 60_000;
/** A successful list is asked again after this long. */
const TAILNET_DISCOVERY_INTERVAL_MS = 10 * MINUTE_MS;
/** Two intervals, so one failed ask does not make a suggestion flicker away. */
const TAILNET_DISCOVERY_FRESH_MS = 2 * TAILNET_DISCOVERY_INTERVAL_MS;

/** What one environment last told this client about its tailnet. */
export interface TailnetDiscoveryRecord {
  readonly succeededAt: number | null;
  readonly servers: ReadonlyArray<DiscoveredTailnetServer>;
  /** Failed asks since the last success. */
  readonly failures: number;
  readonly nextAskAt: number;
}

export const recordTailnetDiscoverySuccess = (
  now: number,
  servers: ReadonlyArray<DiscoveredTailnetServer>,
): TailnetDiscoveryRecord => ({
  succeededAt: now,
  servers,
  failures: 0,
  nextAskAt: now + TAILNET_DISCOVERY_INTERVAL_MS,
});

/** Keeps the last list until it goes stale; retries after 1, 2, 4… minutes, at most 10. */
export const recordTailnetDiscoveryFailure = (
  record: TailnetDiscoveryRecord | undefined,
  now: number,
): TailnetDiscoveryRecord => {
  const failures = (record?.failures ?? 0) + 1;
  return {
    succeededAt: record?.succeededAt ?? null,
    servers: record?.servers ?? [],
    failures,
    nextAskAt: now + Math.min(MINUTE_MS * 2 ** (failures - 1), TAILNET_DISCOVERY_INTERVAL_MS),
  };
};

export interface TailnetDiscoveryState {
  readonly records: ReadonlyMap<EnvironmentId, TailnetDiscoveryRecord>;
  readonly connected: ReadonlySet<EnvironmentId>;
  readonly inFlight: ReadonlySet<EnvironmentId>;
  readonly registered: ReadonlySet<EnvironmentId>;
}

export type TailnetDiscoveryView =
  | { readonly kind: "found"; readonly servers: ReadonlyArray<DiscoveredTailnetServer> }
  /** A fresh answer came back and offers nothing new; a server with discovery off answers this too. */
  | { readonly kind: "none-found" }
  /** No connected environment has answered within the last 20 minutes. */
  | { readonly kind: "unavailable" };

const freshRecords = (state: TailnetDiscoveryState, now: number) =>
  [...state.records].flatMap(([environmentId, record]) =>
    state.connected.has(environmentId) &&
    record.succeededAt !== null &&
    now - record.succeededAt < TAILNET_DISCOVERY_FRESH_MS
      ? [record]
      : [],
  );

export const presentTailnetDiscovery = (
  state: TailnetDiscoveryState,
  now: number,
): TailnetDiscoveryView => {
  const fresh = freshRecords(state, now);
  if (fresh.length === 0) return { kind: "unavailable" };
  const servers = mergeDiscoveredServers(
    fresh.map((record) => record.servers),
    state.registered,
  );
  return servers.length === 0 ? { kind: "none-found" } : { kind: "found", servers };
};

export const dueTailnetDiscoveryEnvironments = (
  state: TailnetDiscoveryState,
  now: number,
): ReadonlyArray<EnvironmentId> =>
  [...state.connected].filter(
    (environmentId) =>
      !state.inFlight.has(environmentId) &&
      now >= (state.records.get(environmentId)?.nextAskAt ?? 0),
  );

/** The next ask, or the next fresh list going stale; null when nothing is pending. */
export const nextTailnetDiscoveryWakeAt = (
  state: TailnetDiscoveryState,
  now: number,
): number | null => {
  const times = [...state.connected].flatMap((environmentId) => {
    const record = state.records.get(environmentId);
    const staleAt =
      record?.succeededAt == null ? null : record.succeededAt + TAILNET_DISCOVERY_FRESH_MS;
    return [
      ...(state.inFlight.has(environmentId) ? [] : [record?.nextAskAt ?? 0]),
      ...(staleAt === null || staleAt <= now ? [] : [staleAt]),
    ];
  });
  return times.length === 0 ? null : Math.min(...times);
};

const sameView = (left: TailnetDiscoveryView, right: TailnetDiscoveryView) =>
  left.kind === right.kind &&
  (left.kind !== "found" ||
    (right.kind === "found" &&
      left.servers.length === right.servers.length &&
      left.servers.every(
        (server, index) =>
          server.environmentId === right.servers[index]!.environmentId &&
          server.httpBaseUrl === right.servers[index]!.httpBaseUrl &&
          server.label === right.servers[index]!.label,
      )));

/**
 * Keeps asking connected environments in the background while `foreground`
 * last said true: when one connects, when the app comes back, and on the
 * schedule above. Each environment backs off on its own, so none of these
 * triggers can turn a failing server into a tight loop.
 */
export const watchTailnetDiscovery = (foreground: Stream.Stream<boolean>) =>
  Stream.callback<
    TailnetDiscoveryView,
    never,
    EnvironmentRegistry.EnvironmentRegistry | HttpClient.HttpClient
  >((output) =>
    Effect.gen(function* () {
      const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
      const records = new Map<EnvironmentId, TailnetDiscoveryRecord>();
      const connected = new Set<EnvironmentId>();
      const inFlight = new Set<EnvironmentId>();
      const watchers = new Map<EnvironmentId, Fiber.Fiber<void>>();
      let registered: ReadonlySet<EnvironmentId> = new Set();
      let active = false;
      const signals = yield* Queue.sliding<void>(1);
      const signal = () => Queue.offerUnsafe(signals, undefined);
      const state = (): TailnetDiscoveryState => ({ records, connected, inFlight, registered });

      const watchConnection = (environmentId: EnvironmentId) =>
        registry
          .followStream(
            environmentId,
            Stream.unwrap(
              EnvironmentSupervisor.EnvironmentSupervisor.pipe(
                Effect.map((supervisor) => SubscriptionRef.changes(supervisor.state)),
              ),
            ),
          )
          .pipe(
            Stream.map((connection) => connection.phase === "connected"),
            Stream.changes,
            Stream.runForEach((isConnected) =>
              Effect.sync(() => {
                if (isConnected) connected.add(environmentId);
                else connected.delete(environmentId);
                signal();
              }),
            ),
          );

      yield* SubscriptionRef.changes(registry.entries).pipe(
        Stream.runForEach((entries) =>
          Effect.gen(function* () {
            registered = new Set(entries.keys());
            for (const environmentId of registered) {
              if (!watchers.has(environmentId)) {
                watchers.set(
                  environmentId,
                  yield* Effect.forkScoped(watchConnection(environmentId)),
                );
              }
            }
            for (const [environmentId, watcher] of watchers) {
              if (registered.has(environmentId)) continue;
              watchers.delete(environmentId);
              records.delete(environmentId);
              connected.delete(environmentId);
              yield* Fiber.interrupt(watcher);
            }
            signal();
          }),
        ),
        Effect.forkScoped,
      );
      yield* foreground.pipe(
        Stream.runForEach((isActive) =>
          Effect.sync(() => {
            active = isActive;
            signal();
          }),
        ),
        Effect.forkScoped,
      );

      const ask = (environmentId: EnvironmentId) =>
        askEnvironment(environmentId).pipe(
          Effect.exit,
          Effect.flatMap((exit) =>
            Clock.currentTimeMillis.pipe(
              Effect.map((now) => {
                inFlight.delete(environmentId);
                if (!registered.has(environmentId)) return;
                records.set(
                  environmentId,
                  Exit.isSuccess(exit) && Option.isSome(exit.value)
                    ? recordTailnetDiscoverySuccess(now, exit.value.value)
                    : recordTailnetDiscoveryFailure(records.get(environmentId), now),
                );
                signal();
              }),
            ),
          ),
        );

      let shown: TailnetDiscoveryView | undefined;
      return yield* Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (active) {
          for (const environmentId of dueTailnetDiscoveryEnvironments(state(), now)) {
            inFlight.add(environmentId);
            yield* Effect.forkScoped(ask(environmentId));
          }
        }
        const view = presentTailnetDiscovery(state(), now);
        if (shown === undefined || !sameView(shown, view)) {
          shown = view;
          Queue.offerUnsafe(output, view);
        }
        // In the background nothing is asked, so only a signal (such as coming back) can change anything.
        const wakeAt = active ? nextTailnetDiscoveryWakeAt(state(), now) : null;
        yield* wakeAt === null
          ? Queue.take(signals)
          : Queue.take(signals).pipe(
              Effect.timeoutOption(Duration.millis(Math.max(0, wakeAt - now))),
            );
      }).pipe(Effect.forever);
    }),
  );
