import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as HideEphemeralThreads from "../mcp/hideEphemeralThreads.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EphemeralThreads from "./EphemeralThreads.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ThreadSearch from "./ThreadSearch.ts";

const ompInstance = ProviderInstanceId.make("omp");
const localModel = { instanceId: ompInstance, model: "omlx/local-model" };
const projectId = ProjectId.make("project:scratch");
const MARKER = "EPHEMERAL-MARKER-41d0c8";

const fakeInstance = {
  instanceId: ompInstance,
  driverKind: "pi",
  snapshot: {
    getSnapshot: Effect.succeed({
      models: [
        { slug: localModel.model, name: "local", isCustom: false, local: true, capabilities: null },
        { slug: "opencode-go/hosted", name: "hosted", isCustom: false, capabilities: null },
      ],
    }),
  },
} as unknown as ProviderInstance;

/** The orchestrator's reads come from the real projections; deletes only report themselves. */
const layerOrchestrator = (deletes: Deferred.Deferred<ThreadId>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      return Layer.mock(Orchestrator.OrchestratorV2)({
        getThreadShell: (threadId) => projections.getThreadShell(threadId).pipe(Effect.orDie),
        dispatch: (command) =>
          Effect.gen(function* () {
            if (command.type === "thread.delete")
              yield* Deferred.succeed(deletes, command.threadId);
            return { sequence: 0, storedEvents: [] };
          }),
      });
    }),
  );

const makeLayer = <DatabaseError, DatabaseRequirements>(input: {
  readonly baseDir: string;
  readonly database: Layer.Layer<SqlClient.SqlClient, DatabaseError, DatabaseRequirements>;
  readonly deletes: Deferred.Deferred<ThreadId>;
}) => {
  const layerStores = Layer.mergeAll(
    ProjectionStore.layer,
    ProjectStore.layer,
    EffectOutbox.layer,
    ThreadSearch.layer,
  ).pipe(Layer.provideMerge(input.database));
  return EphemeralThreads.layer.pipe(
    Layer.provideMerge(layerStores),
    Layer.provideMerge(layerOrchestrator(input.deletes).pipe(Layer.provide(layerStores))),
    Layer.provide(
      Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
        getInstance: (instanceId) =>
          Effect.succeed(instanceId === ompInstance ? fakeInstance : undefined),
      }),
    ),
    Layer.provide(
      ServerSettings.layerTest({
        providerInstances: { [ompInstance]: { driver: "pi", config: { binaryPath: "omp" } } },
      }),
    ),
    Layer.provideMerge(ServerConfig.layerTest(input.baseDir, input.baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );
};

const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 9, 25, 0, minute));

const createScratchProject = (workspaceRoot: string) =>
  Effect.flatMap(ProjectStore.ProjectStoreV2, (projects) =>
    projects.apply({
      sequence: 0,
      eventId: EventId.make(`created:${projectId}`),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: DateTime.formatIso(at(0)),
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: "No project",
        workspaceRoot,
        defaultModelSelection: null,
        scripts: [],
        createdAt: DateTime.formatIso(at(0)),
        updatedAt: DateTime.formatIso(at(0)),
      },
    }),
  );

const threadCreated = (
  threadId: ThreadId,
  options: {
    readonly ephemeral: boolean;
    readonly worktreePath?: string | null;
    readonly createdAt?: DateTime.Utc;
  },
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`created:${threadId}`),
  type: "thread.created",
  threadId,
  providerInstanceId: ompInstance,
  occurredAt: options.createdAt ?? at(0),
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: "First line",
    providerInstanceId: ompInstance,
    modelSelection: localModel,
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: options.worktreePath ?? null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: options.createdAt ?? at(0),
    updatedAt: options.createdAt ?? at(0),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    ...(options.ephemeral ? { ephemeral: true } : {}),
  },
});

const messageUpdated = (
  threadId: ThreadId,
  id: string,
  text: string,
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`message:${id}:${text.length}`),
  type: "message.updated",
  threadId,
  providerInstanceId: ompInstance,
  occurredAt: at(1),
  payload: {
    createdBy: "agent",
    creationSource: "provider",
    id: MessageId.make(id),
    threadId,
    runId: null,
    nodeId: null,
    role: "assistant",
    text,
    attachments: [],
    streaming: false,
    createdAt: at(1),
    updatedAt: at(1),
  },
});

/** One row per discovered reference table, with every reference column naming `threadId`. */
const seedEveryReference = Effect.fn("test.seedEveryReference")(function* (
  threadId: ThreadId,
  tag: string,
) {
  const sql = yield* SqlClient.SqlClient;
  const references = yield* EphemeralThreads.discoverReferenceColumns();
  const tables = new Set(references.map((reference) => reference.table));
  // The thread row comes from projecting `thread.created`; startup reads its payload.
  tables.delete("orchestration_v2_projection_threads");
  let ordinal = 0;
  for (const table of tables) {
    const columns = yield* sql<{
      readonly name: string;
      readonly type: string;
      readonly notnull: number;
      readonly dflt_value: string | null;
      readonly pk: number;
    }>`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(${table})`;
    const tableReferences = new Set(
      references.filter((reference) => reference.table === table).map((r) => r.column),
    );
    const values = columns.flatMap((column) => {
      ordinal += 1;
      if (tableReferences.has(column.name)) return [[column.name, threadId] as const];
      if (column.name === "aggregate_kind") return [[column.name, "thread"] as const];
      if (column.name === "status") return [[column.name, "pending"] as const];
      if (column.notnull === 0 && column.pk === 0) return [];
      if (column.dflt_value !== null) return [];
      if (/INT/iu.test(column.type) && column.pk === 1) return [];
      // Expression indexes read JSON columns, so they need valid JSON.
      if (column.name.endsWith("_json")) return [[column.name, "{}"] as const];
      return [
        [
          column.name,
          /INT|REAL|NUM/iu.test(column.type) ? ordinal : `${tag}:${column.name}`,
        ] as const,
      ];
    });
    yield* sql.unsafe(
      `INSERT INTO "${table}" (${values.map(([name]) => `"${name}"`).join(", ")}) VALUES (${values
        .map(() => "?")
        .join(", ")})`,
      values.map(([, value]) => value),
    );
  }
});

const countReferences = Effect.fn("test.countReferences")(function* (threadId: ThreadId) {
  const sql = yield* SqlClient.SqlClient;
  const references = yield* EphemeralThreads.discoverReferenceColumns();
  let total = 0;
  for (const reference of references) {
    const rows = yield* sql.unsafe<{ readonly count: number }>(
      `SELECT COUNT(*) AS count FROM "${reference.table}" WHERE "${reference.column}" = ?`,
      [threadId],
    );
    total += rows[0]?.count ?? 0;
  }
  return total;
});

const withTempDir = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-ephemeral-" });
    return yield* use(directory);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect(
  "startup purge clears every row that names the thread, in tables found from the schema",
  () =>
    withTempDir((baseDir) =>
      Effect.gen(function* () {
        const deletes = yield* Deferred.make<ThreadId>();
        const ephemeral = ThreadId.make("thread:ephemeral");
        const kept = ThreadId.make("thread:kept");
        yield* Effect.gen(function* () {
          const projections = yield* ProjectionStore.ProjectionStoreV2;
          const threads = yield* EphemeralThreads.EphemeralThreads;
          const references = yield* EphemeralThreads.discoverReferenceColumns();
          // Event and receipt tables key threads by aggregate, not by a thread_id column.
          assert.isTrue(
            references.some((r) => r.table === "orchestration_events" && r.column === "stream_id"),
          );
          assert.isTrue(
            references.some(
              (r) => r.table === "orchestration_command_receipts" && r.column === "aggregate_id",
            ),
          );
          yield* createScratchProject(`${baseDir}/scratch`);
          yield* projections.apply(threadCreated(ephemeral, { ephemeral: true }));
          yield* projections.apply(threadCreated(kept, { ephemeral: false }));
          yield* seedEveryReference(ephemeral, "ephemeral");
          yield* seedEveryReference(kept, "kept");
          const keptBefore = yield* countReferences(kept);
          assert.isAbove(yield* countReferences(ephemeral), references.length - 1);

          assert.equal(yield* threads.purgeAtStartup, 1);

          assert.equal(yield* countReferences(ephemeral), 0);
          // The seeded rows are not valid projections, so count rather than read them.
          assert.equal(yield* countReferences(kept), keptBefore);
        }).pipe(
          Effect.provide(makeLayer({ baseDir, database: SqlitePersistence.layerMemory, deletes })),
        );
      }),
    ),
);

it.effect(
  "leaves no copy of the text in the database file or its WAL, streamed rewrites included",
  () =>
    withTempDir((baseDir) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const deletes = yield* Deferred.make<ThreadId>();
        const databasePath = `${baseDir}/state.sqlite`;
        const scratchFolder = `${baseDir}/scratch/2026-10-25-ephemeral`;
        yield* fileSystem.makeDirectory(scratchFolder, { recursive: true });
        yield* fileSystem.writeFileString(`${scratchFolder}/notes.txt`, MARKER);
        const ephemeral = ThreadId.make("thread:ephemeral-file");
        const kept = ThreadId.make("thread:kept-file");
        const markerCount = Effect.gen(function* () {
          let count = 0;
          for (const file of [databasePath, `${databasePath}-wal`]) {
            if (!(yield* fileSystem.exists(file))) continue;
            const bytes = Buffer.from(yield* fileSystem.readFile(file));
            let index = bytes.indexOf(MARKER);
            while (index !== -1) {
              count += 1;
              index = bytes.indexOf(MARKER, index + 1);
            }
          }
          return count;
        });

        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const projections = yield* ProjectionStore.ProjectionStoreV2;
          const threads = yield* EphemeralThreads.EphemeralThreads;
          yield* createScratchProject(`${baseDir}/scratch`);
          yield* projections.apply(
            threadCreated(ephemeral, { ephemeral: true, worktreePath: scratchFolder }),
          );
          yield* projections.apply(threadCreated(kept, { ephemeral: false }));
          // A streamed reply rewrites the same row and appends an event per update.
          let text = "";
          for (let step = 0; step < 40; step++) {
            text += ` ${MARKER}-${step} ${"x".repeat(120)}`;
            yield* projections.apply(messageUpdated(ephemeral, "message:ephemeral", text));
            yield* sql`
            INSERT INTO orchestration_events (
              event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
              actor_kind, payload_json, metadata_json, application_event_version
            ) VALUES (
              ${`event:ephemeral:${step}`}, 'thread', ${ephemeral}, ${step}, 'message.updated',
              ${DateTime.formatIso(at(1))}, 'provider', ${JSON.stringify({ text })}, '{}', 2
            )
          `;
            yield* projections.apply(
              messageUpdated(kept, `message:kept:${step}`, `kept ${"y".repeat(200)}`),
            );
          }
          yield* sql`PRAGMA wal_checkpoint(TRUNCATE)`;
          assert.isAbove(yield* markerCount, 0);

          assert.equal(yield* threads.purgeAtStartup, 1);

          assert.equal(yield* markerCount, 0);
          assert.isFalse(yield* fileSystem.exists(scratchFolder));
          assert.isNotNull(yield* projections.getThreadShell(kept));
        }).pipe(
          Effect.provide(
            makeLayer({
              baseDir,
              database: SqlitePersistence.layerFromPath(databasePath),
              deletes,
            }),
          ),
        );
      }),
    ),
);

it.effect("purges an ephemeral thread after an hour without a run or a message", () =>
  withTempDir((baseDir) =>
    Effect.gen(function* () {
      const deletes = yield* Deferred.make<ThreadId>();
      const threadId = ThreadId.make("thread:idle");
      yield* Effect.gen(function* () {
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const threads = yield* EphemeralThreads.EphemeralThreads;
        yield* createScratchProject(`${baseDir}/scratch`);
        const command: OrchestrationV2ServerCommand = {
          type: "thread.create",
          commandId: CommandId.make("create:idle"),
          threadId,
          projectId,
          title: "First line",
          modelSelection: localModel,
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdBy: "user",
          creationSource: "web",
          ephemeral: true,
        };
        const createdAt = yield* DateTime.now;
        yield* threads.dispatch(command, () =>
          projections
            .apply(threadCreated(threadId, { ephemeral: true, createdAt }))
            .pipe(Effect.as({ sequence: 1, storedEvents: [] }), Effect.orDie),
        );

        yield* TestClock.adjust("59 minutes");
        assert.isFalse(yield* Deferred.isDone(deletes));
        assert.isNotNull(yield* projections.getThreadShell(threadId));

        yield* TestClock.adjust("1 minute");
        assert.equal(yield* Deferred.await(deletes), threadId);
        // Joins the sweep's purge in flight and returns once it has finished.
        yield* threads.purge(threadId);
        assert.isNull(yield* projections.getThreadShell(threadId));
      }).pipe(
        Effect.provide(makeLayer({ baseDir, database: SqlitePersistence.layerMemory, deletes })),
      );
    }),
  ),
);

it.effect("refuses an ephemeral thread outside Scratch or on a hosted model", () =>
  withTempDir((baseDir) =>
    Effect.gen(function* () {
      const deletes = yield* Deferred.make<ThreadId>();
      yield* Effect.gen(function* () {
        const threads = yield* EphemeralThreads.EphemeralThreads;
        yield* createScratchProject(`${baseDir}/elsewhere`);
        const create = (model: string): OrchestrationV2ServerCommand => ({
          type: "thread.create",
          commandId: CommandId.make(`create:${model}`),
          threadId: ThreadId.make(`thread:${model}`),
          projectId,
          title: "First line",
          modelSelection: { instanceId: ompInstance, model },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdBy: "user",
          creationSource: "web",
          ephemeral: true,
        });
        const next = () => Effect.succeed({ sequence: 1, storedEvents: [] });
        const outside = yield* Effect.flip(threads.dispatch(create(localModel.model), next));
        assert.equal(outside._tag, "OrchestratorCommandRejectedError");
      }).pipe(
        Effect.provide(makeLayer({ baseDir, database: SqlitePersistence.layerMemory, deletes })),
      );
      yield* Effect.gen(function* () {
        const threads = yield* EphemeralThreads.EphemeralThreads;
        yield* createScratchProject(`${baseDir}/scratch`);
        const hosted = yield* Effect.flip(
          threads.dispatch(
            {
              type: "thread.create",
              commandId: CommandId.make("create:hosted"),
              threadId: ThreadId.make("thread:hosted"),
              projectId,
              title: "First line",
              modelSelection: { instanceId: ompInstance, model: "opencode-go/hosted" },
              runtimeMode: "approval-required",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              createdBy: "user",
              creationSource: "web",
              ephemeral: true,
            },
            () => Effect.succeed({ sequence: 1, storedEvents: [] }),
          ),
        );
        assert.equal(hosted._tag, "OrchestratorCommandRejectedError");
      }).pipe(
        Effect.provide(makeLayer({ baseDir, database: SqlitePersistence.layerMemory, deletes })),
      );
    }),
  ),
);

it.effect("lets the launch record an ephemeral thread's Scratch folder, never move it", () =>
  withTempDir((baseDir) =>
    Effect.gen(function* () {
      const deletes = yield* Deferred.make<ThreadId>();
      yield* Effect.gen(function* () {
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const threads = yield* EphemeralThreads.EphemeralThreads;
        yield* createScratchProject(`${baseDir}/scratch`);
        const launching = ThreadId.make("thread:launching");
        const settled = ThreadId.make("thread:settled");
        const ownFolder = `${baseDir}/scratch/2026-10-25-launching`;
        const settledFolder = `${baseDir}/scratch/2026-10-25-settled`;
        yield* projections.apply(threadCreated(launching, { ephemeral: true }));
        yield* projections.apply(
          threadCreated(settled, { ephemeral: true, worktreePath: settledFolder }),
        );
        const update = (
          threadId: ThreadId,
          worktreePath: string,
          branch: string | null = null,
        ): OrchestrationV2ServerCommand => ({
          type: "thread.metadata.update",
          commandId: CommandId.make(`update:${threadId}:${worktreePath}:${branch}`),
          threadId,
          branch,
          worktreePath,
        });
        const next = () => Effect.succeed({ sequence: 1, storedEvents: [] });
        const refusedTag = (command: OrchestrationV2ServerCommand) =>
          threads.dispatch(command, next).pipe(
            Effect.as("accepted"),
            Effect.catch((error) => Effect.succeed(error._tag)),
          );

        assert.equal(yield* refusedTag(update(launching, ownFolder)), "accepted");
        assert.equal(yield* refusedTag(update(settled, settledFolder)), "accepted");
        assert.equal(
          yield* refusedTag(update(launching, `${baseDir}/elsewhere`)),
          "OrchestratorCommandRejectedError",
        );
        assert.equal(
          yield* refusedTag(update(settled, ownFolder)),
          "OrchestratorCommandRejectedError",
        );
        assert.equal(
          yield* refusedTag(update(launching, ownFolder, "feature")),
          "OrchestratorCommandRejectedError",
        );
      }).pipe(
        Effect.provide(makeLayer({ baseDir, database: SqlitePersistence.layerMemory, deletes })),
      );
    }),
  ),
);

it.effect("MCP lists, reads and searches never show an ephemeral thread", () =>
  withTempDir((baseDir) =>
    Effect.gen(function* () {
      const deletes = yield* Deferred.make<ThreadId>();
      const ephemeral = ThreadId.make("thread:hidden");
      const visible = ThreadId.make("thread:visible");
      const shell = (threadId: ThreadId, isEphemeral: boolean) =>
        ({
          id: threadId,
          projectId,
          deletedAt: null,
          ...(isEphemeral ? { ephemeral: true } : {}),
        }) as unknown as OrchestrationV2ThreadShell;
      const base = Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (threadId) =>
          Effect.succeed(
            threadId === ephemeral || threadId === visible
              ? shell(threadId, threadId === ephemeral)
              : null,
          ),
        listProjectThreads: () => Effect.succeed([shell(ephemeral, true), shell(visible, false)]),
        getShellSnapshot: () =>
          Effect.succeed({
            schemaVersion: 1,
            snapshotSequence: 1,
            threads: [shell(ephemeral, true), shell(visible, false)],
            archivedThreads: [],
          }),
        getThreadRecords: () =>
          Effect.succeed({
            thread: shell(visible, false),
          } as unknown as OrchestrationV2ThreadProjection),
        dispatch: () => Effect.succeed({ sequence: 1, storedEvents: [] }),
      });
      yield* Effect.gen(function* () {
        const threads = yield* ThreadManagement.ThreadManagementService;
        assert.deepEqual(
          (yield* threads.listProjectThreads({ projectId, includeSubagents: true })).map(
            (thread) => thread.id,
          ),
          [visible],
        );
        assert.deepEqual(
          (yield* threads.getShellSnapshot()).threads.map((thread) => thread.id),
          [visible],
        );
        assert.isNull(yield* threads.getThreadShell(ephemeral));
        const read = yield* Effect.flip(threads.getThreadRecords(ephemeral, []));
        assert.equal(read._tag, "OrchestratorProjectionError");
        const send = yield* Effect.flip(
          threads.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("mcp:send"),
            threadId: ephemeral,
            messageId: MessageId.make("mcp:send:message"),
            text: "hello",
            attachments: [],
            dispatchMode: { type: "defer_start" },
            createdBy: "agent",
            creationSource: "mcp",
          }),
        );
        assert.equal(send._tag, "OrchestratorCommandRejectedError");
        assert.isNotNull(yield* threads.getThreadShell(visible));
      }).pipe(Effect.provide(HideEphemeralThreads.layer.pipe(Layer.provide(base))));

      // Thread search backs the MCP search tool.
      yield* Effect.gen(function* () {
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const search = yield* ThreadSearch.ThreadSearch;
        yield* createScratchProject(`${baseDir}/scratch`);
        yield* projections.apply(threadCreated(ephemeral, { ephemeral: true }));
        yield* projections.apply(threadCreated(visible, { ephemeral: false }));
        yield* projections.apply(messageUpdated(ephemeral, "message:hidden", "needle in private"));
        yield* projections.apply(messageUpdated(visible, "message:visible", "needle in public"));
        assert.deepEqual(
          (yield* search.search({ query: "needle", limit: 10 })).matches.map(
            (match) => match.threadId,
          ),
          [visible],
        );
      }).pipe(
        Effect.provide(makeLayer({ baseDir, database: SqlitePersistence.layerMemory, deletes })),
      );
    }),
  ),
);
