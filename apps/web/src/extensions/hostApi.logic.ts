import { arrayElementsEqual } from "@t3tools/client-runtime/state/entities";
import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import {
  summarizeThreadShell,
  type ExtensionProjectInfo,
  type ExtensionThreadSummary,
} from "@t3tools/shared/extensionApi";

const EMPTY: ReadonlyArray<ExtensionThreadSummary> = [];

/**
 * Fork patch 30: `t3.threads.use()`. Every environment's threads, archived and deleted ones
 * left out, newest update first. An unchanged list is the previous array, so a board that
 * memoizes on it skips the render.
 */
export function collectThreadSummaries(
  environments: ReadonlyArray<{
    readonly environmentId: string;
    readonly snapshot: Pick<OrchestrationV2ShellSnapshot, "threads" | "projects"> | null;
  }>,
  previous: ReadonlyArray<ExtensionThreadSummary> | null,
): ReadonlyArray<ExtensionThreadSummary> {
  const next: Array<ExtensionThreadSummary> = [];
  for (const { environmentId, snapshot } of environments) {
    if (snapshot === null) continue;
    const projects = new Map<string, ExtensionProjectInfo>(
      snapshot.projects.map((project) => [project.id, project]),
    );
    for (const thread of snapshot.threads) {
      if (thread.deletedAt !== null || thread.archivedAt !== null) continue;
      next.push(
        summarizeThreadShell(thread, environmentId, projects.get(thread.projectId) ?? null),
      );
    }
  }
  if (next.length === 0) return EMPTY;
  next.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return previous !== null && arrayElementsEqual(previous, next) ? previous : next;
}
