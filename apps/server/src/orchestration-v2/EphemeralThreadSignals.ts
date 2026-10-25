import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";

/**
 * Fork patch 11: an ephemeral thread's conversation exists only in its provider
 * process, so a released session ends the thread. The session manager reports
 * here instead of calling the purge itself, which would make it depend on the
 * orchestrator that already depends on it.
 */
export class EphemeralThreadSignals extends Context.Service<
  EphemeralThreadSignals,
  {
    readonly sessionEnded: (threadIds: Iterable<ThreadId>) => Effect.Effect<void>;
    readonly endedThreads: Queue.Dequeue<ThreadId>;
  }
>()("t3/orchestration-v2/EphemeralThreadSignals") {}

export const layer = Layer.effect(
  EphemeralThreadSignals,
  Effect.gen(function* () {
    const ended = yield* Queue.unbounded<ThreadId>();
    return EphemeralThreadSignals.of({
      sessionEnded: (threadIds) => Queue.offerAll(ended, Array.from(threadIds)).pipe(Effect.asVoid),
      endedThreads: ended,
    });
  }),
);
