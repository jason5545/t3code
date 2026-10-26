import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/shell";

/**
 * The first page can hold no user message (agent-started threads, a turn over
 * the page budget), so unloaded history counts like mobile's composer does.
 */
export function hasCompactableConversation(input: {
  readonly visibleTurnItems: ReadonlyArray<Pick<ThreadStructureVisibleTurnItem, "item">>;
  readonly hasMoreHistory: boolean;
  readonly latestUserMessageAt: string | null;
}): boolean {
  return (
    input.visibleTurnItems.some(
      ({ item }) =>
        item.type === "user_message" &&
        (item.text.trim().toLowerCase() !== "/compact" || item.attachments.length > 0),
    ) ||
    (input.hasMoreHistory && input.latestUserMessageAt !== null)
  );
}

export const COMPACT_UNAVAILABLE_REASON = "Compacting is unavailable right now";

// Listed in scripts/i18n/displayFiles.json, so these returned strings are translated.
export function compactUnavailableReason(input: {
  readonly canOperateThread: boolean;
  readonly hasProject: boolean;
  readonly providerSupportsCompaction: boolean;
}): string {
  if (!input.canOperateThread) return "This connection cannot change threads.";
  if (!input.hasProject) return "Choose a project before compacting";
  if (!input.providerSupportsCompaction) return "Compaction is unavailable for this provider";
  return COMPACT_UNAVAILABLE_REASON;
}
