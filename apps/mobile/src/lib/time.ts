import { formatDurationUnits } from "@t3tools/shared/durationFormat";

export function relativeTime(input: string): string {
  const timestamp = Date.parse(input);
  if (Number.isNaN(timestamp)) {
    return `<${formatDurationUnits([1, "m"])}`;
  }

  // Anything under a minute renders as "<1m" rather than a live seconds count.
  // The seconds ticker changed width every second and reflowed the surrounding row.
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return `<${formatDurationUnits([1, "m"])}`;

  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return formatDurationUnits([deltaMinutes, "m"]);

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return formatDurationUnits([deltaHours, "h"]);

  const deltaDays = Math.floor(deltaHours / 24);
  return formatDurationUnits([deltaDays, "d"]);
}
