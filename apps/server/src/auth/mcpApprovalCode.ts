import * as Duration from "effect/Duration";

/**
 * Fork patch: a pairing code made only for MCP approvals keeps its options in
 * the pairing link's `subject`, because a fork migration would collide with
 * upstream's numbered ones.
 */
const SUBJECT_PREFIX = "mcp-approval";

export interface McpApprovalCodeOptions {
  /** How long sign-ins approved with the code last, instead of the MCP default. */
  readonly sessionTtl?: Duration.Duration;
  /** Approving does not spend the code; it lasts until it expires or is revoked. */
  readonly reusable: boolean;
}

export const encodeMcpApprovalSubject = (options: McpApprovalCodeOptions): string =>
  [
    SUBJECT_PREFIX,
    ...(options.sessionTtl === undefined ? [] : [`ttl=${Duration.toMillis(options.sessionTtl)}`]),
    ...(options.reusable ? ["reusable"] : []),
  ].join(";");

export const decodeMcpApprovalSubject = (subject: string): McpApprovalCodeOptions | undefined => {
  const [prefix, ...parts] = subject.split(";");
  if (prefix !== SUBJECT_PREFIX) return undefined;
  const ttlMillis = Number(parts.find((part) => part.startsWith("ttl="))?.slice("ttl=".length));
  return {
    ...(Number.isSafeInteger(ttlMillis) && ttlMillis > 0
      ? { sessionTtl: Duration.millis(ttlMillis) }
      : {}),
    reusable: parts.includes("reusable"),
  };
};
