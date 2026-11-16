import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ExtensionHostApi from "./ExtensionHostApi.ts";

const projectId = ProjectId.make("project:board");
const threadId = ThreadId.make("thread:board");
const runId = RunId.make("run:board");
const messageId = MessageId.make("message:board");
const nodeId = NodeId.make("node:board");
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-6",
  options: [{ id: "reasoningEffort", value: "xhigh" }],
};
const at = (second: number) => DateTime.makeUnsafe(Date.UTC(2026, 10, 16, 4, 0, second));

const item = (
  ordinal: number,
  fields: Record<string, unknown> & { readonly type: string; readonly status: string },
): OrchestrationV2DomainEvent =>
  ({
    id: EventId.make(`item:${ordinal}`),
    type: "turn-item.updated",
    threadId,
    runId,
    occurredAt: at(ordinal),
    payload: {
      id: TurnItemId.make(`item:${ordinal}`),
      threadId,
      runId,
      nodeId,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal,
      title: null,
      startedAt: at(ordinal),
      completedAt: null,
      updatedAt: at(ordinal),
      ...fields,
    },
  }) as OrchestrationV2DomainEvent;

const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
  {
    id: EventId.make("thread"),
    type: "thread.created",
    threadId,
    occurredAt: at(0),
    payload: {
      id: threadId,
      projectId,
      title: "Sync upstream",
      providerInstanceId,
      modelSelection,
      createdBy: "user",
      creationSource: "web",
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: at(0),
      updatedAt: at(0),
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  },
  {
    id: EventId.make("run"),
    type: "run.created",
    threadId,
    occurredAt: at(1),
    payload: {
      id: runId,
      threadId,
      ordinal: 1,
      providerInstanceId,
      modelSelection,
      providerThreadId: null,
      userMessageId: messageId,
      rootNodeId: nodeId,
      activeAttemptId: null,
      status: "running",
      requestedAt: at(1),
      startedAt: at(1),
      completedAt: null,
      checkpointId: null,
      contextHandoffId: null,
    },
  },
  {
    id: EventId.make("message"),
    type: "message.updated",
    threadId,
    occurredAt: at(1),
    payload: {
      id: messageId,
      threadId,
      runId,
      nodeId,
      role: "user",
      text: "CLEARED FOR TAKEOFF",
      attachments: [],
      streaming: false,
      createdBy: "user",
      creationSource: "web",
      createdAt: at(1),
      updatedAt: at(1),
    },
  },
  item(2, {
    type: "command_execution",
    status: "completed",
    input: "git commit -m sync",
    output: "x".repeat(100_000),
  }),
  item(3, { type: "reasoning", status: "completed", text: "thinking", streaming: false }),
  item(4, { type: "file_change", status: "completed", fileName: "README.md" }),
  item(5, {
    type: "dynamic_tool",
    status: "completed",
    toolName: "t3_thread_send",
    input: { message: "y".repeat(5000), threadId: "thread:parent" },
  }),
  item(6, { type: "command_execution", status: "running", input: "vp test run" }),
];

const layer = ExtensionHostApi.layer.pipe(
  Layer.provideMerge(ProjectStore.layer),
  Layer.provideMerge(ProjectionStore.layer),
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

const seed = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  yield* projects.apply({
    sequence: 0,
    eventId: EventId.make("project"),
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
      title: "t3code",
      workspaceRoot: "/work/t3code",
      defaultModelSelection: null,
      scripts: [],
      createdAt: DateTime.formatIso(at(0)),
      updatedAt: DateTime.formatIso(at(0)),
    },
  });
  yield* Effect.forEach(events, (event) => projections.apply(event), { discard: true });
  return (yield* ExtensionHostApi.ExtensionHostApi).installed;
});

it.effect("reads a run's tool steps without their output, and only what came next", () =>
  Effect.gen(function* () {
    const t3 = yield* seed;
    const activity = yield* Effect.promise(() => t3.runs.activity(threadId));
    assert.deepStrictEqual(activity.run, {
      id: runId,
      ordinal: 1,
      status: "running",
      requestedAt: DateTime.formatIso(at(1)),
      startedAt: DateTime.formatIso(at(1)),
      completedAt: null,
      trigger: { text: "CLEARED FOR TAKEOFF", createdBy: "user" },
    });
    assert.deepStrictEqual(
      activity.items.map(({ ordinal, type, command, file, tool }) => ({
        ordinal,
        type,
        command,
        file,
        tool,
      })),
      [
        {
          ordinal: 2,
          type: "command_execution",
          command: "git commit -m sync",
          file: undefined,
          tool: undefined,
        },
        { ordinal: 4, type: "file_change", command: undefined, file: "README.md", tool: undefined },
        {
          ordinal: 5,
          type: "dynamic_tool",
          command: undefined,
          file: undefined,
          tool: {
            name: "t3_thread_send",
            input: { message: "y".repeat(1000), threadId: "thread:parent" },
          },
        },
        {
          ordinal: 6,
          type: "command_execution",
          command: "vp test run",
          file: undefined,
          tool: undefined,
        },
      ],
    );
    assert.isBelow(JSON.stringify(activity).length, 5000);
    assert.equal(activity.current?.ordinal, 6);
    assert.equal(activity.lastActivityAt, DateTime.formatIso(at(6)));
    assert.equal(activity.lastOrdinal, 6);
    assert.isFalse(activity.hasMore);

    const next = yield* Effect.promise(() => t3.runs.activity(threadId, { afterOrdinal: 4 }));
    assert.deepStrictEqual(
      next.items.map(({ ordinal }) => ordinal),
      [5, 6],
    );
    const none = yield* Effect.promise(() => t3.runs.activity(threadId, { afterOrdinal: 6 }));
    assert.deepStrictEqual(none.items, []);
    assert.equal(none.lastOrdinal, 6);
  }).pipe(Effect.provide(layer)),
);

it.effect("summarizes a thread with its project, and answers null for an unknown one", () =>
  Effect.gen(function* () {
    const t3 = yield* seed;
    assert.equal(t3.apiVersion, 3);
    const summary = yield* Effect.promise(() => t3.threads.get(threadId));
    assert.include(summary, {
      id: threadId,
      title: "Sync upstream",
      projectTitle: "t3code",
      projectRoot: "/work/t3code",
      model: "gpt-6",
      effort: "xhigh",
      branch: "main",
      environmentId: null,
    });
    assert.isNull(yield* Effect.promise(() => t3.threads.get("thread:missing")));
    const empty = yield* Effect.promise(() => t3.runs.activity("thread:missing"));
    assert.isNull(empty.run);
    assert.deepStrictEqual(empty.items, []);
  }).pipe(Effect.provide(layer)),
);
