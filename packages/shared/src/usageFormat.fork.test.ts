import { afterEach, describe, expect, it } from "vite-plus/test";

import { setChineseDurations } from "./durationFormat.ts";
import { formatRelativeHourShort } from "./usageFormat.ts";

describe("formatRelativeHourShort in zh-TW", () => {
  afterEach(() => setChineseDurations(false));

  it("names today and yesterday in Chinese before the hour", () => {
    setChineseDurations(true);
    const reference = "2026-04-07T12:00:00.000Z";
    expect(formatRelativeHourShort("2026-04-07T09:00:00.000Z", reference, "UTC", false)).toBe(
      "今天 09:00",
    );
    expect(formatRelativeHourShort("2026-04-06T09:00:00.000Z", reference, "UTC", false)).toBe(
      "昨天 09:00",
    );
  });
});
