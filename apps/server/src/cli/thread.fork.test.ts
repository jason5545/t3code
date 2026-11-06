import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { parseAnswers, readPendingQuestions, sendToThread, type ThreadTools } from "./thread.ts";

const threadId = ThreadId.make("thread-1");

const scriptedTools = (script: Record<string, Array<unknown>>) => {
  const calls: Array<{ readonly tool: string; readonly args: unknown }> = [];
  const call = ((tool: string, args: unknown) => {
    calls.push({ tool, args });
    const next = script[tool]?.shift();
    return next === undefined ? Effect.die(`unscripted ${tool} call`) : Effect.succeed(next);
  }) as ThreadTools["call"];
  return { tools: { call } satisfies ThreadTools, calls };
};

it.effect("send passes the chosen mode to t3_thread_send", () =>
  Effect.gen(function* () {
    const { tools, calls } = scriptedTools({ t3_thread_send: [{ delivery: "steered" }] });

    yield* sendToThread(tools, { threadId, message: "HOLD", mode: "steer" });

    assert.deepStrictEqual(calls, [
      { tool: "t3_thread_send", args: { threadId, message: "HOLD", mode: "steer" } },
    ]);
  }),
);

it.effect("questions reads every pending request of the thread", () =>
  Effect.gen(function* () {
    const question = { requestId: "request-1", questions: [] };
    const { tools, calls } = scriptedTools({
      t3_pending_request: [{ requestIds: ["request-1"] }, question],
    });

    assert.deepStrictEqual(yield* readPendingQuestions(tools, threadId), [question]);
    assert.deepStrictEqual(
      calls.map((entry) => entry.args),
      [
        { action: "list", threadId },
        { action: "read", threadId, requestId: "request-1" },
      ],
    );
  }),
);

it.effect("answers must be a JSON object keyed by question id", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(yield* parseAnswers('{"q1":"Yes"}'), { q1: "Yes" });
    for (const text of ["Yes", '"Yes"', '["Yes"]', "null"]) {
      const exit = yield* Effect.exit(parseAnswers(text));
      assert.isTrue(Exit.isFailure(exit), text);
    }
  }),
);
