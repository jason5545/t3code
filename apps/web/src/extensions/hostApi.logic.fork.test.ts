import type { OrchestrationV2ShellSnapshot, OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";

import {
  availableExtensionPages,
  collectThreadSummaries,
  EXTENSION_ACTIONS,
  planReplyReads,
  readExtensionName,
  readRequestResponse,
  summarizePendingRequest,
} from "./hostApi.logic";

const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 10, 16, 4, minute));

// Only the fields the summary reads; the shell schema has many more.
const shell = (
  id: string,
  minute: number,
  overrides: Partial<Record<keyof OrchestrationV2ThreadShell, unknown>> = {},
) =>
  ({
    id,
    projectId: "project:t3",
    title: id,
    providerInstanceId: "codex",
    modelSelection: {
      instanceId: "codex",
      model: "gpt-6",
      options: [{ id: "effort", value: "high" }],
    },
    status: "idle",
    activeRunId: null,
    latestRunId: null,
    pendingRuntimeRequest: null,
    latestVisibleMessage: {
      id: "m",
      role: "assistant",
      text: "x".repeat(3000),
      updatedAt: at(minute),
    },
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
    launchedByThreadId: null,
    branch: null,
    worktreePath: null,
    settledAt: null,
    archivedAt: null,
    deletedAt: null,
    createdAt: at(0),
    updatedAt: at(minute),
    ...overrides,
  }) as unknown as OrchestrationV2ThreadShell;

const snapshot = (threads: ReadonlyArray<OrchestrationV2ThreadShell>) =>
  ({
    threads,
    projects: [{ id: "project:t3", title: "t3code", workspaceRoot: "/work/t3code" }],
  }) as unknown as Pick<OrchestrationV2ShellSnapshot, "threads" | "projects">;

describe("collectThreadSummaries", () => {
  it("lists every environment's threads newest first, without archived or deleted ones", () => {
    const local = snapshot([
      shell("thread:old", 1),
      shell("thread:archived", 9, { archivedAt: at(9) }),
      shell("thread:side", 5, {
        lineage: {
          parentThreadId: "thread:old",
          relationshipToParent: null,
          rootThreadId: "thread:old",
          sideChat: true,
        },
      }),
    ]);
    const remote = snapshot([
      shell("thread:remote", 3),
      shell("thread:deleted", 8, { deletedAt: at(8) }),
    ]);
    const summaries = collectThreadSummaries(
      [
        { environmentId: "env:local", snapshot: local },
        { environmentId: "env:hub", snapshot: remote },
        { environmentId: "env:offline", snapshot: null },
      ],
      null,
    );
    expect(summaries.map(({ id, environmentId }) => [id, environmentId])).toEqual([
      ["thread:side", "env:local"],
      ["thread:remote", "env:hub"],
      ["thread:old", "env:local"],
    ]);
    expect(summaries[0]).toMatchObject({
      relationship: "side-chat",
      parentThreadId: "thread:old",
      projectTitle: "t3code",
      projectRoot: "/work/t3code",
      effort: "high",
      updatedAt: "2026-11-16T04:05:00.000Z",
    });
    expect(summaries[0]?.latestMessage?.text).toHaveLength(2000);
  });

  it("hands back the previous array while nothing changed", () => {
    const environments = [
      { environmentId: "env:local", snapshot: snapshot([shell("thread:a", 1)]) },
    ];
    const first = collectThreadSummaries(environments, null);
    expect(collectThreadSummaries(environments, first)).toBe(first);
    const changed = [{ environmentId: "env:local", snapshot: snapshot([shell("thread:a", 2)]) }];
    expect(collectThreadSummaries(changed, first)).not.toBe(first);
  });
});

describe("readExtensionName", () => {
  it("takes T3's own names and refuses the rest, inherited keys included", () => {
    expect(readExtensionName(EXTENSION_ACTIONS, "addProject", "actions.run")).toBe("addProject");
    for (const name of ["toString", "constructor", "/settings", "", null, 3]) {
      expect(() => readExtensionName(EXTENSION_ACTIONS, name, "actions.run")).toThrow(
        "actions.run takes newThread, newThreadInProject, addProject or search.",
      );
    }
  });

  it("offers the pull request page only where the environment supports it", () => {
    expect(availableExtensionPages(true)).toEqual(["home", "settings", "usage", "pullRequests"]);
    expect(availableExtensionPages(false)).toEqual(["home", "settings", "usage"]);
  });
});

describe("planReplyReads", () => {
  const ref = (environmentId: string, threadId: string) => ({ environmentId, threadId });
  it("asks each environment once for previews, and one thread at a time for whole replies", () => {
    const refs = [ref("mac", "a"), ref("hub", "b"), ref("mac", "c"), ref("mac", "a")];
    expect(planReplyReads(refs, false)).toEqual({
      chars: 600,
      batches: [
        { environmentId: "mac", threadIds: ["a", "c"] },
        { environmentId: "hub", threadIds: ["b"] },
      ],
    });
    expect(planReplyReads(refs.slice(0, 2), true)).toEqual({
      chars: 100_000,
      batches: [
        { environmentId: "mac", threadIds: ["a"] },
        { environmentId: "hub", threadIds: ["b"] },
      ],
    });
    const many = Array.from({ length: 450 }, (_, i) => ref("mac", `t${i}`));
    expect(planReplyReads(many, false).batches.map(({ threadIds }) => threadIds.length)).toEqual([
      200, 200, 50,
    ]);
  });
  it("refuses something that is not a list of thread refs", () => {
    expect(() => planReplyReads("thread" as never, false)).toThrow(TypeError);
    expect(() => planReplyReads([{ environmentId: "mac" }] as never, false)).toThrow(TypeError);
  });
});

const pending = (requests: Partial<PendingThreadRequests>): PendingThreadRequests =>
  ({ approvals: [], userInputs: [], ...requests }) as PendingThreadRequests;
const approval = {
  requestId: "request:approve",
  requestKind: "command",
  createdAt: "2026-11-16T04:02:00.000Z",
  detail: "git push",
  responseCapability: "live",
} as const;
const question = {
  requestId: "request:ask",
  createdAt: "2026-11-16T04:01:00.000Z",
  questions: [
    {
      id: "q1",
      header: "Route",
      question: "Which way?",
      options: [
        { label: "North", description: "via the hub" },
        { label: "South", description: "direct", value: "south-direct" },
      ],
      multiSelect: false,
    },
  ],
  responseCapability: "live",
  dismissible: false,
} as const;

describe("summarizePendingRequest", () => {
  it("shows the oldest approval, with the default buttons when the provider sent none", () => {
    expect(summarizePendingRequest(pending({ approvals: [approval as never] }))).toEqual({
      id: "request:approve",
      kind: "approval",
      requestKind: "command",
      createdAt: "2026-11-16T04:02:00.000Z",
      detail: "git push",
      reason: null,
      options: [
        { decision: "cancel", label: "Cancel", warning: null },
        { decision: "decline", label: "Decline", warning: null },
        { decision: "acceptForSession", label: "Always allow this session", warning: null },
        { decision: "accept", label: "Approve", warning: null },
      ],
      canRespond: true,
    });
  });
  it("shows a question with each option's answer value, and null when nothing waits", () => {
    expect(summarizePendingRequest(pending({ userInputs: [question as never] }))).toEqual({
      id: "request:ask",
      kind: "user_input",
      createdAt: "2026-11-16T04:01:00.000Z",
      questions: [
        {
          id: "q1",
          header: "Route",
          question: "Which way?",
          multiSelect: false,
          allowCustomAnswer: true,
          options: [
            { label: "North", description: "via the hub", value: "North" },
            { label: "South", description: "direct", value: "south-direct" },
          ],
        },
      ],
      canRespond: true,
    });
    expect(summarizePendingRequest(pending({}))).toBeNull();
    expect(summarizePendingRequest(null)).toBeNull();
  });
  it("puts an approval before a question, whichever came first", () => {
    const both = pending({ approvals: [approval as never], userInputs: [question as never] });
    expect(summarizePendingRequest(both)?.kind).toBe("approval");
  });
  it("cannot respond once the provider process is gone", () => {
    const gone = { ...approval, responseCapability: "not_resumable" };
    expect(summarizePendingRequest(pending({ approvals: [gone as never] }))?.canRespond).toBe(
      false,
    );
  });
});

describe("readRequestResponse", () => {
  const ask = summarizePendingRequest(pending({ userInputs: [question as never] }))!;
  const approve = summarizePendingRequest(pending({ approvals: [approval as never] }))!;
  it("takes a decision the approval offers", () => {
    expect(readRequestResponse(approve, { decision: "accept" })).toEqual({
      type: "approval",
      decision: "accept",
    });
    expect(() => readRequestResponse(approve, { decision: "acceptAlways" })).toThrow(TypeError);
    expect(() => readRequestResponse(approve, { answers: {} })).toThrow(TypeError);
  });
  it("takes an answer for every question, by option value or as the user's own words", () => {
    expect(readRequestResponse(ask, { answers: { q1: "south-direct" } })).toEqual({
      type: "user_input",
      answers: { q1: "south-direct" },
    });
    expect(readRequestResponse(ask, { answers: { q1: "  走海線  " } })).toEqual({
      type: "user_input",
      answers: { q1: "走海線" },
    });
    expect(() => readRequestResponse(ask, { answers: {} })).toThrow(TypeError);
    expect(() => readRequestResponse(ask, { answers: { q1: ["North"] } })).toThrow(TypeError);
    expect(() => readRequestResponse(ask, { decision: "accept" })).toThrow(TypeError);
  });
  it("refuses a request that cannot be answered any more", () => {
    const gone = { ...approve, canRespond: false };
    expect(() => readRequestResponse(gone, { decision: "accept" })).toThrow(TypeError);
  });
});
