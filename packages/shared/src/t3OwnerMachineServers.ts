// Fork patch 22: Claude Code reaches the owner's other T3 servers as `t3-hub`, `t3-fr`, `t3-mac`.
const OWNER_MACHINE_SERVER = /^(mcp__)?t3[-_](?!code(?:$|[-_]))[a-z0-9]+(__|[.:/])/i;

/** Reads a tool on one of the owner's other T3 servers as the same tool on `t3-code`. */
export function asT3CodeServerName(label: string): string {
  return label.replace(
    OWNER_MACHINE_SERVER,
    (_match, mcp: string | undefined, separator: string) => `${mcp ?? ""}t3-code${separator}`,
  );
}
