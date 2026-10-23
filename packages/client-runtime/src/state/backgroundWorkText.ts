import type { OrchestrationV2PendingBackgroundTask } from "@t3tools/contracts";
import { usesChineseDurations } from "@t3tools/shared/durationFormat";

/**
 * zh-TW text for the background work banner. Its English title is assembled from
 * counts and plurals, which the build-time translation pass cannot reach; this
 * package follows the clients' startup locale through `setChineseDurations`.
 */
type Kind = OrchestrationV2PendingBackgroundTask["kind"];

const NOUNS: Record<Kind, string> = {
  subagent: "子代理程式",
  command: "指令",
  monitor: "監控器",
  background_task: "背景工作",
};

/** The label of a task without a description of its own, or null in English. */
export function localizedBackgroundWorkNoun(kind: Kind): string | null {
  return usesChineseDurations() ? NOUNS[kind] : null;
}

/** Items arrive sorted by kind, so the groups keep that order. Null in English. */
export function localizedBackgroundWorkTitle(
  items: ReadonlyArray<{ readonly kind: Kind; readonly label: string }>,
  waiting: boolean,
): string | null {
  if (!usesChineseDurations()) return null;
  const verb = waiting ? "正在等待" : "正在執行";
  const [only] = items;
  if (items.length === 1 && only !== undefined) {
    const noun = NOUNS[only.kind];
    if (only.label === noun) return `${verb}${noun}`;
    if (!waiting) return `執行中：${only.label}`;
    return only.kind === "monitor" ? only.label : `${verb}${noun}：${only.label}`;
  }
  const counts = new Map<Kind, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const groups = Array.from(counts, ([kind, count]) => `${count} 個${NOUNS[kind]}`);
  const joined =
    groups.length <= 1 ? groups.join("") : `${groups.slice(0, -1).join("、")}和 ${groups.at(-1)}`;
  return `${verb} ${joined}`;
}
