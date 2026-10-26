import { type OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/**
 * Fork patch 22: what this machine is busy with and which pull requests it
 * watches, so an agent on another machine can split work without asking.
 */
export const MachineState = Schema.Struct({
  runningThreads: Schema.Array(
    Schema.Struct({ threadId: ThreadId, title: Schema.String, status: Schema.String }),
  ),
  watchedPullRequests: Schema.Array(
    Schema.Struct({ url: Schema.String, threadId: ThreadId, threadTitle: Schema.String }),
  ),
});

export const TailnetMachines = Schema.NullOr(
  Schema.Array(
    Schema.Struct({
      name: Schema.String,
      os: Schema.NullOr(Schema.String),
      online: Schema.Boolean,
      lastSeen: Schema.NullOr(Schema.String),
    }),
  ),
);

export const machineState = (
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
): typeof MachineState.Type => ({
  runningThreads: threads.flatMap((thread) =>
    thread.activityRunStatus == null
      ? []
      : [{ threadId: thread.id, title: thread.title, status: thread.activityRunStatus }],
  ),
  watchedPullRequests: threads.flatMap((thread) =>
    (thread.pullRequests ?? []).flatMap((link) =>
      link.watch === undefined
        ? []
        : [{ url: link.url, threadId: thread.id, threadTitle: thread.title }],
    ),
  ),
});
