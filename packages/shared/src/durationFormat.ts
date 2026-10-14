/**
 * Time units for durations and countdowns shown in clients. The build-time
 * translation pass does not reach this package, so web and mobile switch it to
 * Traditional Chinese at startup; the server and tests keep English.
 */
export type DurationUnit = "ms" | "s" | "m" | "h" | "d";

const ENGLISH_UNITS: Record<DurationUnit, string> = { ms: "ms", s: "s", m: "m", h: "h", d: "d" };
const CHINESE_UNITS: Record<DurationUnit, string> = {
  ms: " 毫秒",
  s: " 秒",
  m: " 分鐘",
  h: " 小時",
  d: " 天",
};

let chinese = false;

/** Called once by each client's locale runtime. */
export function setChineseDurations(enabled: boolean): void {
  chinese = enabled;
}

export function usesChineseDurations(): boolean {
  return chinese;
}

/**
 * `formatDurationUnits([5, "m"])` reads "5m" or "5 分鐘"; several parts join
 * with spaces ("2h 5m", "2 小時 5 分"). Chinese shortens minutes to 分 beside
 * another unit, as in "5 分 03 秒".
 */
export function formatDurationUnits(
  ...parts: ReadonlyArray<readonly [amount: number | string, unit: DurationUnit]>
): string {
  return parts
    .map(([amount, unit]) => {
      const suffix = chinese
        ? unit === "m" && parts.length > 1
          ? " 分"
          : CHINESE_UNITS[unit]
        : ENGLISH_UNITS[unit];
      return `${amount}${suffix}`;
    })
    .join(" ");
}
