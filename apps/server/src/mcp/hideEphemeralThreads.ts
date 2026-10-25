/**
 * Fork patch 11: agents never see ephemeral threads. MCP's services are built
 * inside the MCP server layer, so providing this view there covers every tool:
 * an ephemeral thread reads as missing and commands naming it are refused.
 * The ephemeral thread's own session gets no MCP credential at all.
 */
import type {
  OrchestrationV2ThreadShell,
  OrchestrationV2ThreadShellSnapshot,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { involvedThreadIds } from "../orchestration-v2/EphemeralThreads.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { ProjectionStoreThreadNotFoundError } from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

const visible = (threads: ReadonlyArray<OrchestrationV2ThreadShell>) =>
  threads.filter((thread) => thread.ephemeral !== true);

const visibleSnapshot = (
  snapshot: OrchestrationV2ThreadShellSnapshot,
): OrchestrationV2ThreadShellSnapshot => ({
  ...snapshot,
  threads: visible(snapshot.threads),
  archivedThreads: visible(snapshot.archivedThreads),
});

export const layer = Layer.effect(
  ThreadManagement.ThreadManagementService,
  Effect.gen(function* () {
    const base = yield* ThreadManagement.ThreadManagementService;
    const isHidden = (threadId: ThreadId) =>
      base.getThreadShell(threadId).pipe(
        Effect.map((shell) => shell?.ephemeral === true),
        Effect.orElseSucceed(() => false),
      );
    const missing = (threadId: ThreadId) =>
      new Orchestrator.OrchestratorProjectionError({
        threadId,
        cause: new ProjectionStoreThreadNotFoundError({ threadId }),
      });
    const unlessHidden = <A, E, R>(
      threadId: ThreadId,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | Orchestrator.OrchestratorProjectionError, R> =>
      isHidden(threadId).pipe(
        Effect.flatMap(
          (hidden): Effect.Effect<A, E | Orchestrator.OrchestratorProjectionError, R> =>
            hidden ? Effect.fail(missing(threadId)) : effect,
        ),
      );
    const unlessHiddenInProject = <A, E, R>(
      input: { readonly projectId: ProjectId; readonly threadId: ThreadId },
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | ThreadManagement.ThreadManagementThreadNotFoundError, R> =>
      isHidden(input.threadId).pipe(
        Effect.flatMap(
          (
            hidden,
          ): Effect.Effect<A, E | ThreadManagement.ThreadManagementThreadNotFoundError, R> =>
            hidden
              ? Effect.fail(
                  new ThreadManagement.ThreadManagementThreadNotFoundError({
                    projectId: input.projectId,
                    threadId: input.threadId,
                  }),
                )
              : effect,
        ),
      );

    return ThreadManagement.ThreadManagementService.of({
      ...base,
      getThreadShell: (threadId) =>
        base
          .getThreadShell(threadId)
          .pipe(Effect.map((shell) => (shell?.ephemeral === true ? null : shell))),
      getShellSnapshot: (options) =>
        base.getShellSnapshot(options).pipe(Effect.map(visibleSnapshot)),
      readShellSnapshot: (options) =>
        base
          .readShellSnapshot(options)
          .pipe(Effect.map((read) => read.pipe(Effect.map(visibleSnapshot)))),
      listProjectThreads: (input) => base.listProjectThreads(input).pipe(Effect.map(visible)),
      dispatch: (command) =>
        Effect.forEach(involvedThreadIds(command), isHidden).pipe(
          Effect.flatMap((hidden) =>
            hidden.some(Boolean)
              ? Effect.fail(
                  new Orchestrator.OrchestratorCommandRejectedError({
                    commandId: command.commandId,
                    commandType: command.type,
                    cause: "The thread was not found.",
                  }),
                )
              : base.dispatch(command),
          ),
        ),
      searchThread: (input) => unlessHidden(input.threadId, base.searchThread(input)),
      searchThreadStream: (input) =>
        Stream.unwrap(
          isHidden(input.threadId).pipe(
            Effect.map((hidden) =>
              hidden
                ? Stream.fail<Orchestrator.OrchestratorV2Error>(missing(input.threadId))
                : base.searchThreadStream(input),
            ),
          ),
        ),
      getThreadHistoryPage: (threadId, ...rest) =>
        unlessHidden(threadId, base.getThreadHistoryPage(threadId, ...rest)),
      getTimelinePage: (threadId, options) =>
        unlessHidden(threadId, base.getTimelinePage(threadId, options)),
      getMessageCount: (threadId) => unlessHidden(threadId, base.getMessageCount(threadId)),
      getTurnItem: (input) => unlessHidden(input.threadId, base.getTurnItem(input)),
      getThreadRecords: (threadId, fields, filter) =>
        unlessHidden(threadId, base.getThreadRecords(threadId, fields, filter)),
      getThreadProjection: (threadId) => unlessHidden(threadId, base.getThreadProjection(threadId)),
      getCheckpointContext: (threadId) =>
        unlessHidden(threadId, base.getCheckpointContext(threadId)),
      getThreadSnapshot: (threadId) => unlessHidden(threadId, base.getThreadSnapshot(threadId)),
      getThreadTranscript: (threadId) => unlessHidden(threadId, base.getThreadTranscript(threadId)),
      getThreadSnapshotWindow: (threadId, options) =>
        unlessHidden(threadId, base.getThreadSnapshotWindow(threadId, options)),
      getThreadEventSequence: (threadId) =>
        unlessHidden(threadId, base.getThreadEventSequence(threadId)),
      getProjectThreadRecords: (input, fields, filter) =>
        unlessHiddenInProject(input, base.getProjectThreadRecords(input, fields, filter)),
      getProjectThread: (input) => unlessHiddenInProject(input, base.getProjectThread(input)),
      sendToThread: (input) => unlessHiddenInProject(input, base.sendToThread(input)),
      waitForThread: (input) => unlessHiddenInProject(input, base.waitForThread(input)),
      interruptThread: (input) => unlessHiddenInProject(input, base.interruptThread(input)),
      settleAfterRun: (input) => unlessHiddenInProject(input, base.settleAfterRun(input)),
      settleThread: (input) => unlessHidden(input.threadId, base.settleThread(input)),
      stopDelegatedTasks: (input) => unlessHidden(input.threadId, base.stopDelegatedTasks(input)),
    });
  }),
);
