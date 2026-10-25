import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import {
  collectAssistantCitations,
  expandAssistantCitationsForProvider,
} from "@t3tools/shared/assistantCitations";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
import { describe, expect, it } from "vite-plus/test";

import { appendAssistantCitation, assistantSelectionCitation } from "./assistantCitationQuote";
import { composerContextEditorTokens } from "./composerContext";

const source = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  messageId: MessageId.make("message-1"),
};

describe("assistantSelectionCitation", () => {
  it("quotes the selected text without image placeholders or outer whitespace", () => {
    const citation = assistantSelectionCitation({
      ...source,
      selection: {
        text: "\n \uFFFC先重建 src/index.ts 的索引\n",
        selection: { start: 40, end: 59 },
      },
    });
    expect(citation).toMatchObject({
      ...source,
      text: "先重建 src/index.ts 的索引",
      start: 43,
      end: 43 + "先重建 src/index.ts 的索引".length,
      prefix: "",
      suffix: "",
    });
  });

  it("rejects empty and oversized selections", () => {
    expect(
      assistantSelectionCitation({
        ...source,
        selection: { text: " \uFFFC\n", selection: { start: 0, end: 3 } },
      }),
    ).toBeNull();
    expect(
      assistantSelectionCitation({
        ...source,
        selection: { text: "字".repeat(8_001), selection: { start: 0, end: 8_001 } },
      }),
    ).toBe("too-long");
  });
});

describe("appendAssistantCitation", () => {
  it("adds a citation the composer shows as one chip and the provider reads as a quote", () => {
    const citation = assistantSelectionCitation({
      ...source,
      selection: { text: "改 apps/mobile/src/app.ts", selection: { start: 0, end: 24 } },
    });
    if (citation === null || citation === "too-long") throw new Error("expected a citation");
    const draft = appendAssistantCitation(appendAssistantCitation("為什麼", citation), citation);

    expect(draft.startsWith("為什麼 [Assistant quote](t3-citation://")).toBe(true);
    expect(draft.endsWith(") ")).toBe(true);
    expect(collectAssistantCitations(draft).map((match) => match.citation)).toEqual([
      citation,
      citation,
    ]);
    const tokens = composerContextEditorTokens(
      draft,
      collectComposerInlineTokens(draft),
      new Set(),
    );
    expect(tokens.map((token) => [token.type, token.value])).toEqual([
      ["citation", "改 apps/mobile/src/app.ts"],
      ["citation", "改 apps/mobile/src/app.ts"],
    ]);
    for (const token of tokens) expect(draft.slice(token.start, token.end)).toBe(token.source);
    expect(expandAssistantCitationsForProvider(draft)).toContain(
      '"text": "改 apps/mobile/src/app.ts"',
    );
  });
});
