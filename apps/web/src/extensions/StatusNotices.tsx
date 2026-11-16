import { TriangleAlertIcon } from "lucide-react";

import {
  getArm64IntelBuildWarningDescription,
  shouldShowArm64IntelBuildWarning,
} from "../components/desktopUpdate.logic";
import { SidebarProviderUpdatePill } from "../components/sidebar/SidebarProviderUpdatePill";
import { SidebarThreadUndoNotice } from "../components/sidebar/SidebarThreadUndoNotice";
import { SidebarUpdatePill } from "../components/sidebar/SidebarUpdatePill";
import { SidebarMenu } from "../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { isElectron } from "../env";
import { useThreadUndoNotice } from "../hooks/showThreadUndoNotice";
import { cn } from "../lib/utils";
import { useDesktopUpdateState } from "../state/desktopUpdate";

/**
 * Fork patch 30: `t3.components.StatusNotices`, the sidebar footer's notices for an interface
 * without the sidebar. Upstream's own components, so Update all works as in the sidebar, on the
 * app's sidebar colours. The Intel-build paragraph becomes an icon with it in the tooltip.
 */
export function StatusNotices() {
  const undoShown = useThreadUndoNotice((state) => state.notice !== null);
  return (
    <div className="flex h-8 max-w-[34rem] min-w-0 shrink items-center gap-1 rounded-md bg-sidebar px-1 text-sidebar-foreground [&:not(:has(li,button,[role=img]))]:hidden">
      <div className="w-56 min-w-0 shrink empty:hidden">
        <SidebarProviderUpdatePill />
      </div>
      {isElectron ? <IntelBuildWarning /> : null}
      <SidebarMenu className={cn("min-w-0 flex-row items-center", undoShown && "w-56 shrink")}>
        <SidebarThreadUndoNotice />
        <SidebarUpdatePill />
      </SidebarMenu>
    </div>
  );
}

function IntelBuildWarning() {
  const state = useDesktopUpdateState();
  if (!state || !shouldShowArm64IntelBuildWarning(state)) return null;
  const description = getArm64IntelBuildWarningDescription(state);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={description}
            className="inline-flex size-8 shrink-0 items-center justify-center text-warning"
            role="img"
          />
        }
      >
        <TriangleAlertIcon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <div className="font-medium">Intel build on Apple Silicon</div>
        <div className="text-muted-foreground">{description}</div>
      </TooltipPopup>
    </Tooltip>
  );
}
