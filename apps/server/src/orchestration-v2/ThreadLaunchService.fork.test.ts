import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it, vi } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EphemeralThreads from "./EphemeralThreads.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadLaunch from "./ThreadLaunchService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const projectId = ProjectId.make("project:scratch-launch");
const ompInstance = ProviderInstanceId.make("omp");
const localModel = { instanceId: ompInstance, model: "omlx/local-model" } as const;

const ompAdapter = {
  instanceId: ompInstance,
  driver: ProviderDriverKind.make("pi"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("provider execution is disabled in launch tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const fakeInstance = {
  instanceId: ompInstance,
  driverKind: "pi",
  snapshot: {
    getSnapshot: Effect.succeed({
      models: [
        { slug: localModel.model, name: "local", isCustom: false, local: true, capabilities: null },
      ],
    }),
  },
} as unknown as ProviderInstance;

function makeHarness(scratchRoot: string, baseDir: string) {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
    { name: "ephemeral-launch" },
    ProviderAdapterRegistry.layerFromAdapters([ompAdapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  );
  const layerSettings = ServerSettings.layerTest({
    providerInstances: {
      [ompInstance]: { driver: "pi", enabled: true, config: { binaryPath: "omp" } },
    },
  });
  const layerReceipts = CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase));
  const layerStores = Layer.mergeAll(
    ProjectionStore.layer,
    ProjectStore.layer,
    EffectOutbox.layer,
  ).pipe(Layer.provideMerge(layerDatabase));
  const layerEphemeral = EphemeralThreads.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerOrchestrator,
        layerStores,
        layerSettings,
        Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
          getInstance: (instanceId) =>
            Effect.succeed(instanceId === ompInstance ? fakeInstance : undefined),
        }),
        ServerConfig.layerTest(baseDir, baseDir),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
  const layerThreadManagement = ThreadManagement.layer.pipe(
    Layer.provide(layerOrchestrator),
    Layer.provide(layerSettings),
    Layer.provide(layerReceipts),
    Layer.provide(layerEphemeral),
  );
  const generateThreadTitle = vi.fn(() => Effect.succeed({ title: "Generated title" }));
  const folderTexts: Array<string> = [];
  const project = {
    id: projectId,
    title: "No project",
    workspaceRoot: scratchRoot,
    repositoryIdentity: null,
    faviconPath: null,
    defaultModelSelection: localModel,
    defaultThreadEnvMode: null,
    scripts: [],
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
    deletedAt: null,
  } as const;
  const layerExternal = Layer.mergeAll(
    WorktreeSetupTracker.layer,
    Layer.mock(ProjectCloneTracker.ProjectCloneTracker)({ get: () => Effect.succeed(null) }),
    Layer.mock(TerminalManager.TerminalManager)({ close: () => Effect.void }),
    Layer.mock(ProjectService.ProjectService)({
      getById: (id) => Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
    }),
    Layer.mock(GitWorkflow.GitWorkflowService)({}),
    Layer.succeed(ProjectSetupScriptRunner.ProjectSetupScriptRunner, {
      runForThread: () => Effect.succeed({ status: "no-script" as const }),
    }),
    Layer.mock(TextGeneration.TextGeneration)({ generateThreadTitle }),
    layerSettings,
    ProviderRegistryMock.layer(),
    Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
      namedProjectsRoot: "/projects",
      isScratchProject: (id) => Effect.succeed(id === projectId),
      folderForThread: (input) =>
        Effect.sync(() => {
          folderTexts.push(input.text);
          return Option.some(`${scratchRoot}/2026-10-25-${input.threadId}`);
        }),
    }),
  );
  const layerLaunch = ThreadLaunch.layer.pipe(
    Layer.provide(
      Layer.mergeAll(layerExternal, layerThreadManagement, layerReceipts, IdAllocator.layer),
    ),
  );
  return {
    layer: Layer.mergeAll(layerLaunch, layerThreadManagement, layerStores),
    generateThreadTitle,
    folderTexts,
  };
}

it.effect("titles an ephemeral thread from its first line without the title model", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-ephemeral-launch-" });
    const scratchRoot = `${baseDir}/scratch`;
    const harness = makeHarness(scratchRoot, baseDir);
    yield* Effect.gen(function* () {
      const launches = yield* ThreadLaunch.ThreadLaunchService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      yield* Effect.flatMap(ProjectStore.ProjectStoreV2, (projects) =>
        projects.apply({
          sequence: 0,
          eventId: EventId.make("created:scratch-launch"),
          aggregateKind: "project",
          aggregateId: projectId,
          occurredAt: "2026-10-25T00:00:00.000Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.created",
          payload: {
            projectId,
            title: "No project",
            workspaceRoot: scratchRoot,
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-10-25T00:00:00.000Z",
            updatedAt: "2026-10-25T00:00:00.000Z",
          },
        }),
      );

      const launched = yield* launches.launch({
        commandId: CommandId.make("ephemeral-launch"),
        threadId: ThreadId.make("thread:ephemeral-launch"),
        projectId,
        title: "A title the client derived",
        generateTitle: true,
        modelSelection: localModel,
        runtimeMode: "approval-required",
        interactionMode: "default",
        workspaceStrategy: { type: "root" },
        initialMessage: {
          messageId: MessageId.make("ephemeral-launch:message"),
          text: "\n  Private  question about something\nwith a second line",
          attachments: [],
        },
        createdBy: "user",
        creationSource: "web",
        ephemeral: true,
      });

      const thread = (yield* threads.getThreadProjection(launched.threadId)).thread;
      assert.equal(thread.title, "Private question about something");
      assert.isTrue(thread.ephemeral);
      assert.isUndefined(thread.titleRegeneration);
      assert.deepEqual(harness.folderTexts, [""]);
      assert.isFalse(
        (yield* outbox.listByCommandId(CommandId.make("ephemeral-launch:initial-message"))).some(
          (effect) => effect.request.type === "thread-title.generate",
        ),
      );

      const followUp = CommandId.make("ephemeral-follow-up");
      yield* threads.dispatch({
        type: "message.dispatch",
        commandId: followUp,
        threadId: launched.threadId,
        messageId: MessageId.make("ephemeral-follow-up:message"),
        text: "Another private line",
        titleSeed: "Another private line",
        attachments: [],
        dispatchMode: { type: "defer_start" },
        createdBy: "user",
        creationSource: "web",
      });
      assert.isFalse(
        (yield* outbox.listByCommandId(followUp)).some(
          (effect) => effect.request.type === "thread-title.generate",
        ),
      );
      const regenerate = yield* Effect.flip(
        threads.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("ephemeral-regenerate"),
          threadId: launched.threadId,
          regenerateTitle: true,
        }),
      );
      assert.equal(regenerate._tag, "OrchestratorCommandRejectedError");
      assert.equal(harness.generateThreadTitle.mock.calls.length, 0);
      assert.equal(
        (yield* threads.getThreadProjection(launched.threadId)).thread.title,
        "Private question about something",
      );
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
