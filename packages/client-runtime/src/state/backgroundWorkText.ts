import type { OrchestrationV2PendingBackgroundTask } from "@t3tools/contracts";

/** zh-TW nouns for the server's background work notifications, parsed below. */
type Kind = OrchestrationV2PendingBackgroundTask["kind"];

const NOUNS: Record<Kind, string> = {
  subagent: "子代理程式",
  command: "指令",
  monitor: "監控器",
  background_task: "背景工作",
};

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
