import type { OrchestrationV2ShellSnapshot, OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { collectThreadSummaries } from "./hostApi.logic";

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
