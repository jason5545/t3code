import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./locale/autoTranslateRuntime", () => ({ useChinese: true }));

const { formatElapsedDurationLabel, formatRelativeTimeLabel, RELATIVE_TIME_AGO } =
  await import("./timestampFormat");

describe("relative time in zh-TW", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("translates just now and the ago suffix", () => {
    expect(formatRelativeTimeLabel("2026-04-07T11:59:30.000Z")).toBe("剛剛");
    expect(formatRelativeTimeLabel("2026-04-07T11:55:00.000Z")).toBe("5m 前");
    expect(formatElapsedDurationLabel("2026-04-07T12:00:00.000Z")).toBe("剛剛");
  });

  it("keeps the suffix strippable for the compact sidebar label", () => {
    const label = formatRelativeTimeLabel("2026-04-07T10:00:00.000Z");
    expect(label.endsWith(` ${RELATIVE_TIME_AGO}`)).toBe(true);
    expect(label.slice(0, -(RELATIVE_TIME_AGO.length + 1))).toBe("2h");
  });
});
