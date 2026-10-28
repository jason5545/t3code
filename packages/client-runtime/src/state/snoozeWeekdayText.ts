import type { SnoozePresetDay } from "@t3tools/contracts/settings";
import { usesChineseDurations } from "@t3tools/shared/durationFormat";

/**
 * zh-TW names for snooze menu weekdays. The English label capitalizes the setting's
 * literal, which the build-time translation pass cannot reach; this package follows
 * the clients' startup locale through `setChineseDurations`.
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
