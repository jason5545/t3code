import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HttpClient from "effect/http/HttpClient";
import * as TestClock from "effect/testing/TestClock";

import * as EnvironmentRegistry from "./registry.ts";
import {
  dueTailnetDiscoveryEnvironments,
  mergeDiscoveredServers,
  nextTailnetDiscoveryWakeAt,
  presentTailnetDiscovery,
  recordTailnetDiscoveryFailure,
  recordTailnetDiscoverySuccess,
  watchTailnetDiscovery,
  type TailnetDiscoveryRecord,
  type TailnetDiscoveryState,
  type TailnetDiscoveryView,
} from "./tailnetDiscovery.ts";

const MINUTE = 60_000;
const HUB = EnvironmentId.make("hub");
const FR = EnvironmentId.make("fr");
const MAC = {
  environmentId: EnvironmentId.make("mac"),
  label: "Mac",
  httpBaseUrl: "http://100.89.162.36:3773/",
  nodeName: "macbook-pro",
};

const discoveryState = (
  records: ReadonlyArray<readonly [EnvironmentId, TailnetDiscoveryRecord]>,
  connected: ReadonlyArray<EnvironmentId> = records.map(([environmentId]) => environmentId),
  inFlight: ReadonlyArray<EnvironmentId> = [],
): TailnetDiscoveryState => ({
  records: new Map(records),
  connected: new Set(connected),
  inFlight: new Set(inFlight),
  registered: new Set([HUB, FR]),
});

/** Runs the schedule for one environment, answering each ask from `outcomes` in order. */
const replay = (outcomes: ReadonlyArray<"ok" | "fail">, untilMs: number) => {
  let record: TailnetDiscoveryRecord | undefined;
  const asks: Array<number> = [];
  const views: Array<readonly [number, string]> = [];
  let now = 0;
  while (now <= untilMs) {
    const current = discoveryState(record === undefined ? [] : [[HUB, record]], [HUB]);
    if (dueTailnetDiscoveryEnvironments(current, now).includes(HUB)) {
      asks.push(now / MINUTE);
      record =
        outcomes[asks.length - 1] === "ok"
          ? recordTailnetDiscoverySuccess(now, [MAC])
          : recordTailnetDiscoveryFailure(record, now);
    }
    const settled = discoveryState(record === undefined ? [] : [[HUB, record]], [HUB]);
    views.push([now / MINUTE, presentTailnetDiscovery(settled, now).kind]);
    now = nextTailnetDiscoveryWakeAt(settled, now)!;
  }
  return { asks, views };
};

describe("tailnet server discovery", () => {
  it("offers each environment once and leaves out the ones already added", () => {
    const server = (environmentId: string, httpBaseUrl: string) => ({
      environmentId: EnvironmentId.make(environmentId),
      label: environmentId,
      httpBaseUrl,
      nodeName: environmentId,
    });
    expect(
      mergeDiscoveredServers(
        [
          [server("mac", "http://100.89.162.36:3773/"), server("added", "http://100.64.0.2:3773/")],
          [server("mac", "https://mac.tail.ts.net/"), server("nas", "https://nas.tail.ts.net/")],
        ],
        new Set([EnvironmentId.make("added")]),
      ).map((entry) => [entry.environmentId, entry.httpBaseUrl]),
    ).toEqual([
      ["mac", "http://100.89.162.36:3773/"],
      ["nas", "https://nas.tail.ts.net/"],
    ]);
  });
});

describe("background tailnet discovery schedule", () => {
  it("asks again ten minutes after a success and backs off 1, 2, 4… minutes after failures", () => {
    expect(replay(["ok", "ok"], 20 * MINUTE).asks).toEqual([0, 10, 20]);
    expect(replay(["fail", "ok", "ok"], 11 * MINUTE).asks).toEqual([0, 1, 11]);
    expect(replay(["fail", "fail", "fail", "fail", "fail", "fail"], 40 * MINUTE).asks).toEqual([
      0, 1, 3, 7, 15, 25, 35,
    ]);
  });

  it("withdraws a list at 20 minutes without asking, then asks on the backed-off schedule", () => {
    const { asks, views } = replay(["ok", "fail", "fail", "fail", "fail", "ok"], 25 * MINUTE);
    expect(asks).toEqual([0, 10, 11, 13, 17, 25]);
    expect(views).toContainEqual([20, "unavailable"]);
    expect(views.filter(([minute]) => minute < 20).every(([, kind]) => kind === "found")).toBe(
      true,
    );
  });

  it("asks only environments that are connected, due and not already being asked", () => {
    const waiting = recordTailnetDiscoveryFailure(undefined, 0);
    expect(dueTailnetDiscoveryEnvironments(discoveryState([[HUB, waiting]]), 30_000)).toEqual([]);
    // A newly connected environment has no record yet, so it is asked at once.
    expect(
      dueTailnetDiscoveryEnvironments(discoveryState([[HUB, waiting]], [HUB, FR]), 30_000),
    ).toEqual([FR]);
    expect(dueTailnetDiscoveryEnvironments(discoveryState([], [HUB], [HUB]), 0)).toEqual([]);
    expect(dueTailnetDiscoveryEnvironments(discoveryState([[HUB, waiting]], []), MINUTE)).toEqual(
      [],
    );
  });

  it("replaces a list on an empty answer and keeps it through failures until it is stale", () => {
    const found = recordTailnetDiscoverySuccess(0, [MAC]);
    expect(presentTailnetDiscovery(discoveryState([[HUB, found]]), MINUTE).kind).toBe("found");
    expect(
      presentTailnetDiscovery(
        discoveryState([[HUB, recordTailnetDiscoverySuccess(MINUTE, [])]]),
        MINUTE,
      ),
    ).toEqual({ kind: "none-found" });
    const failed = recordTailnetDiscoveryFailure(found, 10 * MINUTE);
    expect(presentTailnetDiscovery(discoveryState([[HUB, failed]]), 19 * MINUTE).kind).toBe(
      "found",
    );
  });

  it.effect(
    "waits for the foreground instead of spinning when an ask falls due in the background",
    () =>
      Effect.gen(function* () {
        const testClock = yield* TestClock.testClockWith(Effect.succeed);
        // A timer that is already due returns at once, which is how the loop used to spin.
        let dueTimers = 0;
        const clock: Clock.Clock = {
          ...testClock,
          sleep: (duration) => {
            if (Duration.toMillis(duration) <= 0) dueTimers += 1;
            return testClock.sleep(duration);
          },
        };
        const foreground = yield* Queue.unbounded<boolean>();
        const asks = yield* Queue.unbounded<number>();
        const views = yield* Queue.unbounded<TailnetDiscoveryView["kind"]>();
        const registry = EnvironmentRegistry.EnvironmentRegistry.of({
          entries: yield* SubscriptionRef.make(new Map([[HUB, undefined]])),
          followStream: () => Stream.make({ phase: "connected" }),
          run: () =>
            Clock.currentTimeMillis.pipe(
              Effect.flatMap((now) => Queue.offer(asks, now / MINUTE)),
              Effect.as(Option.some([MAC])),
            ),
        } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);

        yield* watchTailnetDiscovery(Stream.fromQueue(foreground)).pipe(
          Stream.runForEach((view) => Queue.offer(views, view.kind)),
          Effect.provideService(EnvironmentRegistry.EnvironmentRegistry, registry),
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die(new Error("unused"))),
          ),
          Effect.provideService(Clock.Clock, clock),
          Effect.forkScoped,
        );
        yield* Queue.offer(foreground, true);
        expect(yield* Queue.take(asks)).toBe(0);
        expect([yield* Queue.take(views), yield* Queue.take(views)]).toEqual([
          "unavailable",
          "found",
        ]);

        yield* Queue.offer(foreground, false);
        yield* TestClock.adjust(11 * MINUTE);
        yield* Queue.offer(foreground, true);
        expect(yield* Queue.take(asks)).toBe(11);
        expect(dueTimers).toBe(0);
      }).pipe(Effect.scoped),
  );

  it("shows only connected environments' fresh lists, and says when none has answered", () => {
    const found = recordTailnetDiscoverySuccess(0, [MAC]);
    const failed = recordTailnetDiscoveryFailure(undefined, 0);
    expect(presentTailnetDiscovery(discoveryState([]), 0)).toEqual({ kind: "unavailable" });
    // Disconnected: hidden until it reconnects, then back while still fresh.
    expect(presentTailnetDiscovery(discoveryState([[HUB, found]], []), MINUTE)).toEqual({
      kind: "unavailable",
    });
    expect(presentTailnetDiscovery(discoveryState([[HUB, found]], [HUB]), MINUTE).kind).toBe(
      "found",
    );
    // A disconnected fresh list and a connected failing one: still nothing to go on.
    expect(
      presentTailnetDiscovery(
        discoveryState(
          [
            [HUB, found],
            [FR, failed],
          ],
          [FR],
        ),
        MINUTE,
      ),
    ).toEqual({ kind: "unavailable" });
  });
});
