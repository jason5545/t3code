import { MessageId, RunId, ThreadId } from "@t3tools/contracts";
import type { ThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import type { PendingThreadFeedEntry } from "./pending-thread-feed";
import { appendServerQueuedMessages } from "./serverQueuedFeed";

type QueuedRun = ThreadQueueWorkflowState["queuedRuns"][number];

const threadId = ThreadId.make("thread-1");

function queuedRun(id: string, text: string): QueuedRun {
  return {
    run: {
      id: RunId.make(`run-${id}`),
      threadId,
      requestedAt: DateTime.makeUnsafe("2026-10-26T01:00:00.000Z"),
    } as QueuedRun["run"],
    text,
    attachments: [],
    messageId: MessageId.make(id),
  };
}

function workflow(...queuedRuns: QueuedRun[]): ThreadQueueWorkflowState {
  return {
    activeRun: null,
    queuedRuns,
    isHeld: false,
    canReorder: true,
    canPromoteToSteer: false,
    canSendNow: false,
  };
}

function userRow(id: string): PendingThreadFeedEntry {
  return {
    type: "message",
    id,
    createdAt: "2026-10-26T00:59:00.000Z",
    message: {
      id: MessageId.make(id),
      role: "user",
      text: "earlier",
      attachments: [],
      runId: null,
      streaming: false,
      visibility: "local",
      sourceThreadId: threadId,
      createdAt: "2026-10-26T00:59:00.000Z",
      updatedAt: "2026-10-26T00:59:00.000Z",
    },
  };
}

describe("server-queued messages in the feed", () => {
  it("shows a queued follow-up at the end, marked queued", () => {
    const rows = appendServerQueuedMessages([userRow("m-1")], workflow(queuedRun("m-2", "next")));
    expect(rows.map((row) => row.id)).toEqual(["m-1", "m-2"]);
    const queued = rows[1]!;
    expect(queued.serverQueued).toBe(true);
    expect(queued.type === "message" && queued.message.text).toBe("next");
    expect(queued.createdAt).toBe("2026-10-26T01:00:00.000Z");
  });

  it("does not repeat a message the feed already shows", () => {
    const rows = appendServerQueuedMessages([userRow("m-2")], workflow(queuedRun("m-2", "next")));
    expect(rows.map((row) => row.id)).toEqual(["m-2"]);
    expect(rows[0]!.serverQueued).toBeUndefined();
  });

  it("leaves the feed untouched without a queue", () => {
    const rows = [userRow("m-1")];
    expect(appendServerQueuedMessages(rows, workflow())).toBe(rows);
    expect(appendServerQueuedMessages(rows, null)).toBe(rows);
  });
});
