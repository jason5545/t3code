import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  decodeQueuedThreadMessage,
  encodeQueuedThreadMessage,
  resumeCompactionSendFields,
  resumeCompactionTurnMessage,
  type QueuedThreadMessage,
} from "./thread-outbox-model";

const message: QueuedThreadMessage = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  messageId: MessageId.make("message-1"),
  commandId: CommandId.make("command-1"),
  text: "回來了",
  attachments: [],
  createdAt: "2026-10-31T00:00:00.000Z",
};

describe("resume compaction on mobile sends", () => {
  it.each([
    { name: "compacts a stale session first", tokens: 293_611, expected: true },
    { name: "leaves a fresh session alone", tokens: null, expected: false },
    { name: "keeps full history when asked", tokens: 293_611, keep: true, expected: false },
    {
      name: "does not compact twice for /compact",
      tokens: 293_611,
      text: "/compact",
      expected: false,
    },
  ])("$name", ({ tokens, keep, text, expected }) => {
    expect(
      resumeCompactionSendFields({
        resumeCompactionTokens: tokens,
        keepFullHistory: keep ?? false,
        text: text ?? "回來了",
        attachmentCount: 0,
      }),
    ).toEqual(expected ? { compactBeforeSend: true, dispatchMode: "queue" } : null);
  });

  it("survives the outbox store and resends the same /compact command on retry", () => {
    const stored = decodeQueuedThreadMessage(
      encodeQueuedThreadMessage({ ...message, compactBeforeSend: true, dispatchMode: "queue" }),
    );
    const first = resumeCompactionTurnMessage(stored);
    expect(first).toEqual({
      commandId: "command-1:compact",
      message: {
        messageId: "message-1:compact",
        role: "user",
        text: "/compact",
        attachments: [],
        idleCompaction: "onReturn",
      },
    });
    expect(resumeCompactionTurnMessage(stored)).toEqual(first);
    expect(resumeCompactionTurnMessage(message)).toBeNull();
  });
});
