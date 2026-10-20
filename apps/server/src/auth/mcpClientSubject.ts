export const MCP_CLIENT_SUBJECT = "mcp-client";

/**
 * Fork patch 7: an MCP sign-in approved for a tagged tailnet node records the
 * node in its subject (`mcp-client:tailscale:<node>`) so revoking it can stop
 * the next automatic approval. Every check that confines MCP sessions to
 * `/mcp` goes through here, so the suffixed form stays confined too.
 */
export const isMcpClientSubject = (subject: string): boolean =>
  subject === MCP_CLIENT_SUBJECT || subject.startsWith(`${MCP_CLIENT_SUBJECT}:`);
