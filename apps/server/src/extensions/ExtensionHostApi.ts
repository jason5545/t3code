import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  EXTENSION_API_VERSION,
  summarizeThreadShell,
  type ExtensionActivityItem,
  type ExtensionRunActivity,
  type ExtensionThreadSummary,
} from "@t3tools/shared/extensionApi";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

/**
 * Fork patch 30: the read-only `t3` an installed server part's call receives as `context.t3`.
 * Run activity is read with one indexed query that extracts only the fields it returns, so a
 * board polling a long run never loads its command output; the rest is upstream's stores.
 */
const ACTIVITY_TYPES = ["command_execution", "file_change", "dynamic_tool"] as const;
const MAX_ITEMS = 500;
// Commands stay whole for parsing (the longest on record is 38 KB); tool input is only peeked at.
const COMMAND_CHARS = 64 * 1024;
const TOOL_STRING_CHARS = 1000;
const TOOL_INPUT_BYTES = 256 * 1024;

export interface InstalledHostApi {
  readonly apiVersion: number;
  readonly threads: {
    readonly get: (threadId: string) => Promise<ExtensionThreadSummary | null>;
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
  { readonly installed: InstalledHostApi }
>()("t3/extensions/ExtensionHostApi") {}

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
      THEN payload_json -> '$.input' END AS "toolInput"`;

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
    },
    runs: {
      activity: (threadId, options) => {
        if (typeof threadId !== "string")
          return Promise.reject(new TypeError("runs.activity takes a thread id."));
        return run(runActivity(threadId, options));
      },
    },
  };
  return ExtensionHostApi.of({ installed: Object.freeze(installed) });
});

export const layer = Layer.effect(ExtensionHostApi, make).pipe(Layer.provide(ProjectStore.layer));
