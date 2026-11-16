import { EnvironmentId } from "@t3tools/contracts";
import { setChineseDurations } from "@t3tools/shared/durationFormat";
import { describe, expect, it, vi } from "vite-plus/test";

import { formatWorkingTimerNow } from "./TimelineWorkGroupRows.logic";

// The working and compacting rows' timers read 已工作 30 秒, not 已工作 30s.
function timer(chinese: boolean, start: string) {
  setChineseDurations(chinese);
  try {
    return formatWorkingTimerNow(start, EnvironmentId.make("local"));
  } finally {
    setChineseDurations(false);
  }
}

describe("working timer in zh-TW", () => {
  it("names seconds in Chinese and keeps English otherwise", () => {
    using _now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-16T00:00:30Z"));
    expect(timer(false, "2026-11-16T00:00:00Z")).toBe("30s");
    expect(timer(true, "2026-11-16T00:00:00Z")).toBe("30 秒");
    expect(timer(true, "not a date")).toBe("0 秒");
    expect(timer(true, "2026-11-15T23:58:55Z")).toBe("1 分 35 秒");
  });
});
