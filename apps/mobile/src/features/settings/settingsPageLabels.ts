/**
 * Settings list rows pass their title as an argument to upstream's `page` helper, a position the
 * build-time pass does not translate, so the helper looks the title up here.
 */
export const SETTINGS_PAGE_LABELS: Readonly<Record<string, string>> = {
  Appearance: "Appearance",
  "Navigation tabs": "Navigation tabs",
  Keyboard: "Keyboard",
  Microphone: "Microphone",
  "Scheduled tasks": "Scheduled tasks",
  Overview: "Overview",
  Organization: "Organization",
  "Thread behavior": "Thread behavior",
  "Follow-ups": "Follow-ups",
  "Archived Threads": "Archived Threads",
  "Provider accounts": "Provider accounts",
  "New threads": "New threads",
  "Source control": "Source control",
  "Agent behavior": "Agent behavior",
  Maintenance: "Maintenance",
  "About T3 Code": "About T3 Code",
};

export function settingsPageLabel(label: string): string {
  return SETTINGS_PAGE_LABELS[label] ?? label;
}
