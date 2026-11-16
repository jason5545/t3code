import { setChineseDurations } from "@t3tools/shared/durationFormat";
import { describe, expect, it } from "vite-plus/test";

import { formatUpdateElapsed } from "./updateEverything.logic";

// The update capsule's slow indicator reads 3 分鐘, not 3m.
function elapsed(chinese: boolean, ms: number) {
  setChineseDurations(chinese);
  try {
    return formatUpdateElapsed(ms);
  } finally {
    setChineseDurations(false);
  }
}

describe("update elapsed in zh-TW", () => {
  it("names the elapsed time in Chinese and keeps English otherwise", () => {
    expect(elapsed(false, 30_000)).toBe("<1m");
    expect(elapsed(false, 3 * 60_000)).toBe("3m");
    expect(elapsed(false, 65 * 60_000)).toBe("1h 5m");
    expect(elapsed(true, 30_000)).toBe("<1 分鐘");
    expect(elapsed(true, 3 * 60_000)).toBe("3 分鐘");
    expect(elapsed(true, 65 * 60_000)).toBe("1 小時 5 分");
  });
});
