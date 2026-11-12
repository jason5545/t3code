import { builtInExtension } from "@t3tools/shared/builtInExtensions";
import { createExtensionHost } from "@t3tools/shared/extensions";

import { SummarizedUpdateBadge } from "../components/chat/SummarizedUpdateBadge";
import type { ChatMessage } from "../types";
import { createExtensionSlot, type SlotComponents } from "./ExtensionSlot";

export interface TimelineSlots {
  /** Between an assistant message's author heading and its text. */
  readonly "timeline.assistantMessage": { readonly message: ChatMessage };
}

export const TimelineSlot = createExtensionSlot(
  createExtensionHost<SlotComponents<TimelineSlots>>([
    {
      ...builtInExtension("summarized-update-badge"),
      contributes: { "timeline.assistantMessage": [SummarizedUpdateBadge] },
    },
  ]),
);
