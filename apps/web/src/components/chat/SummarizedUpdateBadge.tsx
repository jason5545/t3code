import { Badge } from "../ui/badge";
import type { TimelineSlots } from "../../extensions/timeline";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SummarizedUpdateBadge({ message }: TimelineSlots["timeline.assistantMessage"]) {
  if (message.summarized !== true) return null;
  return (
    <div className="mb-1">
      <Tooltip>
        <TooltipTrigger render={<Badge variant="outline" size="sm" />}>Summary</TooltipTrigger>
        <TooltipPopup side="top">
          This update is a summary from the provider, not what the agent wrote.
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
