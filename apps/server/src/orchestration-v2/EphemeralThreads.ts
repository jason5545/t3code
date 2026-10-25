/**
 * Fork patch 11: ephemeral threads. A thread created ephemeral lives in Scratch,
 * runs on OMP with a model served from this machine, and is purged when it
 * ends: deleted by the user, idle for an hour, its OMP process gone, or found
 * at startup. Purging removes every row that names the thread, found from the
 * schema so tables upstream adds later are covered, then its files.
 */
import {
  CommandId,
  EPHEMERAL_THREAD_IDLE_MS,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2ServerCommand,
  type ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { isOmpBinary } from "@t3tools/provider-pi/server";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EphemeralThreadSignals from "./EphemeralThreadSignals.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ResourceCleanupService from "./ResourceCleanupService.ts";

const REFERENCE_COLUMNS = new Set([
  "thread_id",
  "source_thread_id",
  "target_thread_id",
  "child_thread_id",
]);
const SWEEP_INTERVAL = Duration.minutes(1);
const DELETE_EFFECTS_TIMEOUT = Duration.seconds(30);
const NOTHING_DISPATCHED: Orchestrator.OrchestratorV2DispatchResult = {
  sequence: 0,
  storedEvents: [],
};

/** Commands that never move an ephemeral thread's text or end its process. */
const UNCHECKED_COMMANDS: ReadonlySet<OrchestrationV2ServerCommand["type"]> = new Set([
  "thread.stop",
  "thread.visit",
  "thread.mark-unread",
  "thread.pin",
  "thread.unpin",
  "thread.pin.reorder",
  "thread.active.reorder",
  "thread.snooze",
  "thread.unsnooze",
  "thread.auto-settle",
  "thread.auto-settle.set",
  "thread.unsettle",
  "thread.interaction-mode.set",
  "run.interrupt",
  "subagent.stop",
  "queued-message.promote-to-steer",
  "queue.resume",
  "queued-run.start",
  "queued-run.reorder",
  "queued-run.cancel",
  "runtime-request.respond",
  "thread.user-input.dismiss",
  "notification.delivery.accept",
  "prepared-run.release",
  "prepared-run.progress",
  "prepared-run.fail",
  "prepared-run.retry",
]);

/** Allowed on an ephemeral thread once any model they carry passes the local check. */
const CHECKED_COMMANDS: ReadonlySet<OrchestrationV2ServerCommand["type"]> = new Set([
  "message.dispatch",
  "thread.model-selection.set",
  "queued-run.edit",
  "thread.metadata.update",
]);

export interface ReferenceColumn {
  readonly table: string;
  readonly column: string;
  /** Event-store rows name any aggregate; only `aggregate_kind = 'thread'` rows are threads. */
  readonly threadAggregateOnly: boolean;
}

/** Every column that holds an app thread id, read from the live schema. */
export const discoverReferenceColumns = Effect.fn("EphemeralThreads.discoverReferenceColumns")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly table_name: string; readonly column_name: string }>`
      SELECT schema.name AS table_name, info.name AS column_name
      FROM sqlite_schema AS schema
      JOIN pragma_table_info(schema.name) AS info
      WHERE schema.type = 'table' AND schema.name NOT LIKE 'sqlite_%'
      ORDER BY schema.name, info.cid
    `;
    const columnsByTable = new Map<string, Array<string>>();
    for (const row of rows) {
      const columns = columnsByTable.get(row.table_name) ?? [];
      columns.push(row.column_name);
      columnsByTable.set(row.table_name, columns);
    }
    return Array.from(columnsByTable).flatMap(([table, columns]): Array<ReferenceColumn> => [
      ...columns
        .filter((column) => REFERENCE_COLUMNS.has(column))
        .map((column) => ({ table, column, threadAggregateOnly: false })),
      ...(columns.includes("aggregate_kind")
        ? columns
            .filter((column) => column === "stream_id" || column === "aggregate_id")
            .map((column) => ({ table, column, threadAggregateOnly: true }))
        : []),
    ]);
  },
);

export function involvedThreadIds(command: OrchestrationV2ServerCommand): ReadonlyArray<ThreadId> {
  switch (command.type) {
    case "thread.fork":
    case "thread.merge_back":
      return [command.sourceThreadId, command.targetThreadId];
    case "delegated_task.request":
    case "delegated_task.wake-policy":
    case "delegated_task.completion-delivery.acknowledge":
    case "delegated_task.completion-delivery.dispose":
      return [command.parentThreadId];
    case "thread.created.record":
      return [command.parentThreadId, command.targetThreadId];
    default:
      return "threadId" in command ? [command.threadId] : [];
  }
}

const refused = (command: OrchestrationV2ServerCommand, cause: string) =>
  new Orchestrator.OrchestratorCommandRejectedError({
    commandId: command.commandId,
    commandType: command.type,
    cause,
  });

export interface EphemeralThreadsShape {
  /** Wraps a thread-management dispatch: refuses what an ephemeral thread may not do, purges on delete. */
  readonly dispatch: <E, R>(
    command: OrchestrationV2ServerCommand,
    next: (
      command: OrchestrationV2ServerCommand,
    ) => Effect.Effect<Orchestrator.OrchestratorV2DispatchResult, E, R>,
  ) => Effect.Effect<
    Orchestrator.OrchestratorV2DispatchResult,
    E | Orchestrator.OrchestratorV2Error,
    R
  >;
  readonly isEphemeral: (threadId: ThreadId) => Effect.Effect<boolean>;
  /** Ends the thread for connected clients, then removes every trace of it. */
  readonly purge: (threadId: ThreadId) => Effect.Effect<void>;
  /** Runs before provider recovery, so nothing resumes a thread whose process is gone. */
  readonly purgeAtStartup: Effect.Effect<number>;
  /** A shell replay from before a purge would miss its deletion. */
  readonly replayCrossesPurge: (afterSequence: number) => Effect.Effect<boolean>;
}

export class EphemeralThreads extends Context.Service<EphemeralThreads, EphemeralThreadsShape>()(
  "t3/orchestration-v2/EphemeralThreads",
) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const outbox = yield* EffectOutbox.EffectOutboxV2;
  const resourceCleanup = yield* ResourceCleanupService.ResourceCleanupService;
  const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const settings = yield* ServerSettings.ServerSettingsService;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const signals = yield* Effect.serviceOption(EphemeralThreadSignals.EphemeralThreadSignals);

  const scratchRoot = path.resolve(config.baseDir, "scratch");
  const insideScratch = (folder: string) => {
    const relative = path.relative(scratchRoot, path.resolve(folder));
    return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
  };
  const referenceColumns = yield* discoverReferenceColumns();
  const live = yield* Ref.make<ReadonlySet<ThreadId>>(new Set());
  const purgedThrough = yield* Ref.make(0);
  const inFlight = new Map<
    ThreadId,
    Deferred.Deferred<Orchestrator.OrchestratorV2DispatchResult>
  >();

  const readThread = (threadId: ThreadId) =>
    projections.getThread(threadId).pipe(
      Effect.map((thread): OrchestrationV2AppThread | null => thread),
      Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) }),
      Effect.mapError((cause) => new Orchestrator.OrchestratorProjectionError({ threadId, cause })),
    );

  const isLocalModel = Effect.fn("EphemeralThreads.isLocalModel")(function* (
    selection: ModelSelection,
  ) {
    const instance = yield* instances.getInstance(selection.instanceId);
    if (instance === undefined || instance.driverKind !== "pi") return false;
    const snapshot = yield* instance.snapshot.getSnapshot;
    return snapshot.models.some((model) => model.slug === selection.model && model.local === true);
  });

  const isOmpInstance = Effect.fn("EphemeralThreads.isOmpInstance")(function* (
    instanceId: ProviderInstanceId,
  ) {
    const current = yield* settings.getSettings.pipe(Effect.orElseSucceed(() => undefined));
    const entry = current?.providerInstances?.[instanceId];
    if (entry === undefined || entry.driver !== "pi") return false;
    const binaryPath =
      Predicate.isObject(entry.config) && Predicate.isString(entry.config.binaryPath)
        ? entry.config.binaryPath
        : "";
    return isOmpBinary(binaryPath || "pi");
  });

  const admitCreate = Effect.fn("EphemeralThreads.admitCreate")(function* (
    command: Extract<OrchestrationV2ServerCommand, { readonly type: "thread.create" }>,
  ) {
    const project = yield* projects.get(command.projectId).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.orElseSucceed(() => undefined),
    );
    if (project === undefined || path.resolve(project.workspaceRoot) !== scratchRoot) {
      return yield* refused(command, "Ephemeral threads exist only in No project.");
    }
    if (
      command.importedNativeThread !== undefined ||
      command.branch !== null ||
      (command.worktreePath !== null && !insideScratch(command.worktreePath))
    ) {
      return yield* refused(command, "An ephemeral thread starts in its own Scratch folder.");
    }
    if (!(yield* isOmpInstance(command.modelSelection.instanceId))) {
      return yield* refused(command, "Ephemeral threads run only on OMP.");
    }
    if (!(yield* isLocalModel(command.modelSelection))) {
      return yield* refused(
        command,
        "Ephemeral threads run only on a model served from this machine.",
      );
    }
  });

  const admitOnEphemeral = Effect.fn("EphemeralThreads.admitOnEphemeral")(function* (
    command: OrchestrationV2ServerCommand,
    thread: OrchestrationV2AppThread,
  ) {
    if (!CHECKED_COMMANDS.has(command.type)) {
      return yield* refused(command, "An ephemeral thread cannot do this; delete it to end it.");
    }
    // The launch records the Scratch folder it made with a metadata update of its own.
    const recordsOwnFolder = (worktreePath: string | null) =>
      worktreePath === thread.worktreePath ||
      (thread.worktreePath === null && worktreePath !== null && insideScratch(worktreePath));
    if (
      command.type === "thread.metadata.update" &&
      (command.regenerateTitle === true ||
        (command.branch !== undefined && command.branch !== null) ||
        (command.worktreePath !== undefined && !recordsOwnFolder(command.worktreePath)))
    ) {
      return yield* refused(command, "An ephemeral thread keeps its title and folder.");
    }
    if (
      command.type === "message.dispatch" &&
      (command.scheduledTaskId !== undefined || command.senderThreadId !== undefined)
    ) {
      return yield* refused(command, "Only the user writes to an ephemeral thread.");
    }
    const selection =
      "modelSelection" in command && command.modelSelection !== undefined
        ? command.modelSelection
        : undefined;
    if (
      selection !== undefined &&
      (selection.instanceId !== thread.providerInstanceId || !(yield* isLocalModel(selection)))
    ) {
      return yield* refused(
        command,
        "An ephemeral thread stays on its OMP instance and on local models.",
      );
    }
  });

  const removeTraces = Effect.fn("EphemeralThreads.removeTraces")(function* (
    threadId: ThreadId,
    worktreePath: string | null,
  ) {
    // Files go first: a crash before the rows are gone leaves the thread for
    // the next startup to find again.
    const attachmentIds = yield* projections
      .getThreadAttachmentIds(threadId)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    yield* resourceCleanup.cleanupAttachments(attachmentIds).pipe(Effect.ignore);
    yield* resourceCleanup.cleanupTerminals(threadId).pipe(Effect.ignore);
    if (worktreePath !== null && insideScratch(worktreePath)) {
      yield* fileSystem.remove(worktreePath, { recursive: true, force: true }).pipe(Effect.ignore);
    }
    const lastEventSequence = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const tail = yield* sql<{ readonly sequence: number | null }>`
          SELECT MAX(sequence) AS sequence
          FROM orchestration_events
          WHERE aggregate_kind = 'thread' AND stream_id = ${threadId}
        `;
          for (const reference of referenceColumns) {
            yield* sql.unsafe(
              `DELETE FROM "${reference.table}" WHERE "${reference.column}" = ?${
                reference.threadAggregateOnly ? " AND aggregate_kind = 'thread'" : ""
              }`,
              [threadId],
            );
          }
          // `t3 doctor` checks the projection against the newest thread event;
          // deleting the newest ones must move the projection back with it.
          yield* sql`
          UPDATE orchestration_v2_projection_metadata
          SET last_sequence = (
            SELECT COALESCE(MAX(sequence), 0) FROM orchestration_events
            WHERE application_event_version = 2 AND aggregate_kind = 'thread'
          )
          WHERE projection_name = 'thread-projections'
            AND last_sequence > (
              SELECT COALESCE(MAX(sequence), 0) FROM orchestration_events
              WHERE application_event_version = 2 AND aggregate_kind = 'thread'
            )
        `;
          return tail[0]?.sequence ?? 0;
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) => new Orchestrator.OrchestratorProjectionError({ threadId, cause }),
        ),
      );
    // secure_delete zeroed the freed pages; TRUNCATE drops the WAL frames that
    // still hold earlier versions. A reader can hold the WAL, so retry briefly.
    yield* sql<{ readonly busy: number }>`PRAGMA wal_checkpoint(TRUNCATE)`.pipe(
      Effect.flatMap((rows) => (rows[0]?.busy === 1 ? Effect.fail("busy" as const) : Effect.void)),
      Effect.retry({ times: 10, schedule: Schedule.spaced(Duration.seconds(1)) }),
      Effect.ignore,
    );
    if (projections.forgetThreadSearch !== undefined) {
      yield* projections.forgetThreadSearch(threadId);
    }
    yield* Ref.update(purgedThrough, (current) => Math.max(current, lastEventSequence));
    yield* Ref.update(live, (current) => {
      const next = new Set(current);
      next.delete(threadId);
      return next;
    });
  });

  const purgeThread = Effect.fn("EphemeralThreads.purgeThread")(function* (
    threadId: ThreadId,
    deleteCommandId?: CommandId,
  ) {
    const pending = inFlight.get(threadId);
    if (pending !== undefined) return yield* Deferred.await(pending);
    const done = yield* Deferred.make<Orchestrator.OrchestratorV2DispatchResult>();
    inFlight.set(threadId, done);
    return yield* Effect.gen(function* () {
      const thread = yield* readThread(threadId);
      let result: Orchestrator.OrchestratorV2DispatchResult = NOTHING_DISPATCHED;
      if (thread !== null && thread.deletedAt === null) {
        // A normal delete first: connected clients drop the thread and its
        // cleanup effects stop the provider session, terminals and previews.
        const commandId =
          deleteCommandId ??
          CommandId.make(
            `server:ephemeral-purge:${threadId}:${DateTime.toEpochMillis(yield* DateTime.now)}`,
          );
        result = yield* orchestrator.dispatch({ type: "thread.delete", commandId, threadId });
        const effects = yield* outbox
          .listByCommandId(commandId)
          .pipe(Effect.orElseSucceed(() => []));
        yield* Effect.forEach(effects, (effect) => outbox.awaitSettled(effect.id), {
          discard: true,
        }).pipe(Effect.timeout(DELETE_EFFECTS_TIMEOUT), Effect.ignore);
      }
      yield* removeTraces(threadId, thread?.worktreePath ?? null);
      return result;
    }).pipe(
      Effect.tap((result) => Deferred.succeed(done, result)),
      // Callers waiting on a failed purge see nothing dispatched; the first one gets the error.
      Effect.onExit(() =>
        Effect.sync(() => inFlight.delete(threadId)).pipe(
          Effect.andThen(Deferred.succeed(done, NOTHING_DISPATCHED)),
        ),
      ),
    );
  });

  const purge: EphemeralThreadsShape["purge"] = (threadId) =>
    purgeThread(threadId).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("ephemeral thread purge failed", { threadId, cause }),
      ),
      Effect.asVoid,
    );

  const isEphemeral: EphemeralThreadsShape["isEphemeral"] = (threadId) =>
    readThread(threadId).pipe(
      Effect.map((thread) => thread?.ephemeral === true),
      Effect.orElseSucceed(() => false),
    );

  const dispatch: EphemeralThreadsShape["dispatch"] = Effect.fn("EphemeralThreads.dispatch")(
    function* <E, R>(
      command: OrchestrationV2ServerCommand,
      next: (
        command: OrchestrationV2ServerCommand,
      ) => Effect.Effect<Orchestrator.OrchestratorV2DispatchResult, E, R>,
    ) {
      if (command.type === "thread.create") {
        if (command.ephemeral !== true) return yield* next(command);
        yield* admitCreate(command);
        const result = yield* next(command);
        yield* Ref.update(live, (current) => new Set(current).add(command.threadId));
        return result;
      }
      if (UNCHECKED_COMMANDS.has(command.type)) return yield* next(command);
      const threads = yield* Effect.forEach(involvedThreadIds(command), readThread);
      const ephemeral = threads.find((thread) => thread?.ephemeral === true);
      if (ephemeral === undefined || ephemeral === null) return yield* next(command);
      if (command.type === "thread.delete")
        return yield* purgeThread(ephemeral.id, command.commandId);
      yield* admitOnEphemeral(command, ephemeral);
      return yield* next(command);
    },
  );

  const purgeAtStartup: EphemeralThreadsShape["purgeAtStartup"] = Effect.gen(function* () {
    // The projection row, not `thread.created`: compaction may drop the
    // creation event once a newer whole-thread event supersedes it.
    const rows = yield* sql<{ readonly thread_id: string; readonly worktree_path: string | null }>`
      SELECT thread_id, json_extract(payload_json, '$.worktreePath') AS worktree_path
      FROM orchestration_v2_projection_threads
      WHERE json_extract(payload_json, '$.ephemeral') = 1
    `;
    yield* Effect.forEach(
      rows,
      (row) => removeTraces(ThreadId.make(row.thread_id), row.worktree_path),
      { discard: true },
    );
    return rows.length;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("ephemeral thread startup purge failed", { cause }).pipe(Effect.as(0)),
    ),
  );

  const replayCrossesPurge: EphemeralThreadsShape["replayCrossesPurge"] = (afterSequence) =>
    Ref.get(purgedThrough).pipe(Effect.map((through) => afterSequence < through));

  // No running run and no new message for the idle window ends the thread.
  const sweep = Effect.gen(function* () {
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    for (const threadId of yield* Ref.get(live)) {
      const thread = yield* readThread(threadId).pipe(Effect.orElseSucceed(() => null));
      if (thread === null) {
        yield* Ref.update(live, (current) => {
          const next = new Set(current);
          next.delete(threadId);
          return next;
        });
        continue;
      }
      // A delete that bypassed thread management (a project delete) left rows behind.
      if (thread.deletedAt !== null) {
        yield* purge(threadId);
        continue;
      }
      const shell = yield* orchestrator
        .getThreadShell(threadId)
        .pipe(Effect.orElseSucceed(() => null));
      if (shell === null) continue;
      if (shell.activeRunId !== null || shell.activityRunStatus != null) continue;
      const lastActivity = Math.max(
        DateTime.toEpochMillis(shell.createdAt),
        ...[shell.latestUserMessageAt, shell.latestRunStartedAt, shell.latestRunCompletedAt].map(
          (at) => (at == null ? 0 : DateTime.toEpochMillis(at)),
        ),
      );
      if (now - lastActivity >= EPHEMERAL_THREAD_IDLE_MS) yield* purge(threadId);
    }
  });

  yield* Effect.forkScoped(
    Effect.forever(Effect.sleep(SWEEP_INTERVAL).pipe(Effect.andThen(sweep))),
  );
  if (Option.isSome(signals)) {
    // The session manager reports a released session; its conversation is gone.
    yield* Effect.forkScoped(
      Effect.forever(
        Queue.take(signals.value.endedThreads).pipe(
          Effect.flatMap((threadId) =>
            isEphemeral(threadId).pipe(
              Effect.flatMap((ephemeral) => (ephemeral ? purge(threadId) : Effect.void)),
            ),
          ),
        ),
      ),
    );
  }

  return EphemeralThreads.of({
    dispatch,
    isEphemeral,
    purge,
    purgeAtStartup,
    replayCrossesPurge,
  });
});

export const layer = Layer.effect(EphemeralThreads, make);
