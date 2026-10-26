import { assert, it } from "@effect/vitest";
import {
  CommandId,
  type PullRequestComment,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { evaluatePullRequestWatch } from "./pullRequestWatch.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for PR watches"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const layerTest = ProviderReplayHarness.layerWithRegistry(
  { name: "pull-request-watch-fork" },
  ProviderAdapterRegistry.layerFromAdapters([adapter]),
  { databaseLayer: SqlitePersistence.layerMemory, runEffectWorker: false },
);

const threadId = ThreadId.make("thread:pr-watch");
const pullRequest = { host: "github.com", repository: "pingdotgg/t3code", number: 25445 };
const url = "https://github.com/pingdotgg/t3code/pull/25445";

const detail: Parameters<typeof evaluatePullRequestWatch>[1] = {
  capabilities: {
    diff: true,
    comment: true,
    actions: [],
    mergeMethods: [],
    search: false,
    review: { inlineComment: false, reply: false, resolve: false, verdicts: [] },
    reviewers: { request: false, listCandidates: false },
    checksAlwaysReport: false,
  },
  headSha: "aaaaaaaaaa",
  checks: [],
  mergeability: "mergeable",
  viewer: "jason5545",
  author: { login: "jason5545", name: null, avatarUrl: null },
};

const review = (createdAt: string): PullRequestComment => ({
  id: `coderabbit-${createdAt}`,
  kind: "review-comment",
  author: { login: "coderabbitai", name: null, avatarUrl: null },
  body: "Also counts a typed /compact.",
  createdAt,
  url: `${url}#discussion`,
  path: "apps/web/src/components/ChatView.logic.ts",
  reviewState: null,
});

it.effect(
  "a first watch wakes for reviews left after the PR was linked, a renewed watch does not",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const watching = (watching: boolean, at: string) =>
        orchestrator.dispatch({
          type: "thread.pull-request.watch",
          commandId: CommandId.make(`watch:${watching}:${at}`),
          threadId,
          ...pullRequest,
          watching,
          link: { url, source: "agent" },
        });
      const watchState = Effect.map(
        orchestrator.getThreadProjection(threadId),
        (projection) => projection.thread.pullRequests![0]!.watch!,
      );
      const isoAfter = (start: DateTime.Utc, minutes: number) =>
        DateTime.formatIso(DateTime.add(start, { minutes }));

      yield* orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make("create"),
        threadId,
        projectId: ProjectId.make("project:pr-watch"),
        title: "Upstream PR",
        modelSelection: { instanceId, model: "gpt-5.1-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      const linkedAt = yield* DateTime.now;
      yield* orchestrator.dispatch({
        type: "thread.pull-request.link",
        commandId: CommandId.make("link"),
        threadId,
        ...pullRequest,
        url,
        source: "created",
      });

      yield* TestClock.adjust("20 minutes");
      yield* watching(true, "first");
      const first = evaluatePullRequestWatch(
        yield* watchState,
        detail,
        [review(isoAfter(linkedAt, 9))],
        0,
      );
      assert.deepEqual(
        first.changes.map((change) => change.kind),
        ["remarks"],
      );

      yield* watching(false, "stop");
      yield* TestClock.adjust("20 minutes");
      yield* watching(true, "again");
      const renewed = evaluatePullRequestWatch(
        yield* watchState,
        detail,
        [review(isoAfter(linkedAt, 30))],
        0,
      );
      assert.deepEqual(renewed.changes, []);
    }).pipe(Effect.provide(layerTest)),
);
