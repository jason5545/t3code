import type { ActiveTurnComposerAction } from "@t3tools/client-runtime/state/composer-dispatch";

import { useChinese } from "./autoTranslateRuntime";

/*
 * Sentences built around identifiers, counts or lists. The build-time pass keeps a
 * template's values as they are, so `steer`, a plural suffix or a trailing `?` would
 * stay English inside a translated sentence; these helpers pick the language instead.
 */

const FOLLOW_UP_ACTIONS = { queue: "加入佇列", steer: "引導", restart: "重新開始" } as const;

export function followUpClickTooltip(
  behavior: ActiveTurnComposerAction,
  alternateShortcutLabel: string | null,
  alternate: ActiveTurnComposerAction,
): string {
  if (useChinese) {
    const shortcut = alternateShortcutLabel ? `或按 ${alternateShortcutLabel}` : "";
    return `點擊以${FOLLOW_UP_ACTIONS[behavior]}，Ctrl/⌘+點擊${shortcut}以${FOLLOW_UP_ACTIONS[alternate]}`;
  }
  return `Click to ${behavior}, Ctrl/⌘-click${alternateShortcutLabel ? ` or ${alternateShortcutLabel}` : ""} to ${alternate}`;
}

const UNDO_ACTIONS = {
  Settled: "已結束",
  Snoozed: "已延後",
  Unpinned: "已取消釘選",
  Archived: "已封存",
  Discarded: "已捨棄",
} as const;

/** The sidebar's undo notice before its Undo button, such as "Settled 2 threads, ". */
export function threadUndoNoticeText(notice: {
  readonly action: keyof typeof UNDO_ACTIONS;
  readonly count: number;
}): string {
  if (useChinese) {
    const noun = notice.action === "Discarded" ? "份草稿" : "個對話";
    return `${UNDO_ACTIONS[notice.action]} ${notice.count} ${noun}，`;
  }
  const noun = `${notice.action === "Discarded" ? "draft" : "thread"}${notice.count === 1 ? "" : "s"}`;
  return `${notice.action} ${notice.count} ${noun}, `;
}

/** The Update everything confirmation's title, a question about its summary. */
export function updateEverythingQuestion(summary: string): string {
  return `${summary}${useChinese ? "？" : "?"}`;
}

export function runningThreadsText(running: number): string {
  if (useChinese) return `${running} 個執行中的對話`;
  return `${running} running ${running === 1 ? "thread" : "threads"}`;
}

export function skippedMachineText(machine: {
  readonly label: string;
  readonly reason: string;
}): string {
  if (useChinese) return `略過 ${machine.label}：${machine.reason}`;
  return `Skips ${machine.label}: ${machine.reason}`;
}
