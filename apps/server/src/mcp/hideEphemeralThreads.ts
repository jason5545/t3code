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

    // Untraced: each call is the wrapped service's, which has its own spans.
    return ThreadManagement.ThreadManagementService.of({
      ...base,
      getThreadShell: Effect.fnUntraced(function* (threadId) {
        return yield* base
          .getThreadShell(threadId)
          .pipe(Effect.map((shell) => (shell?.ephemeral === true ? null : shell)));
      }),
      getShellSnapshot: Effect.fnUntraced(function* (options) {
        return yield* base.getShellSnapshot(options).pipe(Effect.map(visibleSnapshot));
      }),
      readShellSnapshot: Effect.fnUntraced(function* (options) {
        return yield* base
          .readShellSnapshot(options)
          .pipe(Effect.map((read) => read.pipe(Effect.map(visibleSnapshot))));
      }),
      listProjectThreads: Effect.fnUntraced(function* (input) {
        return yield* base.listProjectThreads(input).pipe(Effect.map(visible));
      }),
      dispatch: Effect.fnUntraced(function* (command) {
        return yield* Effect.forEach(involvedThreadIds(command), isHidden).pipe(
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
        );
      }),
      searchThread: Effect.fnUntraced(function* (input) {
        return yield* unlessHidden(input.threadId, base.searchThread(input));
      }),
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
      getThreadHistoryPage: Effect.fnUntraced(function* (threadId, ...rest) {
        return yield* unlessHidden(threadId, base.getThreadHistoryPage(threadId, ...rest));
      }),
      getTimelinePage: Effect.fnUntraced(function* (threadId, options) {
        return yield* unlessHidden(threadId, base.getTimelinePage(threadId, options));
      }),
      getMessageCount: Effect.fnUntraced(function* (threadId) {
        return yield* unlessHidden(threadId, base.getMessageCount(threadId));
      }),
      getTurnItem: Effect.fnUntraced(function* (input) {
        return yield* unlessHidden(input.threadId, base.getTurnItem(input));
      }),
      getThreadRecords: Effect.fnUntraced(function* (threadId, fields, filter) {
        return yield* unlessHidden(threadId, base.getThreadRecords(threadId, fields, filter));
      }),
      getThreadProjection: Effect.fnUntraced(function* (threadId) {
        return yield* unlessHidden(threadId, base.getThreadProjection(threadId));
      }),
      getCheckpointContext: Effect.fnUntraced(function* (threadId) {
        return yield* unlessHidden(threadId, base.getCheckpointContext(threadId));
      }),
      getThreadSnapshot: Effect.fnUntraced(function* (threadId) {
        return yield* unlessHidden(threadId, base.getThreadSnapshot(threadId));
      }),
      getThreadTranscript: Effect.fnUntraced(function* (threadId) {
        return yield* unlessHidden(threadId, base.getThreadTranscript(threadId));
      }),
      getThreadSnapshotWindow: Effect.fnUntraced(function* (threadId, options) {
        return yield* unlessHidden(threadId, base.getThreadSnapshotWindow(threadId, options));
      }),
      getThreadEventSequence: Effect.fnUntraced(function* (threadId) {
        return yield* unlessHidden(threadId, base.getThreadEventSequence(threadId));
      }),
      getProjectThreadRecords: Effect.fnUntraced(function* (input, fields, filter) {
        return yield* unlessHiddenInProject(
          input,
          base.getProjectThreadRecords(input, fields, filter),
        );
      }),
      getProjectThread: Effect.fnUntraced(function* (input) {
        return yield* unlessHiddenInProject(input, base.getProjectThread(input));
      }),
      sendToThread: Effect.fnUntraced(function* (input) {
        return yield* unlessHiddenInProject(input, base.sendToThread(input));
      }),
      waitForThread: Effect.fnUntraced(function* (input) {
        return yield* unlessHiddenInProject(input, base.waitForThread(input));
      }),
      interruptThread: Effect.fnUntraced(function* (input) {
        return yield* unlessHiddenInProject(input, base.interruptThread(input));
      }),
      settleAfterRun: Effect.fnUntraced(function* (input) {
        return yield* unlessHiddenInProject(input, base.settleAfterRun(input));
      }),
      settleThread: Effect.fnUntraced(function* (input) {
        return yield* unlessHidden(input.threadId, base.settleThread(input));
      }),
      stopDelegatedTasks: Effect.fnUntraced(function* (input) {
        return yield* unlessHidden(input.threadId, base.stopDelegatedTasks(input));
      }),
    });
  }),
);
