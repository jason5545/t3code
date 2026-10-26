import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { describe, expect, it } from "vite-plus/test";

import { nestLaunchedThreads } from "./launchedThreadNesting";

const environmentId = EnvironmentId.make("environment");
const thread = (id: string, launchedBy?: string) => ({
  id: ThreadId.make(id),
  environmentId,
  launchedByThreadId: launchedBy === undefined ? null : ThreadId.make(launchedBy),
});
const key = (id: string) => scopedThreadKey(scopeThreadRef(environmentId, ThreadId.make(id)));
const nest = (
  threads: ReturnType<typeof thread>[],
  options: { expanded?: string[]; open?: string } = {},
) =>
  nestLaunchedThreads(threads, {
    expandedKeys: new Set((options.expanded ?? []).map(key)),
    keepVisibleKey: options.open === undefined ? null : key(options.open),
  });
const ids = (result: ReturnType<typeof nest>) => result.threads.map((entry) => entry.id);

// Settled order: newest first, so children often sort above the thread that launched them.
const settled = [
  thread("child-b", "commander"),
  thread("other"),
  thread("grandchild", "child-a"),
  thread("child-a", "commander"),
  thread("commander"),
  thread("orphan", "missing"),
];

describe("nestLaunchedThreads", () => {
  it("folds launched threads under their launcher and counts every level", () => {
    const result = nest(settled);
    expect(ids(result)).toEqual(["other", "commander", "orphan"]);
    expect(result.rowByKey.get(key("commander"))).toEqual({
      depth: 0,
      launchedCount: 3,
      expanded: false,
    });
    expect(result.rowByKey.get(key("orphan"))).toEqual({
      depth: 0,
      launchedCount: 0,
      expanded: false,
    });
  });

  it("lists an expanded launcher's threads after it in the input order", () => {
    expect(ids(nest(settled, { expanded: ["commander"] }))).toEqual([
      "other",
      "commander",
      "child-b",
      "child-a",
      "orphan",
    ]);
    const deep = nest(settled, { expanded: ["commander", "child-a"] });
    expect(ids(deep)).toEqual(["other", "commander", "child-b", "child-a", "grandchild", "orphan"]);
    expect(deep.rowByKey.get(key("grandchild"))?.depth).toBe(2);
  });

  it("keeps the open thread and its launchers visible inside folded launchers", () => {
    expect(ids(nest(settled, { open: "grandchild" }))).toEqual([
      "other",
      "commander",
      "child-a",
      "grandchild",
      "orphan",
    ]);
  });

  it("returns the list unchanged when nothing nests", () => {
    const flat = [thread("one"), thread("two", "elsewhere")];
    const result = nest(flat);
    expect(result.threads).toBe(flat);
    expect(result.rowByKey.size).toBe(0);
  });

  it("keeps threads in a launch cycle at the top level", () => {
    expect(ids(nest([thread("a", "b"), thread("b", "a"), thread("c", "c")]))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
