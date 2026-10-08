import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { createScratchProjectTitleLocalizer } from "./snapshots.ts";

const snapshotWith = (titles: ReadonlyArray<string>) =>
  ({
    projects: titles.map((title) => ({ title })),
  }) as unknown as OrchestrationV2ShellSnapshot;

describe("createScratchProjectTitleLocalizer", () => {
  it("renames only the Scratch project and keeps unchanged projects stable", () => {
    const localize = createScratchProjectTitleLocalizer("無專案");
    const snapshot = snapshotWith(["No project", "t3code"]);
    const first = localize(snapshot)!;
    expect(first.projects.map((project) => project.title)).toEqual(["無專案", "t3code"]);
    expect(first.projects[1]).toBe(snapshot.projects[1]);
    expect(localize({ ...snapshot })!.projects).toBe(first.projects);
  });

  it("returns the snapshot untouched when there is nothing to rename", () => {
    const snapshot = snapshotWith(["t3code"]);
    expect(createScratchProjectTitleLocalizer("無專案")(snapshot)).toBe(snapshot);
    const scratch = snapshotWith(["No project"]);
    expect(createScratchProjectTitleLocalizer("No project")(scratch)).toBe(scratch);
  });
});
