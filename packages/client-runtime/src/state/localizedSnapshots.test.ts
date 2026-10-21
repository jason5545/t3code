import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { createDefaultTitleLocalizer } from "./localizedSnapshots.ts";

const snapshotWith = (
  projectTitles: ReadonlyArray<string>,
  threadTitles: ReadonlyArray<string> = [],
  archivedThreadTitles: ReadonlyArray<string> = [],
) =>
  ({
    projects: projectTitles.map((title) => ({ title })),
    threads: threadTitles.map((title) => ({ title })),
    archivedThreads: archivedThreadTitles.map((title) => ({ title })),
  }) as unknown as OrchestrationV2ShellSnapshot;

const chineseTitles = { scratchProject: "無專案", newThread: "新對話" };

describe("createDefaultTitleLocalizer", () => {
  it("renames only the Scratch project and keeps unchanged projects stable", () => {
    const localize = createDefaultTitleLocalizer(chineseTitles);
    const snapshot = snapshotWith(["No project", "t3code"]);
    const first = localize(snapshot)!;
    expect(first.projects.map((project) => project.title)).toEqual(["無專案", "t3code"]);
    expect(first.projects[1]).toBe(snapshot.projects[1]);
    expect(localize({ ...snapshot })!.projects).toBe(first.projects);
  });

  it("renames untitled threads, archived ones included", () => {
    const localize = createDefaultTitleLocalizer(chineseTitles);
    const snapshot = snapshotWith(["t3code"], ["New thread", "Fix login"], ["New thread"]);
    const first = localize(snapshot)!;
    expect(first.threads.map((thread) => thread.title)).toEqual(["新對話", "Fix login"]);
    expect(first.archivedThreads.map((thread) => thread.title)).toEqual(["新對話"]);
    expect(first.threads[1]).toBe(snapshot.threads[1]);
    expect(first.projects).toBe(snapshot.projects);
    expect(localize({ ...snapshot })!.threads).toBe(first.threads);
  });

  it("returns the snapshot untouched when there is nothing to rename", () => {
    const snapshot = snapshotWith(["t3code"], ["Fix login"]);
    expect(createDefaultTitleLocalizer(chineseTitles)(snapshot)).toBe(snapshot);
    const english = snapshotWith(["No project"], ["New thread"]);
    expect(
      createDefaultTitleLocalizer({ scratchProject: "No project", newThread: "New thread" })(
        english,
      ),
    ).toBe(english);
  });
});
