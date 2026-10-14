import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./locale/autoTranslateRuntime", () => ({ useChinese: true }));

const {
  formatElapsedDurationLabel,
  formatRelativeTime,
  formatRelativeTimeLabel,
  RELATIVE_TIME_AGO_SUFFIX,
} = await import("./timestampFormat");

describe("relative time in zh-TW", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("keeps the ending strippable for the compact sidebar label", () => {
    const label = formatRelativeTimeLabel("2026-04-07T11:55:00.000Z");
    expect(label.endsWith(RELATIVE_TIME_AGO_SUFFIX)).toBe(true);
    expect(label.slice(0, -RELATIVE_TIME_AGO_SUFFIX.length)).toBe("5 分鐘");
  });

  it("uses Chinese units for elapsed durations", () => {
    expect(formatElapsedDurationLabel("2026-04-07T12:00:00.000Z")).toBe("剛剛");
    expect(formatElapsedDurationLabel("2026-04-07T11:59:30.000Z")).toBe("30 秒");
    expect(formatElapsedDurationLabel("2026-04-07T11:57:00.000Z")).toBe("3 分鐘");
  });
});
