import { assert, describe, it } from "@effect/vitest";
import { MessageId, ProviderThreadId, RunId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { historicalMessage } from "@t3tools/provider-core/server/handoffBudget";

const now = DateTime.makeUnsafe("2026-10-30T00:00:00Z");

describe("historicalMessage (fork)", () => {
  // OMP's local models emit a blank text block between thinking and each tool call.
  it("drops blank assistant messages and keeps ones with text", () => {
    const assistant = (text: string) =>
      historicalMessage({
        id: TurnItemId.make("item:assistant"),
        threadId: ThreadId.make("thread:handoff"),
        runId: RunId.make("run:source"),
        nodeId: null,
        providerThreadId: ProviderThreadId.make("provider-thread:omp"),
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        status: "completed",
        title: null,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        type: "assistant_message",
        messageId: MessageId.make("message:assistant"),
        text,
        streaming: false,
      });
    assert.isNull(assistant("\n\n"));
    assert.isNull(assistant(""));
    assert.equal(assistant("\nDone.\n")?.text, "\nDone.\n");
  });
});
