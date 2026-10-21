import type * as Duration from "effect/Duration";

export const MCP_CLIENT_SUBJECT = "mcp-client";

/** What an approval sets for the MCP session it leads to, beyond the access granted. */
export interface McpClientSessionOptions {
  /** From an approval code made with `--session-ttl`. */
  readonly ttl?: Duration.Duration;
  /** A tailnet node's subject, for a tagged node approved without a person. */
  readonly subject?: string;
}

/**
 * Fork patch 7: an MCP sign-in approved for a tagged tailnet node records the
 * node in its subject (`mcp-client:tailscale:<node>`) so revoking it can stop
 * the next automatic approval. Every check that confines MCP sessions to
 * `/mcp` goes through here, so the suffixed form stays confined too.
 */
export const isMcpClientSubject = (subject: string): boolean =>
  subject === MCP_CLIENT_SUBJECT || subject.startsWith(`${MCP_CLIENT_SUBJECT}:`);

/** The subject of a new MCP session: the tailnet node's when one is given, else the plain one. */
export const mcpClientSessionSubject = (subject: string | undefined): string =>
  subject !== undefined && isMcpClientSubject(subject) ? subject : MCP_CLIENT_SUBJECT;
