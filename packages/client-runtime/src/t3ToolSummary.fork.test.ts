import { resolveT3McpToolDefinition } from "@t3tools/shared/t3McpToolPresentation";
import { describe, expect, it } from "vite-plus/test";

import { resolveWorkEntryToolPresentation, summarizeToolGroup } from "./work-log/presentation.ts";

// Fork patch 22: Claude Code reaches the owner's other machines as `t3-hub`, `t3-fr` and `t3-mac`.
describe("the owner's other T3 servers", () => {
  it("are read as T3 tools", () => {
    const entry = (label: string) => ({
      id: label,
      createdAt: "2026-11-06T00:00:00.000Z",
      label,
      tone: "tool" as const,
      itemType: "dynamic_tool" as const,
      toolLifecycleStatus: "completed" as const,
      toolSource: { key: "mcp:t3-hub", name: "T3 Code", kind: "integration" as const },
    });
    expect(summarizeToolGroup([entry("mcp__t3-hub__t3_thread_read")]).summary).toBe(
      summarizeToolGroup([entry("mcp__t3-code__t3_thread_read")]).summary,
    );
    expect(resolveWorkEntryToolPresentation(entry("t3-fr.t3_thread_send"))?.displayName).toBe(
      resolveWorkEntryToolPresentation(entry("t3-code.t3_thread_send"))?.displayName,
    );
    expect(resolveT3McpToolDefinition("mcp__t3-mac__t3_thread_list")).toBe(
      resolveT3McpToolDefinition("mcp__t3-code__t3_thread_list"),
    );
    expect(resolveT3McpToolDefinition("mcp__t3-docs-server__t3_thread_list")).toBeNull();
  });
});
