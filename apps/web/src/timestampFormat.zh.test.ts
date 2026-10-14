import { setChineseDurations } from "@t3tools/shared/durationFormat";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./locale/autoTranslateRuntime", () => ({ useChinese: true }));

const {
  formatCompactRelativeTime,
  formatElapsedDurationLabel,
  formatRelativeTime,
  formatRelativeTimeLabel,
  formatRelativeTimeUntilLabel,
} = await import("./timestampFormat");

describe("relative time in zh-TW", () => {
  beforeEach(() => {
    setChineseDurations(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    setChineseDurations(false);
  });

  it("uses Chinese units with 前 attached", () => {
    expect(formatRelativeTimeLabel("2026-04-07T11:59:30.000Z")).toBe("剛剛");
    expect(formatRelativeTimeLabel("2026-04-07T11:55:00.000Z")).toBe("5 分鐘前");
    expect(formatRelativeTimeLabel("2026-04-07T10:00:00.000Z")).toBe("2 小時前");
    expect(formatRelativeTimeLabel("2026-04-04T12:00:00.000Z")).toBe("3 天前");
  });

  it("leaves no suffix for callers that render value and suffix with a space", () => {
    expect(formatRelativeTime("2026-04-07T11:55:00.000Z")).toEqual({
      value: "5 分鐘前",
      suffix: "",
    });
  });

  it("drops 前 in the compact form used by narrow columns", () => {
    expect(formatCompactRelativeTime("2026-04-07T11:59:30.000Z")).toBe("剛剛");
    expect(formatCompactRelativeTime("2026-04-07T11:55:00.000Z")).toBe("5 分鐘");
  });

  it("uses Chinese units for elapsed durations", () => {
    expect(formatElapsedDurationLabel("2026-04-07T12:00:00.000Z")).toBe("剛剛");
    expect(formatElapsedDurationLabel("2026-04-07T11:59:30.000Z")).toBe("30 秒");
    expect(formatElapsedDurationLabel("2026-04-07T11:57:00.000Z")).toBe("3 分鐘");
  });

  it("reads future instants as 後, 即將到期 and 已過期", () => {
    expect(formatRelativeTimeUntilLabel("2026-04-07T12:05:00.000Z")).toBe("5 分鐘後");
    expect(formatRelativeTimeUntilLabel("2026-04-07T12:00:02.000Z")).toBe("即將到期");
    expect(formatRelativeTimeUntilLabel("2026-04-07T11:59:00.000Z")).toBe("已過期");
  });
});
