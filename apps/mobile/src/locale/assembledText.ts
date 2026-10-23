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
