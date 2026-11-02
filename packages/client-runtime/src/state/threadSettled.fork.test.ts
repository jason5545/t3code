// @effect-diagnostics globalDate:off -- resolveSnoozePreset takes a local Date.
import { setChineseDurations } from "@t3tools/shared/durationFormat";
import { describe, expect, it } from "@effect/vitest";

import { resolveSnoozePreset } from "./threadSettled.ts";

// The build-time pass turns `In {0}` into `{0}後`; it cannot reach the duration inside.
function durationLabel(chinese: boolean, minutes: number) {
  setChineseDurations(chinese);
  try {
    return resolveSnoozePreset({ kind: "after", minutes }, new Date(2026, 10, 2, 9))?.label;
  } finally {
    setChineseDurations(false);
  }
}

describe("snooze durations in zh-TW", () => {
  it("names the duration in Chinese and keeps English otherwise", () => {
    expect(durationLabel(false, 180)).toBe("In 3 hours");
    expect(durationLabel(true, 60)).toBe("In 1 小時");
    expect(durationLabel(true, 180)).toBe("In 3 小時");
    expect(durationLabel(true, 90)).toBe("In 90 分鐘");
    expect(durationLabel(true, 2 * 24 * 60)).toBe("In 2 天");
  });
});
