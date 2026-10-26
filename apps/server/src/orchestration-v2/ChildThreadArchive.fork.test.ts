import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as ChildThreadArchive from "./ChildThreadArchive.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for archive cascades"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const layerDatabase = SqlitePersistence.layerMemory;
const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
  { name: "child-thread-archive" },
  ProviderAdapterRegistry.layerFromAdapters([adapter]),
  { databaseLayer: layerDatabase, runEffectWorker: false },
);
const layerThreads = Layer.unwrap(
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return Layer.mock(ThreadManagement.ThreadManagementService)({
      dispatch: orchestrator.dispatch,
      getThreadRecords: orchestrator.getThreadRecords,
    });
  }),
).pipe(Layer.provide(layerOrchestrator));
const layerTest = Layer.mergeAll(
  layerDatabase,
  layerOrchestrator,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
  ChildThreadArchive.layer.pipe(Layer.provide(Layer.merge(layerThreads, layerDatabase))),
);

const launcher = ThreadId.make("thread:launcher");
const child = ThreadId.make("thread:child");
const grandchild = ThreadId.make("thread:grandchild");
const archivedAlone = ThreadId.make("thread:archived-alone");
const working = ThreadId.make("thread:working");
const unrelated = ThreadId.make("thread:unrelated");
const threadIds = [launcher, child, grandchild, archivedAlone, working, unrelated];

it.effect(
  "archive carries a thread's launched children with it and unarchive brings back only those",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const cascade = yield* ChildThreadArchive.ChildThreadArchive;
      const create = (threadId: ThreadId, launchedByThreadId?: ThreadId) =>
        orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make(`create:${threadId}`),
          threadId,
          projectId: ProjectId.make("project:child-thread-archive"),
          title: threadId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdBy: launchedByThreadId === undefined ? "user" : "agent",
          creationSource: launchedByThreadId === undefined ? "web" : "mcp",
          ...(launchedByThreadId === undefined ? {} : { launchedByThreadId }),
        });
      // Runs the cascade effects a command queued, then those of the commands they dispatched.
      const runCascades = (
        commandId: CommandId,
      ): Effect.Effect<
        void,
        ChildThreadArchive.ChildThreadArchiveError | EffectOutbox.EffectOutboxError
      > =>
        Effect.gen(function* () {
          for (const effect of yield* outbox.listByCommandId(commandId)) {
            const request = effect.request;
            if (
              request.type !== "child-threads.archive" &&
              request.type !== "child-threads.unarchive"
            )
              continue;
            const input = {
              threadId: effect.threadId,
              commandId: effect.commandId,
              archivedAt: request.archivedAt,
            };
            const archiving = request.type === "child-threads.archive";
            yield* archiving ? cascade.archive(input) : cascade.unarchive(input);
            for (const threadId of threadIds) {
              yield* runCascades(
                CommandId.make(
                  `${commandId}:${archiving ? "archive-child" : "unarchive-child"}:${threadId}`,
                ),
              );
            }
          }
        });
      const archivedAt = (threadId: ThreadId) =>
        projections
          .getThread(threadId)
          .pipe(
            Effect.map((thread) =>
              thread.archivedAt === null ? null : DateTime.formatIso(thread.archivedAt),
            ),
          );

      yield* create(launcher);
      yield* create(child, launcher);
      yield* create(grandchild, child);
      yield* create(archivedAlone, launcher);
      yield* create(working, launcher);
      yield* create(unrelated);
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("queue-working"),
        threadId: working,
        messageId: MessageId.make("message:working"),
        text: "Keep going",
        attachments: [],
        dispatchMode: { type: "defer_start" },
        createdBy: "agent",
        creationSource: "mcp",
      });
      const archiveAlone = CommandId.make("archive-alone");
      yield* orchestrator.dispatch({
        type: "thread.archive",
        commandId: archiveAlone,
        threadId: archivedAlone,
      });
      yield* runCascades(archiveAlone);
      const aloneAt = yield* archivedAt(archivedAlone);

      yield* TestClock.adjust("1 minute");
      const archiveLauncher = CommandId.make("archive-launcher");
      yield* orchestrator.dispatch({
        type: "thread.archive",
        commandId: archiveLauncher,
        threadId: launcher,
      });
      yield* runCascades(archiveLauncher);
      const launcherAt = yield* archivedAt(launcher);
      assert.isNotNull(launcherAt);
      assert.notEqual(launcherAt, aloneAt);
      assert.deepEqual(yield* Effect.forEach(threadIds, archivedAt), [
        launcherAt,
        launcherAt,
        launcherAt,
        aloneAt,
        null,
        null,
      ]);

      yield* TestClock.adjust("1 minute");
      const unarchiveLauncher = CommandId.make("unarchive-launcher");
      yield* orchestrator.dispatch({
        type: "thread.unarchive",
        commandId: unarchiveLauncher,
        threadId: launcher,
      });
      yield* runCascades(unarchiveLauncher);
      assert.deepEqual(yield* Effect.forEach(threadIds, archivedAt), [
        null,
        null,
        null,
        aloneAt,
        null,
        null,
      ]);
    }).pipe(Effect.provide(layerTest)),
);
