import type {
  ProviderConsumeResetCreditInput,
  ServerProviderResetCredits,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { setChineseDurations } from "./durationFormat.ts";
import { resetCreditChoices } from "./usageLimits.ts";

const now = Date.parse("2026-11-12T00:00:00.000Z");
const instanceInput = { instanceId: "claude" } as unknown as ProviderConsumeResetCreditInput;
const optionCredits = {
  availableCount: 3,
  options: [
    {
      creditId: "weekly-1",
      label: "Weekly reset",
      description: "Refills your weekly limit.",
      availableCount: 2,
      expiresAt: "2026-11-14T03:00:00.000Z",
    },
    { creditId: "new-1", label: "Monthly reset", description: "New kind.", availableCount: 1 },
  ],
} as unknown as ServerProviderResetCredits;
const legacyCredits = {
  availableCount: 1,
  nextExpiresAt: "2026-11-12T05:30:00.000Z",
} as unknown as ServerProviderResetCredits;

const shape = (choices: ReturnType<typeof resetCreditChoices>) =>
  choices.map(({ key, availableCount, input }) => ({ key, availableCount, input }));

describe("resetCreditChoices in zh-TW", () => {
  afterEach(() => setChineseDurations(false));

  it("offers the same credits as English, in Chinese", () => {
    for (const [credits, input, compact] of [
      [optionCredits, instanceInput, false],
      [legacyCredits, instanceInput, true],
      [{ availableCount: 0 } as unknown as ServerProviderResetCredits, instanceInput, false],
    ] as const) {
      const english = resetCreditChoices(credits, input, now, compact);
      setChineseDurations(true);
      const chinese = resetCreditChoices(credits, input, now, compact);
      setChineseDurations(false);
      expect(shape(chinese)).toEqual(shape(english));
    }
    setChineseDurations(true);
    expect(resetCreditChoices(optionCredits, instanceInput, now).map((c) => c.summary)).toEqual([
      "每週重設 · 剩 2 個 · 2 天 3 小時後到期",
      "Monthly reset · 剩 1 個",
    ]);
    expect(resetCreditChoices(legacyCredits, instanceInput, now, true)[0]?.summary).toBe(
      "已累積 1 個 · 5 小時 30 分後到期",
    );
  });
});
