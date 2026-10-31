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
  modifierLabel: string,
  alternateShortcutLabel: string | null,
  alternate: ActiveTurnComposerAction,
): string {
  if (useChinese) {
    const shortcut = alternateShortcutLabel ? `或按 ${alternateShortcutLabel}` : "";
    return `點擊以${FOLLOW_UP_ACTIONS[behavior]}，${modifierLabel}+點擊${shortcut}以${FOLLOW_UP_ACTIONS[alternate]}`;
  }
  return `Click to ${behavior}, ${modifierLabel}-click${alternateShortcutLabel ? ` or ${alternateShortcutLabel}` : ""} to ${alternate}`;
}

const UNDO_ACTIONS = {
  Settled: "已結束",
  Snoozed: "已延後",
  Unpinned: "已取消釘選",
  Archived: "已封存",
  Discarded: "已捨棄",
} as const;

/** The sidebar's undo notice before its Undo button, such as "Settled 2 threads". */
export function threadUndoNoticeText(notice: {
  readonly action: keyof typeof UNDO_ACTIONS;
  readonly count: number;
}): string {
  if (useChinese) {
    const noun = notice.action === "Discarded" ? "份草稿" : "個對話";
    return `${UNDO_ACTIONS[notice.action]} ${notice.count} ${noun}`;
  }
  const noun = `${notice.action === "Discarded" ? "draft" : "thread"}${notice.count === 1 ? "" : "s"}`;
  return `${notice.action} ${notice.count} ${noun}`;
}

/** The sidebar footer's short undo notice, such as "Settled 2". */
export function threadUndoNoticeShortText(notice: {
  readonly action: keyof typeof UNDO_ACTIONS;
  readonly count: number;
}): string {
  if (useChinese) {
    const action = UNDO_ACTIONS[notice.action];
    if (notice.count === 1) return action;
    return `${action} ${notice.count} ${notice.action === "Discarded" ? "份" : "個"}`;
  }
  return notice.count === 1 ? notice.action : `${notice.action} ${notice.count}`;
}

export const threadUndoNoticeSeparator = useChinese ? "，" : ", ";

/** The background work banner's verb before a single task's label. */
export function backgroundWorkVerb(waiting: boolean): string {
  if (useChinese) return waiting ? "等待中" : "執行中";
  return waiting ? "Waiting on" : "Running";
}

/** The undo notice's button, such as "⌘Z to undo". */
export function threadUndoLabelText(shortcut: string | null): string {
  if (useChinese) return shortcut ? `按 ${shortcut} 復原` : "復原";
  return shortcut ? `${shortcut} to undo` : "Undo";
}

/** The sidebar's confirmation before deleting selected threads. */
export function deleteThreadsConfirmation(count: number): string {
  if (useChinese) return `要刪除 ${count} 個對話嗎？\n這會永久清除這些對話的歷史紀錄。`;
  return [
    `Delete ${count} thread${count === 1 ? "" : "s"}?`,
    "This permanently clears conversation history for these threads.",
  ].join("\n");
}

export function runningThreadsText(running: number): string {
  if (useChinese) return `${running} 個執行中的對話`;
  return `${running} running ${running === 1 ? "thread" : "threads"}`;
}

/** An empty thought's placeholder, which reaches `remarkThoughtPreview` as a plugin option. */
export function thoughtPreviewFallbackText(english: string): string {
  if (!useChinese) return english;
  if (english === "Thinking") return "思考中";
  return english === "Thought" ? "已思考" : english;
}

const FILE_NAVIGATION = {
  sheet: "個工作表",
  page: "頁",
  slide: "張投影片",
  chapter: "章",
} as const;

/** The office viewer's paging buttons, such as "Previous slide". */
export function fileNavigationLabel(
  direction: "previous" | "next",
  navigation: keyof typeof FILE_NAVIGATION,
): string {
  if (useChinese)
    return `${direction === "previous" ? "上一" : "下一"}${FILE_NAVIGATION[navigation]}`;
  return `${direction === "previous" ? "Previous" : "Next"} ${navigation}`;
}

/** The scroll-to-end button's note of what waits below, such as "Subagent waiting · 2 queued". */
export function scrollToEndSummaryText(
  waitingLabel: string | null,
  queuedCount: number,
): string | null {
  const queued =
    queuedCount === 0 ? null : useChinese ? `${queuedCount} 則在佇列中` : `${queuedCount} queued`;
  const parts = [waitingLabel, queued];
  return parts.filter((part) => part !== null).join(" · ") || null;
}
