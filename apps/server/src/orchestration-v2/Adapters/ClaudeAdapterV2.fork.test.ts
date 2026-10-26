import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ClaudeSettings,
  MessageId,
  type ModelSelection,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { vi } from "vite-plus/test";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ClaudeAdapterV2 from "./ClaudeAdapterV2.ts";

// Harness is a trimmed copy of makeWakeHarness in ClaudeAdapterV2.test.ts.
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof ClaudeSdk>()),
  resolveSettings: vi.fn(async () => ({ effective: {}, provenance: {}, sources: [] })),
}));

const NATIVE_SESSION = "native-thread-claude-summary";
const MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make(ClaudeAdapterV2.CLAUDE_PROVIDER),
  model: "claude-opus-5-5",
} satisfies ModelSelection;
const CLAUDE_SETTINGS = Schema.decodeSync(ClaudeSettings)({});
const RUNTIME_POLICY = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
  runtimeMode: "full-access",
  interactionMode: "default",
  cwd: "/workspace",
});

const frame = (value: Record<string, unknown>) => value as unknown as SDKMessage;
const assistantSnapshot = (uuid: string, messageId: string, content: ReadonlyArray<unknown>) =>
  frame({
    type: "assistant",
    uuid,
    session_id: NATIVE_SESSION,
    parent_tool_use_id: null,
    message: { id: messageId, model: MODEL_SELECTION.model, content },
  });
const resultFrame = frame({
  type: "result",
  subtype: "success",
  duration_ms: 10,
  duration_api_ms: 10,
  is_error: false,
  num_turns: 1,
  result: "",
  stop_reason: "end_turn",
  total_cost_usd: 0,
  usage: {
    input_tokens: 1,
    output_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  modelUsage: {},
  permission_denials: [],
  uuid: "summary-result",
  session_id: NATIVE_SESSION,
});

const makeHarness = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const sdkMessages = yield* Queue.unbounded<SDKMessage>();
  const adapter = yield* ClaudeAdapterV2.makeClaudeAdapterV2({
    instanceId: ClaudeAdapterV2.CLAUDE_DEFAULT_INSTANCE_ID,
    settings: CLAUDE_SETTINGS,
    environment: {},
    attachmentsDir: yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-claude-fork-" }),
    fileSystem,
    path: yield* Path.Path,
    crypto: yield* Crypto.Crypto,
    idAllocator: yield* IdAllocator.IdAllocatorV2,
    continuationRequests: { offer: () => Effect.void },
    queryRunner: {
      allocateSessionId: Effect.succeed(NATIVE_SESSION),
      open: () =>
        Effect.succeed({
          messages: Stream.fromQueue(sdkMessages),
          offer: () => Effect.void,
          setModel: () => Effect.void,
          applyFlagSettings: () => Effect.void,
          setPermissionMode: () => Effect.void,
          backgroundTasks: () => Effect.succeed(false),
          stopTask: () => Effect.void,
          interrupt: Effect.void,
          close: Effect.void,
        }),
      forkSession: () => Effect.die("unused forkSession"),
      subagentLaunchToolUseId: () => Effect.succeed(null),
      assertComplete: Effect.void,
    },
  });
  const threadId = ThreadId.make("thread-claude-summary");
  const runtime = yield* adapter.openSession({
    threadId,
    providerSessionId: ProviderSessionId.make("provider-session-claude-summary"),
    modelSelection: MODEL_SELECTION,
    runtimePolicy: RUNTIME_POLICY,
  });
  const providerThread = yield* runtime.ensureThread({
    threadId,
    modelSelection: MODEL_SELECTION,
    runtimePolicy: RUNTIME_POLICY,
  });
  const events: Array<ProviderAdapter.ProviderAdapterV2Event> = [];
  const terminals = yield* Queue.unbounded<void>();
  yield* runtime.events.pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        events.push(event);
        if (event.type === "turn.terminal") yield* Queue.offer(terminals, undefined);
      }),
    ),
    Effect.forkScoped,
  );
  const now = yield* DateTime.now;
  const attemptId = RunAttemptId.make("summary-attempt");
  yield* runtime.startTurn({
    appThread: {
      createdBy: "user",
      creationSource: "web",
      id: threadId,
      projectId: ProjectId.make(`project-${threadId}`),
      title: "Claude summary test",
      providerInstanceId: MODEL_SELECTION.instanceId,
      modelSelection: MODEL_SELECTION,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: providerThread.id,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    threadId,
    runId: RunId.make(`run-${attemptId}`),
    runOrdinal: 1,
    providerTurnOrdinal: 1,
    attemptId,
    rootNodeId: NodeId.make(`node-${attemptId}`),
    providerThread,
    message: {
      createdBy: "user",
      creationSource: "web",
      messageId: MessageId.make(`message-${attemptId}`),
      text: "Check the memory file",
      attachments: [],
    },
    modelSelection: MODEL_SELECTION,
    runtimePolicy: RUNTIME_POLICY,
  });
  return { events, sdkMessages, terminals };
});

describe("ClaudeAdapterV2 summarized updates (fork)", () => {
  it.effect("marks a progress update promoted from summarized thinking", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const frames = [
        assistantSnapshot("thinking-0", "update-message", [
          { type: "thinking", thinking: "Planning the check", signature: "sig" },
        ]),
        assistantSnapshot("thinking-1", "update-message", [
          {
            type: "thinking",
            thinking: "Found it: the memory file is the cause.",
            signature: "sig",
          },
        ]),
        assistantSnapshot("tool", "update-message", [
          { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "ls" } },
        ]),
        assistantSnapshot("reply", "reply-message", [{ type: "text", text: "Fixed it." }]),
        resultFrame,
      ];
      for (const message of frames) yield* Queue.offer(harness.sdkMessages, message);
      yield* Queue.take(harness.terminals);

      const latest = new Map(
        harness.events.flatMap((event) =>
          event.type === "turn_item.updated" && event.turnItem.type === "assistant_message"
            ? [[event.turnItem.id, event.turnItem] as const]
            : [],
        ),
      );
      assert.deepEqual(
        [...latest.values()].map((item) =>
          item.type === "assistant_message" ? [item.text, item.summarized ?? false] : [],
        ),
        [
          ["Found it: the memory file is the cause.", true],
          ["Fixed it.", false],
        ],
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(IdAllocator.layer, McpProviderSessions.layer, NodeServices.layer),
      ),
    ),
  );
});
