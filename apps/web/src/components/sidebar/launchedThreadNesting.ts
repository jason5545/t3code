import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

type NestableThread = Pick<EnvironmentThreadShell, "id" | "environmentId" | "launchedByThreadId">;

export interface LaunchedThreadRow {
  /** Indentation level; 0 for a thread whose launcher is not in the same list. */
  readonly depth: number;
  /** Every thread nested below this one, folded or not. */
  readonly launchedCount: number;
  readonly expanded: boolean;
}

export interface LaunchedThreadNesting<T> {
  /** The list in display order, without the threads inside folded launchers. */
  readonly threads: readonly T[];
  readonly rowByKey: ReadonlyMap<string, LaunchedThreadRow>;
}

const threadKey = (thread: Pick<NestableThread, "id" | "environmentId">) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

/**
 * Fork patch 20: a thread an agent launched sits under its launcher when both are in
 * the list, folded until the launcher is expanded. Order otherwise follows the input.
 * `keepVisibleKey` (the open thread) stays visible inside a folded launcher.
 */
export function nestLaunchedThreads<T extends NestableThread>(
  threads: readonly T[],
  options: {
    readonly expandedKeys: ReadonlySet<string>;
    readonly keepVisibleKey: string | null;
  },
): LaunchedThreadNesting<T> {
  const byKey = new Map(threads.map((thread) => [threadKey(thread), thread] as const));
  const parentKeyOf = (thread: T): string | null => {
    if (thread.launchedByThreadId == null) return null;
    const key = threadKey({ environmentId: thread.environmentId, id: thread.launchedByThreadId });
    return byKey.has(key) ? key : null;
  };
  // A launch cycle cannot come from the server, but malformed data must not hide its threads.
  const isInCycle = (thread: T) => {
    const seen = new Set<string>([threadKey(thread)]);
    for (let parent = parentKeyOf(thread); parent !== null;) {
      if (seen.has(parent)) return true;
      seen.add(parent);
      parent = parentKeyOf(byKey.get(parent)!);
    }
    return false;
  };
  const childrenByKey = new Map<string, T[]>();
  const roots: T[] = [];
  for (const thread of threads) {
    const parent = isInCycle(thread) ? null : parentKeyOf(thread);
    if (parent === null) roots.push(thread);
    else childrenByKey.set(parent, [...(childrenByKey.get(parent) ?? []), thread]);
  }
  if (childrenByKey.size === 0) return { threads, rowByKey: new Map() };

  const keepVisiblePath = new Set<string>();
  const keepVisible =
    options.keepVisibleKey === null ? undefined : byKey.get(options.keepVisibleKey);
  if (keepVisible !== undefined && !isInCycle(keepVisible)) {
    for (let key: string | null = threadKey(keepVisible); key !== null;) {
      keepVisiblePath.add(key);
      key = parentKeyOf(byKey.get(key)!);
    }
  }
  const countBelow = (key: string): number =>
    (childrenByKey.get(key) ?? []).reduce(
      (sum, child) => sum + 1 + countBelow(threadKey(child)),
      0,
    );

  const ordered: T[] = [];
  const rowByKey = new Map<string, LaunchedThreadRow>();
  const visit = (thread: T, depth: number) => {
    const key = threadKey(thread);
    const expanded = options.expandedKeys.has(key);
    ordered.push(thread);
    rowByKey.set(key, { depth, launchedCount: countBelow(key), expanded });
    for (const child of childrenByKey.get(key) ?? []) {
      if (expanded || keepVisiblePath.has(threadKey(child))) visit(child, depth + 1);
    }
  };
  for (const root of roots) visit(root, 0);
  return { threads: ordered, rowByKey };
}
