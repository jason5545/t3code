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
    return `${waiting ? "等待中" : "執行中"} · ${only.label}`;
  }
  const counts = new Map<Kind, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const groups = Array.from(counts, ([kind, count]) => `${count} 個${NOUNS[kind]}`);
  const joined =
    groups.length <= 1 ? groups.join("") : `${groups.slice(0, -1).join("、")}和 ${groups.at(-1)}`;
  return `${verb} ${joined}`;
}

const ENGLISH_KINDS: Readonly<Record<string, Kind>> = {
  subagent: "subagent",
  subagents: "subagent",
  command: "command",
  commands: "command",
  monitor: "monitor",
  monitors: "monitor",
  "background task": "background_task",
  "background tasks": "background_task",
};

const VERBS: Readonly<Record<string, string>> = {
  finished: "已完成",
  failed: "失敗",
  "was stopped": "已停止",
  "were stopped": "已停止",
  updated: "已更新",
  "reported new output": "有新的輸出",
};

const NOUN = "(Subagent|Command|Monitor|Background task|subagent|command|monitor|background task)";
const EXIT = String.raw`(?: \(exit (-?\d+)\))?`;
const ITEM = `${NOUN}(?: "([^"]*)")?${EXIT}`;
const SINGLE = new RegExp(
  `^${NOUN}(?: "(.*)")? (finished|failed|was stopped|updated|reported new output)${EXIT}$`,
);
const COUNT =
  /^(\d+) (subagents|commands|monitors|background tasks) (finished|failed|were stopped|updated)$/;
const LIST = new RegExp(
  `^${ITEM}(?:, ${ITEM})? and ${ITEM} (finished|failed|were stopped|updated)$`,
);

function chineseItem(noun: string, label: string | undefined, exit: string | undefined): string {
  const kind = ENGLISH_KINDS[noun.toLowerCase()] ?? "background_task";
  return `${NOUNS[kind]}${label ? `「${label}」` : ""}${exit === undefined ? "" : `（結束代碼 ${exit}）`}`;
}

/**
 * zh-TW for the background work notification the server writes into a thread's
 * timeline (`backgroundWorkNotification` in provider-core), or null when the
 * summary does not follow that grammar.
 */
export function translateBackgroundWorkSummary(summary: string): string | null {
  const count = COUNT.exec(summary);
  if (count) {
    const [, amount, noun = "", verb = ""] = count;
    return `${amount} 個${NOUNS[ENGLISH_KINDS[noun] ?? "background_task"]}${VERBS[verb]}`;
  }
  // Before SINGLE, whose quoted label would otherwise swallow the later names.
  const list = LIST.exec(summary);
  if (list) {
    const items: string[] = [];
    for (let index = 1; index <= 7; index += 3) {
      const noun = list[index];
      if (noun !== undefined) items.push(chineseItem(noun, list[index + 1], list[index + 2]));
    }
    return `${items.slice(0, -1).join("、")}和${items.at(-1)}${VERBS[list[10] ?? ""]}`;
  }
  const single = SINGLE.exec(summary);
  if (!single) return null;
  const [, noun = "", label, verb = "", exit] = single;
  const item = chineseItem(noun, label, undefined);
  return `${item}${VERBS[verb]}${exit === undefined ? "" : `（結束代碼 ${exit}）`}`;
}
