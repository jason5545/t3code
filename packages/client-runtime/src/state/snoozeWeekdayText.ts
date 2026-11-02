import type { SnoozePresetDay } from "@t3tools/contracts/settings";
import { usesChineseDurations } from "@t3tools/shared/durationFormat";

/**
 * zh-TW snooze menu weekdays and durations. The English labels capitalize the setting's
 * literal or pluralize a unit, which the build-time translation pass cannot reach; this
 * package follows the clients' startup locale through `setChineseDurations`.
 */
const WEEKDAYS: Record<SnoozePresetDay, string> = {
  today: "今天",
  tomorrow: "明天",
  monday: "星期一",
  tuesday: "星期二",
  wednesday: "星期三",
  thursday: "星期四",
  friday: "星期五",
  saturday: "星期六",
  sunday: "星期日",
};

/** The weekday's name, or null in English. */
export function localizedSnoozeWeekday(day: SnoozePresetDay): string | null {
  return usesChineseDurations() ? WEEKDAYS[day] : null;
}

/** "3 小時", "90 分鐘", "2 天": the largest unit that divides evenly, or null in English. */
export function localizedSnoozeDuration(minutes: number): string | null {
  if (!usesChineseDurations()) return null;
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} 天`;
  if (minutes % 60 === 0) return `${minutes / 60} 小時`;
  return `${minutes} 分鐘`;
}
