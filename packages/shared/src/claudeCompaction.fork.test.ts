import { describe, expect, it } from "vite-plus/test";

import {
  claudeResumeCompactionAge,
  formatClaudeResumeCompactionQuestion,
} from "./claudeCompaction.ts";
import { setChineseDurations } from "./durationFormat.ts";

// The question stays English for the adapter; the age it carries reads 閒置 1 小時 5 分 in clients.
function age(chinese: boolean, ageMinutes: number) {
  const question = formatClaudeResumeCompactionQuestion({ ageMinutes, estimatedTokens: 250_000 });
  setChineseDurations(chinese);
  try {
    return claudeResumeCompactionAge({ answers: { [question]: "Compact and continue" } });
  } finally {
    setChineseDurations(false);
  }
}

describe("resume compaction age in zh-TW", () => {
  it("names the age in Chinese and keeps English otherwise", () => {
    expect(age(false, 65)).toBe("1h 5m");
    expect(age(false, 45)).toBe("45m");
    expect(age(true, 65)).toBe("1 小時 5 分");
    expect(age(true, 45)).toBe("45 分鐘");
  });
});
