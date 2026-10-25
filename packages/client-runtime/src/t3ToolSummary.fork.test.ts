import { setChineseDurations } from "@t3tools/shared/durationFormat";
import {
  resolveT3McpToolDefinition,
  resolveT3McpToolPresentation,
  T3_MCP_TOOL_NAMES,
  type T3McpToolSummaryAction,
} from "@t3tools/shared/t3McpToolPresentation";
import { LOCALIZED_T3_MCP_TOOL_IDS, localizedT3McpToolTitle } from "@t3tools/shared/t3McpToolText";
import { describe, expect, it } from "vite-plus/test";

import { summarizeT3ToolCalls, type T3ToolSummaryCall } from "./t3ToolSummary.ts";
import { resolveWorkEntryToolPresentation, summarizeToolGroup } from "./work-log/presentation.ts";

function inChinese<A>(run: () => A): A {
  setChineseDurations(true);
  try {
    return run();
  } finally {
    setChineseDurations(false);
  }
}

// Names and abbreviations the Chinese text keeps.
const leftoverEnglish = (text: string) =>
  text.replace(/\b(?:T3|HTML|PR)\b/g, "").match(/[A-Za-z]+/);

const call = (
  outcome: T3ToolSummaryCall["outcome"],
  index: number,
  output?: Record<string, unknown>,
): T3ToolSummaryCall => ({
  input: {
    threadId: `thread-${index}`,
    taskId: `task-${index}`,
    projectId: `project-${index}`,
    attachments: [{ id: `attachment-${index}` }],
  },
  output: output ?? { threadId: `thread-${index}`, messageId: `message-${index}` },
  outcome,
});

const actions = new Set<T3McpToolSummaryAction>(
  [...T3_MCP_TOOL_NAMES].map((name) => resolveT3McpToolDefinition(name)!.summaryAction),
);

describe("T3 tool text in zh-TW", () => {
  it("has Chinese for every T3 tool", () => {
    expect([...T3_MCP_TOOL_NAMES].filter((name) => !LOCALIZED_T3_MCP_TOOL_IDS.has(name))).toEqual(
      [],
    );
  });

  it("titles every tool in every state without English", () => {
    for (const name of T3_MCP_TOOL_NAMES) {
      for (const status of ["inProgress", "completed", "failed", "declined", "stopped"]) {
        const title = inChinese(() => localizedT3McpToolTitle(name, status, null));
        expect({ name, status, leftover: leftoverEnglish(title ?? "missing") }).toEqual({
          name,
          status,
          leftover: null,
        });
      }
    }
  });

  it("summarizes every action without English", () => {
    const shapes: ReadonlyArray<ReadonlyArray<T3ToolSummaryCall>> = [
      [call("completed", 1)],
      [call("completed", 1), call("completed", 2)],
      [call("unfinished", 1)],
      [call("unfinished", 1), call("unfinished", 2)],
      [call("completed", 1, { guides: [{ outcome: "started" }, { outcome: "failed" }] })],
      [call("completed", 1, { guides: [{ outcome: "failed" }] })],
    ];
    for (const action of actions) {
      for (const calls of shapes) {
        const label = inChinese(() => summarizeT3ToolCalls(action, calls).label);
        expect({ action, label, leftover: leftoverEnglish(label) }).toEqual({
          action,
          label,
          leftover: null,
        });
      }
    }
  });

  it("reads naturally and keeps English when the locale is English", () => {
    const delegated = [call("completed", 1), call("completed", 2)];
    expect(summarizeT3ToolCalls("delegate", delegated).label).toBe("Delegated 2 tasks");
    expect(inChinese(() => summarizeT3ToolCalls("delegate", delegated).label)).toBe(
      "委派了 2 個任務",
    );
    expect(inChinese(() => summarizeT3ToolCalls("browser", delegated).label)).toBe(
      "使用了瀏覽器 2 次",
    );
    expect(inChinese(() => summarizeT3ToolCalls("thread-send", [call("completed", 1)]).label)).toBe(
      "傳送了 1 則訊息到 1 個對話",
    );
    expect(inChinese(() => summarizeT3ToolCalls("task-cancel", delegated).label)).toBe(
      "已要求取消 2 個任務",
    );
    expect(
      inChinese(() => summarizeT3ToolCalls("thread-read", [call("unfinished", 1)]).label),
    ).toBe("嘗試讀取 1 個對話");
  });

  it("titles a work log row and names the tool", () => {
    const entry = (toolLifecycleStatus: "inProgress" | "completed") => ({
      label: "mcp__t3-code__preview_snapshot",
      toolLifecycleStatus,
    });
    expect(resolveWorkEntryToolPresentation(entry("completed"))?.displayName).toBe(
      "Took a snapshot of the preview page",
    );
    expect(
      inChinese(() => resolveWorkEntryToolPresentation(entry("inProgress"))?.displayName),
    ).toBe("正在擷取預覽頁面快照");
    expect(inChinese(() => resolveWorkEntryToolPresentation(entry("completed"))?.displayName)).toBe(
      "已擷取預覽頁面快照",
    );
    const linked = inChinese(() =>
      resolveWorkEntryToolPresentation({
        label: "mcp__t3-code__link_pull_request",
        toolLifecycleStatus: "completed",
        toolData: { input: { number: 12 } },
      }),
    );
    expect(linked?.displayName).toBe("已連結 PR #12");
    expect(
      inChinese(() => resolveT3McpToolPresentation("mcp__t3-code__delegate_task")?.displayName),
    ).toBe("委派子任務");
    expect(resolveT3McpToolPresentation("mcp__t3-code__delegate_task")?.displayName).toBe(
      "Delegate a child task",
    );
  });

  it("summarizes a group of thoughts", () => {
    const thoughts = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `thought-${index}`,
        createdAt: "2026-10-25T00:00:00.000Z",
        label: "Reasoning",
        tone: "thinking" as const,
        itemType: "reasoning" as const,
      }));
    expect(inChinese(() => summarizeToolGroup(thoughts(1)).summary)).toBe("已思考");
    expect(inChinese(() => summarizeToolGroup(thoughts(3)).summary)).toBe("已思考（×3）");
    expect(summarizeToolGroup(thoughts(3)).summary).toBe("Thought (×3)");
  });
});
