import { useChinese } from "./autoTranslateRuntime";

/*
 * Sentences built around values the code compares. The build-time pass keeps a
 * template's values as they are, so these helpers pick the language instead.
 */

const UNDO_ACTIONS = { Settled: "已結束", Snoozed: "已延後", Unpinned: "已取消釘選" } as const;

/** The home screen's undo toast, such as "Settled thread". */
export function threadUndoNoticeText(action: keyof typeof UNDO_ACTIONS): string {
  return useChinese ? `${UNDO_ACTIONS[action]}對話` : `${action} thread`;
}

/** The scheduled task Destination footer when runs share one thread. */
export function scheduledTaskDestinationFooter(continues: boolean, threadPending: boolean): string {
  if (useChinese) {
    return `${
      continues
        ? "每次執行都接續同一段對話。"
        : "每次執行都在同一個對話裡，各自開新的工作階段，不帶先前執行的脈絡。"
    }${threadPending ? "第一次執行時會建立這個對話。" : ""}刪除對話也會刪除這個排程工作。`;
  }
  return `${
    continues
      ? "Runs continue one conversation."
      : "Runs share one thread, each in a fresh session without earlier runs' context."
  }${threadPending ? " The first run starts the thread." : ""} Deleting it also deletes this task.`;
}
