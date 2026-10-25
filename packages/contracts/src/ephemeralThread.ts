/**
 * Ephemeral threads (fork patch 11): created only in Scratch, on an OMP instance
 * running a model served from this machine, and purged instead of soft deleted
 * when they end. Their text never reaches a hosted model or a notification.
 */

/** No running run and no new message for this long ends the conversation. */
export const EPHEMERAL_THREAD_IDLE_MS = 60 * 60 * 1000;

/** Replaces an ephemeral thread's title and content wherever text leaves T3. */
export const EPHEMERAL_THREAD_PLACEHOLDER_TEXT = "無痕對話";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** True when a provider endpoint is on this machine's loopback interface. */
export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(baseUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

const TITLE_MAX_LENGTH = 50;

/** The first line of the first message, so no model is asked to title the thread. */
export function ephemeralThreadTitle(text: string): string {
  const firstLine =
    text
      .split(/\r?\n/u)
      .map((line) => line.trim().replace(/\s+/gu, " "))
      .find((line) => line.length > 0) ?? "";
  if (firstLine.length === 0) return "New thread";
  return firstLine.length <= TITLE_MAX_LENGTH
    ? firstLine
    : `${firstLine.slice(0, TITLE_MAX_LENGTH)}...`;
}
