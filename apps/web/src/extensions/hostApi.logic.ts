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

/** Since API 3: T3's pages an extension opens by name, never by path. */
export const EXTENSION_PAGES = ["home", "settings", "usage", "pullRequests"] as const;
export type ExtensionPage = (typeof EXTENSION_PAGES)[number];

/** Since API 3: what the standard sidebar's header buttons do, by name. */
export const EXTENSION_ACTIONS = [
  "newThread",
  "newThreadInProject",
  "addProject",
  "search",
] as const;
export type ExtensionAction = (typeof EXTENSION_ACTIONS)[number];

/** A name an extension passed, checked against the table; anything else is a TypeError. */
export function readExtensionName<const Name extends string>(
  names: ReadonlyArray<Name>,
  name: unknown,
  caller: string,
): Name {
  const known: ReadonlyArray<unknown> = names;
  if (typeof name === "string" && known.includes(name)) return name as Name;
  throw new TypeError(`${caller} takes ${names.slice(0, -1).join(", ")} or ${names.at(-1) ?? ""}.`);
}

/** The sidebar shows Pull requests only where the environment can list them. */
export function availableExtensionPages(
  pullRequestsSupported: boolean,
): ReadonlyArray<ExtensionPage> {
  return pullRequestsSupported
    ? EXTENSION_PAGES
    : EXTENSION_PAGES.filter((page) => page !== "pullRequests");
}
