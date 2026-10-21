import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { makeAssistantStreamingFilter } from "./assistantStreaming.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const reasoning = (text: string, streaming = true): ProviderAdapter.ProviderAdapterV2Event => ({
  type: "turn_item.updated",
  driver: ProviderDriverKind.make("codex"),
  turnItem: {
    id: TurnItemId.make("item"),
    threadId: ThreadId.make("thread"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: streaming ? "running" : "completed",
    title: null,
    startedAt: null,
    completedAt: null,
    updatedAt: DateTime.makeUnsafe("2026-09-14T00:00:00Z"),
    type: "reasoning",
    text,
    streaming,
  },
});

describe("V2 assistant streaming (fork)", () => {
  it("streams reasoning without waiting for a paragraph boundary", () => {
    const filter = makeAssistantStreamingFilter("paragraph");
    expect(filter(reasoning("Checking the"), 0)).toMatchObject({
      turnItem: { text: "Checking the", streaming: true, type: "reasoning" },
    });
    expect(filter(reasoning("Checking the adapter"), 100)).toBeNull();
    expect(filter(reasoning("Checking the adapter first"), 410)).toMatchObject({
      turnItem: { text: "Checking the adapter first", streaming: true },
    });
    expect(filter(reasoning("Checking the adapter first"), 900)).toBeNull();
    const final = reasoning("Checking the adapter first.", false);
    expect(filter(final, 910)).toBe(final);

    const buffered = makeAssistantStreamingFilter("turn");
    expect(buffered(reasoning("Checking the"), 0)).toBeNull();
    expect(buffered(final, 1)).toBe(final);
  });
});
