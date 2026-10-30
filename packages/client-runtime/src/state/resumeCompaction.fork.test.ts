import { ProviderDriverKind, type OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import {
  CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
  formatClaudeResumeCompactionQuestion,
} from "@t3tools/shared/claudeCompaction";
import { describe, expect, it } from "vite-plus/test";

import { v2Projection } from "./orchestrationV2TestFixtures.ts";
import { resumeCompactionCandidate } from "./resumeCompaction.ts";

// The 2026-10-31 mobile return: 293,611 tokens at 22:23:02 (UTC+8), back 8h40m later.
const lastTurnAt = "2026-10-30T14:23:02.000Z";
const returnedAt = "2026-10-30T23:03:21.000Z";

function projection(input: {
  readonly usedTokens: number;
  readonly promptCacheTtlMs?: number;
  readonly dismissed?: boolean;
}): OrchestrationV2ThreadProjection {
  const providerTurns = [
    {
      tokenUsage: {
        usedTokens: input.usedTokens,
        updatedAt: lastTurnAt,
        ...(input.promptCacheTtlMs === undefined
          ? {}
          : { promptCacheTtlMs: input.promptCacheTtlMs }),
      },
    },
  ] as unknown as OrchestrationV2ThreadProjection["providerTurns"];
  const runtimeRequests = (input.dismissed
    ? [
        {
          kind: "user_input",
          status: "resolved",
          answers: {
            [formatClaudeResumeCompactionQuestion({ ageMinutes: 90, estimatedTokens: 250_000 })]:
              CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
          },
        },
      ]
    : []) as unknown as OrchestrationV2ThreadProjection["runtimeRequests"];
  return { ...v2Projection, providerTurns, runtimeRequests };
}

describe("resumeCompactionCandidate", () => {
  it.each([
    { name: "a stale Claude thread over 200K", now: returnedAt, expected: 293_611 },
    { name: "under 200K", usedTokens: 150_000, now: returnedAt, expected: null },
    { name: "within the fallback TTL", now: "2026-10-30T15:23:02.000Z", expected: null },
    {
      name: "past a reported TTL shorter than the fallback",
      promptCacheTtlMs: 5 * 60_000,
      now: "2026-10-30T14:30:00.000Z",
      expected: 293_611,
    },
    { name: "with idle compaction off", idleCompaction: "off", now: returnedAt, expected: null },
    { name: "on a Codex thread", provider: "codex", now: returnedAt, expected: null },
    {
      name: "after Claude's own resume dialog was answered Don't ask again",
      dismissed: true,
      now: returnedAt,
      expected: null,
    },
  ] as const)("$name", (testCase) => {
    const candidate = resumeCompactionCandidate({
      projection: projection({
        usedTokens: "usedTokens" in testCase ? testCase.usedTokens : 293_611,
        ...("promptCacheTtlMs" in testCase ? { promptCacheTtlMs: testCase.promptCacheTtlMs } : {}),
        ...("dismissed" in testCase ? { dismissed: testCase.dismissed } : {}),
      }),
      provider: ProviderDriverKind.make("provider" in testCase ? testCase.provider : "claudeAgent"),
      idleCompaction: "idleCompaction" in testCase ? testCase.idleCompaction : "onReturn",
    });
    const due = candidate !== null && Date.parse(testCase.now) >= candidate.dueAtMs;
    expect(due ? candidate.tokens : null).toBe(testCase.expected);
  });
});
