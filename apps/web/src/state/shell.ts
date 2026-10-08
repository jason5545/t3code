import {
  AVAILABLE_CONNECTION_STATE,
  connectionProjectionPhase,
} from "@t3tools/client-runtime/connection";
import {
  createEnvironmentShellAtoms,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
  type EnvironmentShellState,
} from "@t3tools/client-runtime/state/shell";
import {
  type EnvironmentCatalogState,
  enabledEnvironmentIds,
} from "@t3tools/client-runtime/state/connections";
import type { EnvironmentId, OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { isHostedStaticApp } from "../hostedPairing";
import { __t3_t } from "../locale/autoTranslateRuntime";

export const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);
export const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);
const rawEnvironmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);

// The server names every environment's Scratch project "No project". It is
// stored data, so build-time translation never sees it; relabel it here.
const SCRATCH_PROJECT_TITLE = "No project";
const scratchProjectTitle = __t3_t(SCRATCH_PROJECT_TITLE, "無專案");
type ProjectShells = OrchestrationV2ShellSnapshot["projects"];
// Keyed by the server's arrays and objects so unchanged projects keep their identity.
const localizedProjectLists = new WeakMap<ProjectShells, ProjectShells>();
const localizedProjects = new WeakMap<ProjectShells[number], ProjectShells[number]>();

function localizeProject(project: ProjectShells[number]): ProjectShells[number] {
  if (project.title !== SCRATCH_PROJECT_TITLE) return project;
  let localized = localizedProjects.get(project);
  if (!localized) {
    localized = { ...project, title: scratchProjectTitle };
    localizedProjects.set(project, localized);
  }
  return localized;
}

function localizeScratchProjectTitle(
  snapshot: OrchestrationV2ShellSnapshot | null,
): OrchestrationV2ShellSnapshot | null {
  if (
    snapshot === null ||
    scratchProjectTitle === SCRATCH_PROJECT_TITLE ||
    !snapshot.projects.some((project) => project.title === SCRATCH_PROJECT_TITLE)
  ) {
    return snapshot;
  }
  let projects = localizedProjectLists.get(snapshot.projects);
  if (!projects) {
    projects = snapshot.projects.map(localizeProject);
    localizedProjectLists.set(snapshot.projects, projects);
  }
  return { ...snapshot, projects };
}

export const environmentSnapshotAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) =>
    localizeScratchProjectTitle(get(rawEnvironmentSnapshotAtom(environmentId))),
  ).pipe(Atom.withLabel(`environment-snapshot-localized:${environmentId}`)),
);

export const allEnvironmentShellsBootstrappedAtom = Atom.make((get) => {
  const catalog = AsyncResult.value(get(environmentCatalog.catalogAtom));
  if (Option.isNone(catalog)) {
    return false;
  }
  for (const environmentId of enabledEnvironmentIds(catalog.value)) {
    if (Option.isSome(get(environmentShell.stateValueAtom(environmentId)).snapshot)) {
      continue;
    }
    const connection = Option.getOrElse(
      AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
      () => AVAILABLE_CONNECTION_STATE,
    );
    if (connectionProjectionPhase(connection) !== "disconnected") {
      return false;
    }
    // A retrying environment is only transiently disconnected; give it its
    // first retries before letting the landing settle without its snapshot.
    if (connection.phase === "backoff" && connection.desired && connection.attempt <= 2) {
      return false;
    }
  }
  return true;
}).pipe(Atom.withLabel("web-all-environment-shells-bootstrapped"));

/** Cached or missing snapshots cannot establish that a saved project no longer exists. */
export function createAllEnvironmentProjectSnapshotsReadyAtom(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly shellStateValueAtom: (environmentId: EnvironmentId) => Atom.Atom<EnvironmentShellState>;
  readonly requiresPrimaryEnvironment: boolean;
}) {
  return Atom.make((get) => {
    const catalog = get(input.catalogValueAtom);
    // The persisted catalog can emit before platform discovery registers the
    // primary environment. Neither that gap nor an empty catalog proves absence.
    if (!catalog.isReady || catalog.entries.size === 0) return false;
    if (
      input.requiresPrimaryEnvironment &&
      !Array.from(catalog.entries.values()).some(
        (entry) => entry.target._tag === "PrimaryConnectionTarget",
      )
    ) {
      return false;
    }
    for (const environmentId of enabledEnvironmentIds(catalog)) {
      const shell = get(input.shellStateValueAtom(environmentId));
      if (shell.status !== "live" || Option.isNone(shell.snapshot)) return false;
    }
    return true;
  }).pipe(Atom.withLabel("web-all-environment-project-snapshots-ready"));
}

export const allEnvironmentProjectSnapshotsReadyAtom =
  createAllEnvironmentProjectSnapshotsReadyAtom({
    catalogValueAtom: environmentCatalog.catalogValueAtom,
    shellStateValueAtom: environmentShell.stateValueAtom,
    requiresPrimaryEnvironment: !isHostedStaticApp(),
  });
