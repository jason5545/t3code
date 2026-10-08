import type { EnvironmentId, OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentShellState } from "./shell.ts";

export function createEnvironmentSnapshotAtom<E>(
  shellStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<EnvironmentShellState, E>>,
) {
  return Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): OrchestrationV2ShellSnapshot | null =>
      Option.match(AsyncResult.value(get(shellStateAtom(environmentId))), {
        onNone: () => null,
        onSome: (state) => Option.getOrNull(state.snapshot),
      }),
    ).pipe(Atom.withLabel(`environment-snapshot:${environmentId}`)),
  );
}

type ProjectShells = OrchestrationV2ShellSnapshot["projects"];
const SCRATCH_PROJECT_TITLE = "No project";

/**
 * The server names every environment's Scratch project "No project". It is
 * stored data, so build-time translation never sees it; clients pass their
 * localized title here. Results are keyed by the server's arrays and objects
 * so unchanged projects keep their identity.
 */
export function createScratchProjectTitleLocalizer(title: string) {
  const projectLists = new WeakMap<ProjectShells, ProjectShells>();
  const projects = new WeakMap<ProjectShells[number], ProjectShells[number]>();
  const localizeProject = (project: ProjectShells[number]) => {
    if (project.title !== SCRATCH_PROJECT_TITLE) return project;
    let localized = projects.get(project);
    if (!localized) {
      localized = { ...project, title };
      projects.set(project, localized);
    }
    return localized;
  };
  return (snapshot: OrchestrationV2ShellSnapshot | null): OrchestrationV2ShellSnapshot | null => {
    if (
      snapshot === null ||
      title === SCRATCH_PROJECT_TITLE ||
      !snapshot.projects.some((project) => project.title === SCRATCH_PROJECT_TITLE)
    ) {
      return snapshot;
    }
    let localized = projectLists.get(snapshot.projects);
    if (!localized) {
      localized = snapshot.projects.map(localizeProject);
      projectLists.set(snapshot.projects, localized);
    }
    return { ...snapshot, projects: localized };
  };
}

/** `createEnvironmentSnapshotAtom` with the Scratch project's title localized. */
export function createLocalizedEnvironmentSnapshotAtom<E>(
  shellStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<EnvironmentShellState, E>>,
  scratchProjectTitle: string,
) {
  const snapshotAtom = createEnvironmentSnapshotAtom(shellStateAtom);
  const localize = createScratchProjectTitleLocalizer(scratchProjectTitle);
  return Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => localize(get(snapshotAtom(environmentId)))).pipe(
      Atom.withLabel(`environment-snapshot-localized:${environmentId}`),
    ),
  );
}
