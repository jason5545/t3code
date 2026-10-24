import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import type * as EffectAcpSchema from "effect-acp/compat";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import { describe, expect } from "vite-plus/test";

import { makeBackgroundCompactionRuntime } from "./backgroundCompaction.ts";

const chunk = (text: string) =>
  ({
    sessionId: "session-1",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
  }) as EffectAcpSchema.SessionNotification;

const compactPrompt = { prompt: [{ type: "text" as const, text: "/compact" }] };

// Mirrors kimi-code 2.3.1: `/compact` reports a background start and answers at once.
const makeAgent = (options: { readonly backgroundNotice: boolean }) =>
  Effect.gen(function* () {
    let deliver:
      | ((notification: EffectAcpSchema.SessionNotification) => Effect.Effect<void>)
      | undefined;
    const projected: Array<string> = [];
    const cancelled = yield* Deferred.make<void>();
    const base = {
      handleSessionUpdate: (
        handler: (notification: EffectAcpSchema.SessionNotification) => Effect.Effect<void>,
      ) =>
        Effect.sync(() => {
          deliver = handler;
        }),
      prompt: () =>
        Effect.gen(function* () {
          if (options.backgroundNotice) {
            yield* deliver!(
              chunk(
                "Context compaction started — it runs in the background and the compacted context applies once it finishes.",
              ),
            );
          }
          return { stopReason: "end_turn" as const };
        }),
      cancel: Deferred.succeed(cancelled, undefined).pipe(Effect.asVoid),
    } as unknown as AcpSessionRuntime.AcpSessionRuntime["Service"];
    const runtime = makeBackgroundCompactionRuntime(base);
    yield* runtime.handleSessionUpdate((notification) =>
      Effect.sync(() => {
        if (
          notification.update.sessionUpdate === "agent_message_chunk" &&
          notification.update.content.type === "text"
        ) {
          projected.push(notification.update.content.text);
        }
      }),
    );
    return {
      runtime,
      projected,
      cancelled,
      send: (text: string) => deliver!(chunk(text)),
    };
  });

describe("makeBackgroundCompactionRuntime", () => {
  it.effect("holds /compact until the agent reports the background compaction ended", () =>
    Effect.gen(function* () {
      const agent = yield* makeAgent({ backgroundNotice: true });
      const prompt = yield* agent.runtime.prompt(compactPrompt).pipe(Effect.forkChild);
      yield* TestClock.adjust("14 minutes");
      expect(prompt.pollUnsafe()).toBeUndefined();

      yield* agent.send("Compaction completed.\n- Messages compacted: 42");
      const response = yield* Fiber.join(prompt);
      expect(response.stopReason).toBe("end_turn");
      expect(agent.projected.at(-1)).toBe("Compaction completed.\n- Messages compacted: 42");
    }),
  );

  it.effect("returns at once when the agent compacts before answering", () =>
    Effect.gen(function* () {
      const agent = yield* makeAgent({ backgroundNotice: false });
      const response = yield* agent.runtime.prompt(compactPrompt);
      expect(response.stopReason).toBe("end_turn");
    }),
  );

  it.effect("lets Stop end the wait and still cancels the agent", () =>
    Effect.gen(function* () {
      const agent = yield* makeAgent({ backgroundNotice: true });
      const prompt = yield* agent.runtime.prompt(compactPrompt).pipe(Effect.forkChild);
      yield* TestClock.adjust("1 minute");
      yield* agent.runtime.cancel;
      const response = yield* Fiber.join(prompt);
      expect(response.stopReason).toBe("cancelled");
      yield* Deferred.await(agent.cancelled);
    }),
  );

  it.effect("gives up after the fallback when the agent never reports the end", () =>
    Effect.gen(function* () {
      const agent = yield* makeAgent({ backgroundNotice: true });
      const prompt = yield* agent.runtime.prompt(compactPrompt).pipe(Effect.forkChild);
      yield* TestClock.adjust("15 minutes");
      const response = yield* Fiber.join(prompt);
      expect(response.stopReason).toBe("end_turn");
    }),
  );
});
