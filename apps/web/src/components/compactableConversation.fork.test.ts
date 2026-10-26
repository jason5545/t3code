import { MessageId, RunId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { hasCompactableConversation } from "./compactableConversation";

const threadId = ThreadId.make("thread-1");
const at = DateTime.makeUnsafe("2026-10-26T08:00:00.000Z");

function itemBase(id: string, ordinal: number) {
  return {
    id: TurnItemId.make(id),
    threadId,
    runId: RunId.make("run:thread:thread-1:ordinal:1"),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
  };
}

function userMessage(text: string) {
  return {
    item: {
      ...itemBase("turn-item:user", 1),
      createdBy: "agent" as const,
      creationSource: "mcp" as const,
      type: "user_message" as const,
      messageId: MessageId.make("message-user"),
      inputIntent: "turn_start" as const,
      text,
      attachments: [],
    },
  };
}

function assistantMessage() {
  return {
    item: {
      ...itemBase("turn-item:assistant", 2),
      type: "assistant_message" as const,
      messageId: MessageId.make("message-assistant"),
      streaming: false,
    },
  };
}

describe("hasCompactableConversation", () => {
  it("counts a loaded user message", () => {
    expect(
      hasCompactableConversation({
        visibleTurnItems: [userMessage("fix it")],
        hasMoreHistory: false,
        latestUserMessageAt: "2026-10-26T08:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("counts a user message beyond the loaded page", () => {
    expect(
      hasCompactableConversation({
        visibleTurnItems: [assistantMessage()],
        hasMoreHistory: true,
        latestUserMessageAt: "2026-10-26T08:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("stays unavailable when the thread never had a user message", () => {
    expect(
      hasCompactableConversation({
        visibleTurnItems: [assistantMessage()],
        hasMoreHistory: true,
        latestUserMessageAt: null,
      }),
    ).toBe(false);
  });

  it("does not count a lone /compact", () => {
    expect(
      hasCompactableConversation({
        visibleTurnItems: [userMessage("/compact")],
        hasMoreHistory: false,
        latestUserMessageAt: "2026-10-26T08:00:00.000Z",
      }),
    ).toBe(false);
  });
});
