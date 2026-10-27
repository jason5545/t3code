/**
 * Settings list rows pass their title as an argument to upstream's `page` helper, a position the
 * build-time pass does not translate, so the helper looks the title up here.
 */
export const SETTINGS_PAGE_LABELS: Readonly<Record<string, string>> = {
  General: "General",
  Appearance: "Appearance",
  Chat: "Chat",
  "Navigation tabs": "Navigation tabs",
  Keyboard: "Keyboard",
  Microphone: "Microphone",
  Providers: "Providers",
  Threads: "Threads",
  "Scheduled tasks": "Scheduled tasks",
  Projects: "Projects",
  "Source control": "Source control",
  Worktrees: "Worktrees",
  Maintenance: "Maintenance",
  Labs: "Labs",
  About: "About",
  Archive: "Archive",
};

export function settingsPageLabel(label: string): string {
  return SETTINGS_PAGE_LABELS[label] ?? label;
}
