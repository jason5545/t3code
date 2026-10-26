import { ChevronRightIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { cn } from "~/lib/utils";

/** Fork patch 20: folds or unfolds the settled threads a thread launched. */
export function SidebarLaunchedThreadsToggle(props: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const handleClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onToggle();
  };
  const stop = (event: ReactMouseEvent | ReactPointerEvent) => event.stopPropagation();
  return (
    <button
      type="button"
      aria-expanded={props.expanded}
      aria-label={props.expanded ? "Hide launched threads" : "Show launched threads"}
      onClick={handleClick}
      onDoubleClick={stop}
      onPointerDown={stop}
      className="inline-flex h-5 shrink-0 cursor-pointer items-center gap-0.5 rounded-sm px-1 text-xs text-muted-foreground tabular-nums outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <ChevronRightIcon
        aria-hidden
        className={cn("size-3 transition-transform", props.expanded && "rotate-90")}
      />
      {props.count}
    </button>
  );
}
