import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  AssistantCitation,
  type EnvironmentId,
  type MessageId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  assistantCitationLabel,
  collectAssistantCitations,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** What the native selection menu reports: the selected text and its offsets in one rendered block. */
export interface AssistantTextSelection {
  readonly text: string;
  readonly selection: { readonly start: number; readonly end: number };
}

const decodeCitation = Schema.decodeUnknownOption(AssistantCitation);

/**
 * The offsets are block-relative and the selection carries no context, so web can navigate to
 * the source only when the quote occurs once in the response; the quote itself is always kept.
 */
export function assistantSelectionCitation(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly selection: AssistantTextSelection;
}): AssistantCitation | "too-long" | null {
  // U+FFFC stands in for images and pills drawn inside the text.
  const leading = /^[\s\uFFFC]*/.exec(input.selection.text)?.[0].length ?? 0;
  const text = input.selection.text.replaceAll("\uFFFC", "").trim();
  if (text.length === 0) return null;
  if (text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH) return "too-long";
  const start = Math.max(0, input.selection.selection.start) + leading;
  return Option.getOrNull(
    decodeCitation({
      version: 1,
      environmentId: input.environmentId,
      threadId: input.threadId,
      messageId: input.messageId,
      text,
      start,
      end: start + text.length,
      prefix: "",
      suffix: "",
    }),
  );
}

export function appendAssistantCitation(draft: string, citation: AssistantCitation): string {
  const separator = draft.length === 0 || /\s$/.test(draft) ? "" : " ";
  return `${draft}${separator}${serializeAssistantCitation(citation)} `;
}

export function assistantCitationEditorTokens(text: string) {
  return collectAssistantCitations(text).map((match) => ({
    type: "citation" as const,
    value: assistantCitationLabel(match.citation),
    source: match.source,
    start: match.start,
    end: match.end,
  }));
}

export function assistantCitationMenuItems(onCite: (selection: AssistantTextSelection) => void) {
  const citeLabel = "Cite";
  return [{ text: citeLabel, icon: "text.quote", onPress: onCite }];
}
