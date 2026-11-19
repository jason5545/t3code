import { afterEach, describe, expect, it } from "vite-plus/test";

import { formatDurationUnits, setChineseDurations } from "./durationFormat.ts";
import { formatDuration } from "./orchestrationTiming.ts";

afterEach(() => {
  setChineseDurations(false);
});

describe("formatDurationUnits", () => {
  it("keeps compact English units by default", () => {
    expect(formatDurationUnits([5, "m"])).toBe("5m");
    expect(formatDurationUnits([5, "m"], ["03", "s"])).toBe("5m 03s");
    expect(formatDuration(3_723_000)).toBe("1h 2m 3s");
  });

  it("uses Chinese units once a client switches them on", () => {
    setChineseDurations(true);
    expect(formatDurationUnits([5, "m"])).toBe("5 分鐘");
    expect(formatDurationUnits([5, "m"], ["03", "s"])).toBe("5 分 03 秒");
    expect(formatDuration(850)).toBe("850 毫秒");
    expect(formatDuration(3_723_000)).toBe("1 小時 2 分 3 秒");
  });
});
