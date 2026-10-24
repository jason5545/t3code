import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as EffectAcpSchema from "effect-acp/compat";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";

// kimi-code 2.3.1 answers `/compact` as soon as the compaction starts in the background. A
// prompt sent before it ends is queued by its engine and answered at once, and the queued
// turn's updates are then dropped because no prompt owns them. Holding `/compact` open until
// the agent reports the end keeps T3's next message in T3's own queue.
const BACKGROUND_COMPACTION_STARTED = "Context compaction started";
const BACKGROUND_COMPACTION_ENDED = ["Compaction completed.", "Compaction cancelled."];
// kimi-code reports nothing when the compaction request itself fails.
const BACKGROUND_COMPACTION_FALLBACK = "15 minutes";

const isCompactPrompt = (payload: Omit<EffectAcpSchema.PromptRequest, "sessionId">) => {
  const first = payload.prompt[0];
  return first?.type === "text" && /^\/compact(\s|$)/.test(first.text.trimStart());
};

const agentText = (notification: EffectAcpSchema.SessionNotification) =>
  notification.update.sessionUpdate === "agent_message_chunk" &&
  notification.update.content.type === "text"
    ? notification.update.content.text
    : undefined;

export const makeBackgroundCompactionRuntime = (
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
): AcpSessionRuntime.AcpSessionRuntime["Service"] => {
  let compactInFlight = false;
  let compaction: Deferred.Deferred<void> | undefined;
  let cancelRequested: Deferred.Deferred<void> | undefined;
  // Read through a call: notification handlers set it while the prompt is suspended.
  const currentCompaction = () => compaction;

  const observe = (notification: EffectAcpSchema.SessionNotification) =>
    Effect.suspend(() => {
      const text = agentText(notification);
      if (text === undefined) return Effect.void;
      if (compactInFlight && text.startsWith(BACKGROUND_COMPACTION_STARTED)) {
        compaction = Deferred.makeUnsafe<void>();
        return Effect.void;
      }
      const ended = compaction;
      if (ended === undefined || !BACKGROUND_COMPACTION_ENDED.some((end) => text.startsWith(end)))
        return Effect.void;
      compaction = undefined;
      return Deferred.succeed(ended, undefined);
    });

  return {
    ...runtime,
    // The adapter projects the end notice before the held prompt returns, so it lands in the
    // compaction turn instead of after it.
    handleSessionUpdate: (handler) =>
      runtime.handleSessionUpdate((notification) =>
        handler(notification).pipe(Effect.ensuring(observe(notification))),
      ),
    prompt: (payload, options) => {
      if (!isCompactPrompt(payload)) return runtime.prompt(payload, options);
      return Effect.gen(function* () {
        compactInFlight = true;
        compaction = undefined;
        const response = yield* runtime.prompt(payload, options).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              compactInFlight = false;
            }),
          ),
        );
        const running = currentCompaction();
        if (running === undefined || response.stopReason !== "end_turn") return response;
        const cancelled = yield* Deferred.make<void>();
        cancelRequested = cancelled;
        const outcome = yield* Effect.raceFirst(
          Deferred.await(running).pipe(Effect.as("end_turn" as const)),
          Deferred.await(cancelled).pipe(Effect.as("cancelled" as const)),
        ).pipe(
          Effect.timeoutOption(BACKGROUND_COMPACTION_FALLBACK),
          Effect.ensuring(
            Effect.sync(() => {
              cancelRequested = undefined;
              if (compaction === running) compaction = undefined;
            }),
          ),
        );
        return { ...response, stopReason: Option.getOrElse(outcome, () => "end_turn" as const) };
      });
    },
    cancel: Effect.suspend(() =>
      cancelRequested === undefined ? Effect.void : Deferred.succeed(cancelRequested, undefined),
    ).pipe(Effect.andThen(runtime.cancel)),
  };
};
