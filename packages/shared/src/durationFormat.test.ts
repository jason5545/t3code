import { afterEach, describe, expect, it } from "vite-plus/test";

import { formatDurationUnits, setChineseDurations } from "./durationFormat.ts";
import { formatDuration } from "./orchestrationTiming.ts";
import { formatResetsIn } from "./usageLimits.ts";

const now = Date.parse("2026-09-03T12:00:00.000Z");
const window = {
  id: "five_hour",
  kind: "session",
  label: "Session",
  usedPercent: 40,
  windowDurationMins: 300,
  resetsAt: "2026-09-03T14:13:00.000Z",
} as const;

afterEach(() => {
  setChineseDurations(false);
});

describe("formatDurationUnits", () => {
  it("keeps compact English units by default", () => {
    expect(formatDurationUnits([5, "m"])).toBe("5m");
    expect(formatDurationUnits([5, "m"], ["03", "s"])).toBe("5m 03s");
    expect(formatDuration(3_723_000)).toBe("1h 2m 3s");
    expect(formatResetsIn(window, now)).toBe("resets in 2h 13m");
  });

  it("uses Chinese units once a client switches them on", () => {
    setChineseDurations(true);
    expect(formatDurationUnits([5, "m"])).toBe("5 分鐘");
    expect(formatDurationUnits([5, "m"], ["03", "s"])).toBe("5 分 03 秒");
    expect(formatDuration(850)).toBe("850 毫秒");
    expect(formatDuration(3_723_000)).toBe("1 小時 2 分 3 秒");
    expect(formatResetsIn(window, now)).toBe("2 小時 13 分後重設");
    expect(formatResetsIn({ ...window, resetsAt: "2026-09-03T12:00:30.000Z" }, now)).toBe(
      "即將重設",
    );
  });
});
