import type { EnvironmentId, OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentShellState } from "./shell.ts";
import { createEnvironmentSnapshotAtom } from "./snapshots.ts";

const SCRATCH_PROJECT_TITLE = "No project";
const NEW_THREAD_TITLE = "New thread";

/** Localized replacements for the English titles the server stores. */
export interface DefaultTitles {
  readonly scratchProject: string;
  readonly newThread: string;
}

/**
 * Renames items whose title equals `english`. Results are keyed by the
 * server's arrays and objects so unchanged items keep their identity.
 */
function createTitleRelabeler<T extends { readonly title: string }>(
  english: string,
  title: string,
) {
  const lists = new WeakMap<ReadonlyArray<T>, ReadonlyArray<T>>();
  const items = new WeakMap<T, T>();
  const relabel = (item: T): T => {
    if (item.title !== english) return item;
    let localized = items.get(item);
    if (!localized) {
      localized = { ...item, title };
      items.set(item, localized);
    }
    return localized;
  };
  return (list: ReadonlyArray<T>): ReadonlyArray<T> => {
    if (title === english || !list.some((item) => item.title === english)) return list;
    let localized = lists.get(list);
    if (!localized) {
      localized = list.map(relabel);
      lists.set(list, localized);
    }
    return localized;
  };
}

/**
 * The server names every environment's Scratch project "No project" and
 * untitled threads "New thread". Both are stored data, so build-time
 * translation never sees them; clients pass their localized titles here.
 * Clients still send the English draft title as a title seed, and the server
 * compares against it, so only the snapshot clients read is relabeled.
 */
export function createDefaultTitleLocalizer(titles: DefaultTitles) {
  type Snapshot = OrchestrationV2ShellSnapshot;
  const projects = createTitleRelabeler<Snapshot["projects"][number]>(
    SCRATCH_PROJECT_TITLE,
    titles.scratchProject,
  );
  const threads = createTitleRelabeler<Snapshot["threads"][number]>(
    NEW_THREAD_TITLE,
    titles.newThread,
  );
  return (snapshot: Snapshot | null): Snapshot | null => {
    if (snapshot === null) return snapshot;
    const next = {
      ...snapshot,
      projects: projects(snapshot.projects),
      threads: threads(snapshot.threads),
      archivedThreads: threads(snapshot.archivedThreads),
    };
    return next.projects === snapshot.projects &&
      next.threads === snapshot.threads &&
      next.archivedThreads === snapshot.archivedThreads
      ? snapshot
      : next;
  };
}

/** `createEnvironmentSnapshotAtom` with the server's default titles localized. */
export function createLocalizedEnvironmentSnapshotAtom<E>(
  shellStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<EnvironmentShellState, E>>,
  titles: DefaultTitles,
) {
  const snapshotAtom = createEnvironmentSnapshotAtom(shellStateAtom);
  const localize = createDefaultTitleLocalizer(titles);
  return Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => localize(get(snapshotAtom(environmentId)))).pipe(
      Atom.withLabel(`environment-snapshot-localized:${environmentId}`),
    ),
  );
}
