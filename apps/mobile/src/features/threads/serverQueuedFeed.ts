import type { ThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import * as DateTime from "effect/DateTime";

import type { PendingThreadFeedEntry } from "./pending-thread-feed";

/** A server-queued follow-up has no turn item until its run starts, so the feed shows it from the queue. */
export function appendServerQueuedMessages(
  rows: ReadonlyArray<PendingThreadFeedEntry>,
  workflow: ThreadQueueWorkflowState | null,
): ReadonlyArray<PendingThreadFeedEntry> {
  const queuedRuns = workflow?.queuedRuns ?? [];
  if (queuedRuns.length === 0) return rows;
  const shownIds = new Set<string>(
    rows.flatMap((entry) => (entry.type === "message" ? [entry.message.id] : [])),
  );
  const queued = queuedRuns
    .filter(({ messageId }) => !shownIds.has(messageId))
    .map(({ run, text, attachments, messageId, context }): PendingThreadFeedEntry => {
      const requestedAt = DateTime.formatIso(run.requestedAt);
      return {
        type: "message",
        id: messageId,
        createdAt: requestedAt,
        serverQueued: true,
        message: {
          id: messageId,
          role: "user",
          text,
          attachments,
          ...(context ? { context } : {}),
          createdAt: requestedAt,
          updatedAt: requestedAt,
          runId: run.id,
          streaming: false,
          visibility: "local",
          sourceThreadId: run.threadId,
        },
      };
    });
  return queued.length === 0 ? rows : [...rows, ...queued];
}
