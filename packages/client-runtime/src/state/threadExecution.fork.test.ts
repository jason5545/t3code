import { ThreadId, type OrchestrationV2PendingBackgroundTask } from "@t3tools/contracts";
import { setChineseDurations } from "@t3tools/shared/durationFormat";
import { describe, expect, it } from "@effect/vitest";

import { presentPendingBackgroundWork } from "./threadExecution.ts";

const subagent = (taskId: string, description?: string): OrchestrationV2PendingBackgroundTask => ({
  taskId,
  kind: "subagent",
  childThreadId: ThreadId.make(`thread:${taskId}`),
  ...(description === undefined ? {} : { description }),
});
const command = (taskId: string, description?: string): OrchestrationV2PendingBackgroundTask => ({
  taskId,
  kind: "command",
  ...(description === undefined ? {} : { description }),
});

function titlesIn(chinese: boolean, tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>) {
  setChineseDurations(chinese);
  try {
    return presentPendingBackgroundWork(tasks);
  } finally {
    setChineseDurations(false);
  }
}

describe("presentPendingBackgroundWork in zh-TW", () => {
  it("counts mixed work in Chinese and keeps English otherwise", () => {
    const tasks = [subagent("a", "Explore"), subagent("b", "Review"), command("c", "vp test")];
    expect(titlesIn(false, tasks)?.title).toBe("Waiting on 2 subagents and 1 command");
    expect(titlesIn(true, tasks)?.title).toBe("正在等待 2 個子代理程式和 1 個指令");
  });

  it("names a single task and falls back to the Chinese noun", () => {
    expect(titlesIn(true, [subagent("a", "Explore")])?.title).toBe("正在等待子代理程式：Explore");
    expect(titlesIn(true, [command("c", "vp test")])?.title).toBe("執行中：vp test");
    const unnamed = titlesIn(true, [command("c")]);
    expect(unnamed?.title).toBe("正在執行指令");
    expect(unnamed?.items[0]?.label).toBe("指令");
  });
});
