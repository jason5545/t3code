/**
 * Fork patch 20: archive carries the threads this one launched (`launchedByThreadId`) and its
 * subagents, unless still working; children take the parent's archive time, so unarchive can
 * restore exactly those. Each child's own archive queues the next level.
 */
import { CommandId, type OrchestrationV2RunStatus, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ThreadManagement from "./ThreadManagementService.ts";

export class ChildThreadArchiveError extends Schema.TaggedError<ChildThreadArchiveError>()(
  "ChildThreadArchiveError",
  {
    threadId: ThreadId,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not carry the archive state of ${this.threadId} to its child threads.`;
  }
}

interface CascadeInput {
  readonly threadId: ThreadId;
  readonly commandId: CommandId;
  readonly archivedAt: DateTime.Utc;
}

export class ChildThreadArchive extends Context.Service<
  ChildThreadArchive,
  {
    readonly archive: (input: CascadeInput) => Effect.Effect<void, ChildThreadArchiveError>;
    readonly unarchive: (input: CascadeInput) => Effect.Effect<void, ChildThreadArchiveError>;
  }
>()("t3/orchestration-v2/ChildThreadArchive") {}

const WORKING_RUN_STATUSES: ReadonlySet<OrchestrationV2RunStatus> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threads = yield* ThreadManagement.ThreadManagementService;

  // ProjectionStore's shape is mirrored by upstream tests, so this read lives here.
  const childThreads = (threadId: ThreadId) =>
    sql<{ readonly thread_id: string; readonly archived_at: string | null }>`
      SELECT thread_id, json_extract(payload_json, '$.archivedAt') AS archived_at
      FROM orchestration_v2_projection_threads
      WHERE deleted_at IS NULL
        AND (
          json_extract(payload_json, '$.launchedByThreadId') = ${threadId}
          OR (
            json_extract(payload_json, '$.lineage.parentThreadId') = ${threadId}
            AND json_extract(payload_json, '$.lineage.relationshipToParent') = 'subagent'
          )
        )
      ORDER BY thread_id
    `.pipe(Effect.mapError((cause) => new ChildThreadArchiveError({ threadId, cause })));

  const cascade = Effect.fn("ChildThreadArchive.cascade")(function* <E>(
    input: CascadeInput,
    operation: "archive" | "unarchive",
    child: (row: {
      readonly threadId: ThreadId;
      readonly archivedAt: string | null;
    }) => Effect.Effect<boolean, E>,
  ) {
    const failures: Array<unknown> = [];
    for (const row of yield* childThreads(input.threadId)) {
      const threadId = ThreadId.make(row.thread_id);
      yield* child({ threadId, archivedAt: row.archived_at }).pipe(
        Effect.flatMap((applies) =>
          applies
            ? threads.dispatch(
                operation === "archive"
                  ? {
                      type: "thread.archive",
                      commandId: CommandId.make(`${input.commandId}:archive-child:${threadId}`),
                      threadId,
                      archivedAt: input.archivedAt,
                    }
                  : {
                      type: "thread.unarchive",
                      commandId: CommandId.make(`${input.commandId}:unarchive-child:${threadId}`),
                      threadId,
                    },
              )
            : Effect.void,
        ),
        Effect.catch((cause) =>
          Effect.logWarning(`Unable to ${operation} a child thread`, {
            parentThreadId: input.threadId,
            threadId,
            cause,
          }).pipe(Effect.andThen(Effect.sync(() => failures.push(cause)))),
        ),
      );
    }
    if (failures.length > 0) {
      return yield* new ChildThreadArchiveError({
        threadId: input.threadId,
        cause: failures[0],
      });
    }
  });

  const archive = Effect.fn("ChildThreadArchive.archive")(function* (input: CascadeInput) {
    yield* cascade(input, "archive", (row) =>
      row.archivedAt !== null
        ? Effect.succeed(false)
        : threads
            .getThreadRecords(row.threadId, ["runs"])
            .pipe(
              Effect.map(({ runs }) => !runs.some((run) => WORKING_RUN_STATUSES.has(run.status))),
            ),
    );
  });

  const unarchive = Effect.fn("ChildThreadArchive.unarchive")(function* (input: CascadeInput) {
    const parentArchivedAt = DateTime.toEpochMillis(input.archivedAt);
    yield* cascade(input, "unarchive", (row) =>
      Effect.succeed(row.archivedAt !== null && Date.parse(row.archivedAt) === parentArchivedAt),
    );
  });

  return ChildThreadArchive.of({ archive, unarchive });
});

export const layer = Layer.effect(ChildThreadArchive, make);
