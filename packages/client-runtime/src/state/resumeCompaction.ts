import type {
  IdleCompactionMode,
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderTurn,
  OrchestrationV2ProviderTurnTokenUsage,
  OrchestrationV2ThreadProjection,
  ProviderDriverKind,
} from "@t3tools/contracts";
import {
  CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
  COMPACTION_SUGGESTION_MIN_TOKENS,
  isClaudeResumeCompactionQuestion,
} from "@t3tools/shared/claudeCompaction";
import * as DateTime from "effect/DateTime";

import type { ThreadStructure } from "./models.ts";

// Fallback TTL: Claude's 1h cache plus slack.
const CLAUDE_RESUME_COMPACTION_FALLBACK_MS = 70 * 60_000;

/** Newest report by timestamp; snapshots order turns by provider thread. */
export function latestProviderTurnTokenUsage(
  turns: ReadonlyArray<Pick<OrchestrationV2ProviderTurn, "tokenUsage">>,
  projection?: Pick<ThreadStructure, "thread" | "contextTransfers"> | null,
  providerThread?: Pick<OrchestrationV2ProviderThread, "contextUsage"> | null,
): OrchestrationV2ProviderTurnTokenUsage | null {
  let latest: OrchestrationV2ProviderTurnTokenUsage | null = null;
  for (const { tokenUsage } of turns) {
    if (tokenUsage === undefined) continue;
    // Ties go to the later entry, since live upserts append.
    if (latest === null || Date.parse(tokenUsage.updatedAt) >= Date.parse(latest.updatedAt)) {
      latest = tokenUsage;
    }
  }
  if (latest !== null || projection == null || providerThread?.contextUsage != null) return latest;
  const forkedFrom = projection.thread.forkedFrom;
  if (forkedFrom?.type !== "run") return null;
  return (
    projection.contextTransfers.find(
      (transfer) =>
        transfer.type === "fork" &&
        transfer.targetThreadId === projection.thread.id &&
        transfer.sourceThreadId === forkedFrom.threadId &&
        transfer.sourcePoint.runId === forkedFrom.runId &&
        transfer.sourceProviderInstanceId === projection.thread.modelSelection.instanceId &&
        (transfer.status === "pending" || transfer.resolution?.strategy === "native_fork"),
    )?.sourceTokenUsage ?? null
  );
}

export function hasDismissedResumeCompaction(
  activities: ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>,
): boolean {
  return activities.some((activity) => {
    if (activity.kind !== "user-input.resolved") return false;
    const payload = activity.payload;
    if (!payload || typeof payload !== "object") return false;
    const answers = (payload as { readonly answers?: unknown }).answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) return false;

    return Object.entries(answers).some(
      ([question, answer]) =>
        isClaudeResumeCompactionQuestion(question) &&
        answer === CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
    );
  });
}

export function shouldOfferResumeCompaction(input: {
  readonly provider: string | null | undefined;
  readonly usedTokens: number | null | undefined;
  readonly updatedAt: string | null | undefined;
  readonly promptCacheTtlMs?: number | undefined;
  readonly now: string;
}): boolean {
  if (
    input.provider !== "claudeAgent" ||
    (input.usedTokens ?? 0) < COMPACTION_SUGGESTION_MIN_TOKENS
  ) {
    return false;
  }

  const updatedAt = Date.parse(input.updatedAt ?? "");
  const now = Date.parse(input.now);
  return (
    Number.isFinite(updatedAt) &&
    Number.isFinite(now) &&
    now - updatedAt >= (input.promptCacheTtlMs ?? CLAUDE_RESUME_COMPACTION_FALLBACK_MS)
  );
}

/**
 * The tokens a send into this thread compacts first under "When you return", and when the
 * prompt cache expires so that applies; null when it never does. Reads usage as the web
 * context meter does: the newest turn report, else the provider thread's own.
 */
export function resumeCompactionCandidate(input: {
  readonly projection: Pick<
    OrchestrationV2ThreadProjection,
    "thread" | "contextTransfers" | "providerThreads" | "providerTurns" | "runtimeRequests"
  >;
  readonly provider: ProviderDriverKind | null | undefined;
  readonly idleCompaction: IdleCompactionMode;
}): { readonly tokens: number; readonly dueAtMs: number } | null {
  const { projection } = input;
  if (input.provider !== "claudeAgent" || input.idleCompaction === "off") return null;
  const dismissed = hasDismissedResumeCompaction(
    projection.runtimeRequests
      .filter((request) => request.kind === "user_input" && request.status === "resolved")
      .map((request) => ({ kind: "user-input.resolved", payload: { answers: request.answers } })),
  );
  if (dismissed) return null;
  const providerThread =
    projection.providerThreads.find(
      (thread) => thread.id === projection.thread.activeProviderThreadId,
    ) ?? null;
  const live = latestProviderTurnTokenUsage(projection.providerTurns, projection, providerThread);
  const tokens = live?.usedTokens ?? providerThread?.contextUsage?.usedTokens ?? 0;
  const updatedAtMs = live
    ? Date.parse(live.updatedAt)
    : providerThread?.contextUsage != null
      ? DateTime.toEpochMillis(providerThread.updatedAt)
      : Number.NaN;
  if (tokens < COMPACTION_SUGGESTION_MIN_TOKENS || !Number.isFinite(updatedAtMs)) return null;
  return {
    tokens,
    dueAtMs: updatedAtMs + (live?.promptCacheTtlMs ?? CLAUDE_RESUME_COMPACTION_FALLBACK_MS),
  };
}
