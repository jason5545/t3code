import { useAtomValue } from "@effect/atom-react";

import { undoLatestThreadAction, useThreadUndoNotice } from "../../hooks/showThreadUndoNotice";
import { shortcutLabelForCommand } from "../../keybindings";
import { useChinese } from "../../locale/autoTranslateRuntime";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Alert, AlertDescription } from "../ui/alert";
import { InlineButton } from "../ui/button";

// The action and noun are values, so build-time translation cannot reorder them.
const CHINESE_ACTIONS = {
  Settled: "已結束",
  Snoozed: "已延後",
  Unpinned: "已取消釘選",
  Archived: "已封存",
  Discarded: "已捨棄",
} as const;

export function SidebarThreadUndoNotice() {
  const notice = useThreadUndoNotice((state) => state.notice);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  if (!notice) return null;
  const shortcut = shortcutLabelForCommand(keybindings, "thread.undo");
  const noun = `${notice.action === "Discarded" ? "draft" : "thread"}${notice.count === 1 ? "" : "s"}`;

  return (
    <Alert role="status" variant="sidebar">
      <AlertDescription>
        {useChinese
          ? `${CHINESE_ACTIONS[notice.action]} ${notice.count} ${notice.action === "Discarded" ? "份草稿" : "個對話"}，`
          : `${notice.action} ${notice.count} ${noun}, `}
        <InlineButton onClick={undoLatestThreadAction}>
          {shortcut ? `${shortcut} to undo` : "Undo"}
        </InlineButton>
      </AlertDescription>
    </Alert>
  );
}
