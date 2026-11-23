import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  EXTENSION_API_VERSION,
  readReplyQuery,
  summarizeThreadShell,
  type ExtensionActivityItem,
  type ExtensionReply,
  type ExtensionRunActivity,
  type ExtensionThreadSummary,
} from "@t3tools/shared/extensionApi";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

/**
 * Fork patch 30: the read-only `t3` an installed server part's call receives as `context.t3`.
 * Activity and replies are indexed queries that extract only what they return, so a board
 * polling a long run never loads command output. Web reads replies through hostReads.ts.
 */
const ACTIVITY_TYPES = ["command_execution", "file_change", "dynamic_tool"] as const;
const MAX_ITEMS = 500;
// Commands stay whole for parsing (the longest on record is 38 KB); tool input is only peeked at.
const COMMAND_CHARS = 64 * 1024;
const REASONING_CHARS = 32 * 1024;
const TOOL_STRING_CHARS = 1000;
const TOOL_INPUT_BYTES = 256 * 1024;

export interface InstalledHostApi {
  readonly apiVersion: number;
  readonly threads: {
    readonly get: (threadId: string) => Promise<ExtensionThreadSummary | null>;
    /**
     * Since API 4: each thread's newest finished assistant message, first 600 characters unless
     * `chars` asks for up to 100,000; threads without one are left out. At most 200 ids.
     */
    readonly latestReplies: (
      threadIds: ReadonlyArray<string>,
      options?: { readonly chars?: number },
    ) => Promise<ReadonlyArray<ExtensionReply>>;
  };
  readonly runs: {
    /** The thread's latest run, or `runId`, with its tool steps after `afterOrdinal`. */
    readonly activity: (
      threadId: string,
      options?: { readonly runId?: string; readonly afterOrdinal?: number },
    ) => Promise<ExtensionRunActivity>;
  };
}

export class ExtensionHostApi extends Context.Service<
  ExtensionHostApi,
  {
    readonly installed: InstalledHostApi;
    /** `installed.threads.latestReplies` for built-in calls; input as JSON gave it. */
    readonly latestReplies: (
      threadIds: unknown,
      options?: unknown,
    ) => Effect.Effect<ReadonlyArray<ExtensionReply>, ExtensionReadError>;
  }
>()("t3/extensions/ExtensionHostApi") {}

/** A read the host API could not answer: bad input, or the database failed. */
export class ExtensionReadError extends Schema.TaggedError<ExtensionReadError>()(
  "ExtensionReadError",
  { message: Schema.String },
) {}

const readError = (cause: unknown) =>
  new ExtensionReadError({
    message: cause instanceof Error && cause.message !== "" ? cause.message : String(cause),
  });

interface ReplyRow {
  readonly threadId: string;
  readonly messageId: string;
  readonly runId: string | null;
  readonly text: string | null;
  readonly length: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RunRow {
  readonly runId: string;
  readonly ordinal: number;
  readonly status: string;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly startedAt: string | null;
  readonly userMessageId: string | null;
}

interface ItemRow {
  readonly ordinal: number;
  readonly type: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly title: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly command: string | null;
  readonly file: string | null;
  readonly toolName: string | null;
  readonly toolInput: string | null;
  readonly reasoningText: string | null;
  readonly reasoningStreaming: number | boolean | null;
}

/** Tool input with long strings cut, so ids and short fields stay whole and payloads stay small. */
const shortenStrings = (value: unknown): unknown => {
  if (typeof value === "string") return value.slice(0, TOOL_STRING_CHARS);
  if (Array.isArray(value)) return value.map(shortenStrings);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, shortenStrings(inner)]),
    );
  }
  return value;
};

const parseToolInput = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return shortenStrings(JSON.parse(text));
  } catch {
    return null;
  }
};

const toItem = (row: ItemRow): ExtensionActivityItem => ({
  ordinal: row.ordinal,
  type: row.type,
  status: row.status,
  title: row.title,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
  updatedAt: row.updatedAt,
  ...(row.type === "command_execution" ? { command: row.command ?? "" } : {}),
  ...(row.type === "file_change" && row.file !== null ? { file: row.file } : {}),
  ...(row.type === "dynamic_tool"
    ? { tool: { name: row.toolName, input: parseToolInput(row.toolInput) } }
    : {}),
  ...(row.type === "reasoning"
    ? {
        text: row.reasoningText ?? "",
        streaming: row.reasoningStreaming === 1 || row.reasoningStreaming === true,
      }
    : {}),
});

const asError = (cause: unknown) =>
  new Error(cause instanceof Error && cause.message !== "" ? cause.message : String(cause));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;

  const itemColumns = sql`
    ordinal,
    type,
    status,
    updated_at AS "updatedAt",
    json_extract(payload_json, '$.title') AS "title",
    json_extract(payload_json, '$.startedAt') AS "startedAt",
    json_extract(payload_json, '$.completedAt') AS "completedAt",
    CASE WHEN type = 'command_execution'
      THEN substr(json_extract(payload_json, '$.input'), 1, ${COMMAND_CHARS}) END AS "command",
    CASE WHEN type = 'file_change' THEN json_extract(payload_json, '$.fileName') END AS "file",
    CASE WHEN type = 'dynamic_tool' THEN json_extract(payload_json, '$.toolName') END AS "toolName",
    CASE WHEN type = 'dynamic_tool' AND length(payload_json) <= ${TOOL_INPUT_BYTES}
      THEN payload_json -> '$.input' END AS "toolInput",
    CASE WHEN type = 'reasoning'
      THEN substr(json_extract(payload_json, '$.text'), 1, ${REASONING_CHARS}) END AS "reasoningText",
    CASE WHEN type = 'reasoning'
      THEN json_extract(payload_json, '$.streaming') END AS "reasoningStreaming"`;

  const getThread = Effect.fn("ExtensionHostApi.threadsGet")(function* (threadId: string) {
    const shell = yield* projections.getThreadShell(ThreadId.make(threadId));
    if (shell === null || shell.deletedAt !== null) return null;
    const project = yield* projects
      .getShell(ProjectId.make(shell.projectId))
      .pipe(Effect.orElseSucceed(() => Option.none()));
    return summarizeThreadShell(
      shell,
      null,
      Option.match(project, {
        onNone: () => null,
        onSome: ({ title, workspaceRoot }) => ({ title, workspaceRoot }),
      }),
    );
  });

  const runActivity = Effect.fn("ExtensionHostApi.runsActivity")(function* (
    threadId: string,
    options: { readonly runId?: string; readonly afterOrdinal?: number } | undefined,
  ) {
    const after = Number.isInteger(options?.afterOrdinal) ? (options?.afterOrdinal ?? -1) : -1;
    const runs = yield* sql<RunRow>`
      SELECT
        run_id AS "runId",
        ordinal,
        status,
        requested_at AS "requestedAt",
        completed_at AS "completedAt",
        json_extract(payload_json, '$.startedAt') AS "startedAt",
        json_extract(payload_json, '$.userMessageId') AS "userMessageId"
      FROM orchestration_v2_projection_runs
      WHERE ${sql.and([
        sql`thread_id = ${threadId}`,
        ...(typeof options?.runId === "string" ? [sql`run_id = ${options.runId}`] : []),
      ])}
      ORDER BY ordinal DESC
      LIMIT 1`;
    const run = runs[0];
    if (run === undefined) {
      return {
        run: null,
        lastActivityAt: null,
        current: null,
        items: [],
        lastOrdinal: -1,
        hasMore: false,
      } satisfies ExtensionRunActivity;
    }
    const trigger =
      run.userMessageId === null
        ? []
        : yield* sql<{ readonly text: string | null; readonly createdBy: string | null }>`
            SELECT
              json_extract(payload_json, '$.text') AS "text",
              json_extract(payload_json, '$.createdBy') AS "createdBy"
            FROM orchestration_v2_projection_messages
            WHERE message_id = ${run.userMessageId}`;
    const latest = yield* sql<{ readonly lastActivityAt: string | null }>`
      SELECT MAX(updated_at) AS "lastActivityAt"
      FROM orchestration_v2_projection_turn_items
      WHERE run_id = ${run.runId}`;
    const current = yield* sql<ItemRow>`
      SELECT ${itemColumns}
      FROM orchestration_v2_projection_turn_items
      WHERE run_id = ${run.runId} AND status IN ('pending', 'running', 'waiting')
      ORDER BY ordinal DESC
      LIMIT 1`;
    const rows = yield* sql<ItemRow>`
      SELECT ${itemColumns}
      FROM orchestration_v2_projection_turn_items
      WHERE run_id = ${run.runId} AND ordinal > ${after} AND ${sql.in("type", ACTIVITY_TYPES)}
      ORDER BY ordinal
      LIMIT ${MAX_ITEMS + 1}`;
    const items = rows.slice(0, MAX_ITEMS).map(toItem);
    return {
      run: {
        id: run.runId,
        ordinal: run.ordinal,
        status: run.status,
        requestedAt: run.requestedAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        trigger:
          trigger[0] === undefined
            ? null
            : { text: trigger[0].text ?? "", createdBy: trigger[0].createdBy },
      },
      lastActivityAt: latest[0]?.lastActivityAt ?? null,
      current: current[0] === undefined ? null : toItem(current[0]),
      items,
      lastOrdinal: items.at(-1)?.ordinal ?? after,
      hasMore: rows.length > MAX_ITEMS,
    } satisfies ExtensionRunActivity;
  });

  // The newest finished assistant message of each thread, ranked through the thread index.
  const latestReplies = Effect.fn("ExtensionHostApi.latestReplies")(function* (
    threadIdsInput: unknown,
    options: unknown,
  ) {
    const query = yield* Effect.try({
      try: () => readReplyQuery(threadIdsInput, options),
      catch: readError,
    });
    if (query.threadIds.length === 0) return [];
    const rows = yield* sql<ReplyRow>`
      SELECT
        m.thread_id AS "threadId",
        m.message_id AS "messageId",
        m.run_id AS "runId",
        substr(json_extract(m.payload_json, '$.text'), 1, ${query.chars}) AS "text",
        length(json_extract(m.payload_json, '$.text')) AS "length",
        m.created_at AS "createdAt",
        m.updated_at AS "updatedAt"
      FROM (
        SELECT
          message_id,
          ROW_NUMBER() OVER (
            PARTITION BY thread_id ORDER BY created_at DESC, message_id DESC
          ) AS rank
        FROM orchestration_v2_projection_messages
        WHERE ${sql.in("thread_id", query.threadIds)} AND role = 'assistant' AND streaming = 0
      ) AS latest
      JOIN orchestration_v2_projection_messages AS m ON m.message_id = latest.message_id
      WHERE latest.rank = 1`.pipe(Effect.mapError(readError));
    const byThread = new Map(rows.map((row) => [row.threadId, row]));
    return query.threadIds.flatMap((threadId): Array<ExtensionReply> => {
      const row = byThread.get(threadId);
      if (row === undefined) return [];
      const length = row.length ?? 0;
      return [
        {
          threadId,
          messageId: row.messageId,
          runId: row.runId,
          text: row.text ?? "",
          length,
          truncated: length > query.chars,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
      ];
    });
  });

  const services = yield* Effect.context<never>();
  const run = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.runPromiseWith(services)(effect.pipe(Effect.mapError(asError)));

  const installed: InstalledHostApi = {
    apiVersion: EXTENSION_API_VERSION,
    threads: {
      get: (threadId) => {
        if (typeof threadId !== "string")
          return Promise.reject(new TypeError("threads.get takes a thread id."));
        return run(getThread(threadId));
      },
      latestReplies: (threadIds, options) => run(latestReplies(threadIds, options)),
    },
    runs: {
      activity: (threadId, options) => {
        if (typeof threadId !== "string")
          return Promise.reject(new TypeError("runs.activity takes a thread id."));
        return run(runActivity(threadId, options));
      },
    },
  };
  return ExtensionHostApi.of({ installed: Object.freeze(installed), latestReplies });
});

export const layer = Layer.effect(ExtensionHostApi, make).pipe(Layer.provide(ProjectStore.layer));
