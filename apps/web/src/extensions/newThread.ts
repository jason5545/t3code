import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RuntimeMode,
  type ModelSelection,
  type ProviderOptionSelection,
  type ServerProvider,
  type ServerConfig,
  type ServerSettings,
  type T3ProjectFile,
  type EnvironmentId as EnvironmentIdType,
  type ProjectReadFileResult,
  T3_PROJECT_FILE_NAME,
} from "@t3tools/contracts";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";
import { resolveNewThreadEnvMode, resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveModelPreferences } from "@t3tools/shared/serverSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import type { ClientSettings, UnifiedSettings } from "@t3tools/contracts/settings";
import {
  getProjectFileQueryAtom,
  optimisticFileAtom,
} from "../components/files/projectFilesQueryState";
import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { newMessageId, newThreadId } from "../lib/utils";
import {
  getAppModelOptionsForInstance,
  resolveEffectiveDefaultModelSelection,
} from "../modelSelection";
import {
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  resolveProjectDefaultProviderModelSelection,
} from "../providerInstances";
import { getProviderModelCapabilities } from "../providerModels";
import { readT3ProjectFile } from "../lib/t3ProjectFileDefaults";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProject, useQuietThreadShells } from "../state/entities";
import { environmentProjects } from "../state/projects";
import { environmentServerConfigsAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { DEFAULT_INTERACTION_MODE } from "../types";

/**
 * Fork patch 30, API 6: a new thread started from an extension's own interface, with the choices
 * the standard new-thread composer offers (project, model and its traits, access, plan mode,
 * local folder or a new worktree). Defaults are worked out the way a fresh draft's are, without
 * the selection a draft carries over from the thread on screen.
 */

export interface ExtensionProject {
  readonly environmentId: string;
  readonly id: string;
  readonly title: string;
  readonly root: string;
  readonly pinned: boolean;
  /** The project-less threads' project (`No project`); it has no worktrees. */
  readonly scratch: boolean;
}

export interface ExtensionModelOption {
  readonly id: string;
  readonly label: string;
  readonly type: "select" | "boolean";
  /** Select options only. */
  readonly choices: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  /** What the model uses when the thread does not say. */
  readonly defaultValue: string | boolean | null;
}

export interface ExtensionModelChoice {
  readonly slug: string;
  readonly name: string;
  readonly options: ReadonlyArray<ExtensionModelOption>;
}

export interface ExtensionProviderChoice {
  readonly instanceId: string;
  readonly label: string;
  /** Signed in and answering; a provider that is not can still be picked, like in the composer. */
  readonly ready: boolean;
  readonly models: ReadonlyArray<ExtensionModelChoice>;
}

export interface ExtensionStartOptions {
  readonly providers: ReadonlyArray<ExtensionProviderChoice>;
  /** What a fresh draft in this project would send, or null with no usable provider. */
  readonly selection: {
    readonly instanceId: string;
    readonly model: string;
    readonly options: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }>;
  } | null;
  readonly runtimeMode: RuntimeMode;
  readonly runtimeModes: ReadonlyArray<RuntimeMode>;
  readonly envMode: "local" | "worktree";
  readonly startFromOrigin: boolean;
}

export interface ExtensionStartInput {
  readonly environmentId: string;
  readonly projectId: string;
  readonly text: string;
  readonly modelSelection?: ExtensionStartOptions["selection"];
  readonly runtimeMode?: RuntimeMode;
  readonly plan?: boolean;
  /** A new worktree from this branch, tag or commit; left out, the thread runs in the project folder. */
  readonly worktree?: { readonly baseBranch: string; readonly startFromOrigin?: boolean } | null;
}

const RUNTIME_MODES = RuntimeMode.literals;
const isRuntimeMode = Schema.is(RuntimeMode);

const toExtensionProject = (project: EnvironmentProject): ExtensionProject => ({
  environmentId: project.environmentId,
  id: project.id,
  title: project.title,
  root: project.workspaceRoot,
  pinned: Boolean(project.pinnedAt),
  scratch: project.isScratch === true,
});

export function useExtensionProjects(): ReadonlyArray<ExtensionProject> {
  const projects = useAtomValue(environmentProjects.projectsAtom);
  return projects.filter((project) => !project.archivedAt).map(toExtensionProject);
}

function describeProviders(
  providers: ReadonlyArray<ServerProvider>,
  settings: UnifiedSettings,
): ReadonlyArray<ExtensionProviderChoice> {
  return deriveProviderInstanceEntries(providers)
    .filter((entry) => isProviderInstancePickerVisible(entry) && entry.installed)
    .map((entry) => ({
      instanceId: entry.instanceId,
      label: entry.displayName,
      ready: isProviderInstancePickerReady(entry),
      models: getAppModelOptionsForInstance(settings, entry)
        .filter((option) => !option.isUnavailable)
        .map((option) => ({
          slug: option.slug,
          name: option.name,
          options: getProviderOptionDescriptors({
            caps: getProviderModelCapabilities(entry.models, option.slug, entry.driverKind),
          }).map((descriptor): ExtensionModelOption => ({
            id: descriptor.id,
            label: descriptor.label,
            type: descriptor.type,
            choices:
              descriptor.type === "select"
                ? descriptor.options.map(({ id, label }) => ({ id, label }))
                : [],
            defaultValue:
              descriptor.type === "select"
                ? (descriptor.currentValue ??
                  descriptor.options.find((choice) => choice.isDefault)?.id ??
                  null)
                : (descriptor.currentValue ?? null),
          })),
        })),
    }));
}

function buildTarget(
  project: EnvironmentProject,
  config: ServerConfig | null | undefined,
  projectFile: T3ProjectFile | null,
) {
  const settings: ServerSettings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
  return {
    ref: scopeProjectRef(project.environmentId, project.id),
    project,
    settings,
    providers: config?.providers ?? [],
    newProjectsRoot: config?.newProjectsRoot,
    projectSettings: resolveProjectSettings(settings, project.id, project, projectFile),
  };
}
type Target = ReturnType<typeof buildTarget>;

const unifiedSettings = (target: Target, clientSettings: ClientSettings) =>
  ({
    ...clientSettings,
    ...target.settings,
    ...resolveModelPreferences(target.settings, clientSettings),
  }) as UnifiedSettings;

/** The new-thread composer's defaults for one project (`createNewThreadHandler`, without the carry). */
function defaultSelection(target: Target, unified: UnifiedSettings) {
  const { settings, providers, project, projectSettings } = target;
  const configured = projectSettings.settings.defaultModelSelection ?? null;
  const resolved = resolveNewThreadModelSelection({
    defaultSelection:
      configured ?? resolveProjectDefaultProviderModelSelection(providers, settings, project.id),
    fallbackSelection: settings.fallbackModelSelection ?? null,
    providers,
    settings,
    projectId: project.id,
    now: Date.now(),
  }).selection;
  return resolved === null
    ? null
    : resolveEffectiveDefaultModelSelection(unified, providers, resolved);
}

const parseProjectFile = (data: ProjectReadFileResult | null) =>
  data === null || data.exists === false || data.truncated
    ? null
    : parseT3ProjectFile(data.contents);

/** The project's `.t3` file, which can set its defaults as it does for a new draft; null while it loads. */
const projectFileAtom = Atom.family((key: string) => {
  const [environmentId, workspaceRoot] = JSON.parse(key) as [EnvironmentIdType, string];
  return Atom.make((get): T3ProjectFile | null => {
    const result = get(getProjectFileQueryAtom(environmentId, workspaceRoot, T3_PROJECT_FILE_NAME));
    if (result.waiting) return null;
    return parseProjectFile(
      get(optimisticFileAtom(environmentId, workspaceRoot, T3_PROJECT_FILE_NAME))?.data ??
        AsyncResult.getOrElse(result, () => null),
    );
  }).pipe(Atom.withLabel(`extension-start-project-file:${key}`));
});
const NO_PROJECT_FILE = Atom.make((): T3ProjectFile | null => null);

export function useStartOptions(
  projectInput: { readonly environmentId: string; readonly projectId: string } | null,
): ExtensionStartOptions | null {
  const clientSettings = useClientSettings();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const threads = useQuietThreadShells();
  const project =
    projectInput === null
      ? undefined
      : projects.find(
          (candidate) =>
            candidate.environmentId === projectInput.environmentId &&
            candidate.id === projectInput.projectId,
        );
  const projectFile = useAtomValue(
    project === undefined || project.isScratch
      ? NO_PROJECT_FILE
      : projectFileAtom(JSON.stringify([project.environmentId, project.workspaceRoot])),
  );
  if (project === undefined) return null;
  const target = buildTarget(project, configs.get(project.environmentId), projectFile);
  const unified = unifiedSettings(target, clientSettings);
  const selection = defaultSelection(target, unified);
  const envMode = project.isScratch
    ? "local"
    : resolveNewThreadEnvMode({
        projectSettings: target.projectSettings,
        workspaceRoot: project.workspaceRoot,
        newProjectsRoot: target.newProjectsRoot,
        projectHasThreads: threads.some(
          (thread) =>
            thread.environmentId === project.environmentId && thread.projectId === project.id,
        ),
      });
  return {
    providers: describeProviders(target.providers, unified),
    selection:
      selection === null
        ? null
        : {
            instanceId: selection.instanceId,
            model: selection.model,
            options: (selection.options ?? []).map(({ id, value }) => ({ id, value })),
          },
    runtimeMode: target.projectSettings.settings.defaultRuntimeMode,
    runtimeModes: RUNTIME_MODES,
    envMode: envMode === "worktree" ? "worktree" : "local",
    startFromOrigin: target.projectSettings.settings.newWorktreesStartFromOrigin,
  };
}

function readSelection(
  input: ExtensionStartInput["modelSelection"],
  fallback: ModelSelection | null,
): ModelSelection {
  if (input === undefined || input === null) {
    if (fallback === null) throw new Error("No model is available for a new thread.");
    return fallback;
  }
  if (
    typeof input !== "object" ||
    typeof input.instanceId !== "string" ||
    typeof input.model !== "string" ||
    input.model.trim() === ""
  ) {
    throw new TypeError("modelSelection takes an instanceId and a model.");
  }
  const options: ProviderOptionSelection[] = [];
  for (const option of input.options ?? []) {
    if (
      typeof option?.id !== "string" ||
      option.id.trim() === "" ||
      (typeof option.value !== "boolean" &&
        (typeof option.value !== "string" || option.value.trim() === ""))
    ) {
      throw new TypeError("Each model option is { id, value } with a string or boolean value.");
    }
    options.push({ id: option.id, value: option.value });
  }
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    model: input.model,
    ...(options.length > 0 ? { options } : {}),
  };
}

export async function startExtensionThread(input: ExtensionStartInput) {
  if (typeof input !== "object" || input === null) throw new TypeError("start takes an object.");
  const { environmentId, projectId, text } = input;
  if (typeof environmentId !== "string" || typeof projectId !== "string") {
    throw new TypeError("start takes the project's environmentId and projectId.");
  }
  if (typeof text !== "string" || text.trim() === "") throw new TypeError("start takes a message.");
  const project = readProject(
    scopeProjectRef(EnvironmentId.make(environmentId), ProjectId.make(projectId)),
  );
  if (project === null) throw new Error("That project is not available.");
  const projectFile = project.isScratch
    ? null
    : await readT3ProjectFile(project.environmentId, project.workspaceRoot).catch(() => null);
  const target = buildTarget(
    project,
    appAtomRegistry.get(environmentServerConfigsAtom).get(project.environmentId),
    projectFile,
  );
  const unified = unifiedSettings(target, getClientSettings());
  const modelSelection = readSelection(input.modelSelection, defaultSelection(target, unified));
  const runtimeMode = input.runtimeMode ?? target.projectSettings.settings.defaultRuntimeMode;
  if (!isRuntimeMode(runtimeMode))
    throw new TypeError(`runtimeMode is one of ${RUNTIME_MODES.join(", ")}.`);
  const worktree = input.worktree ?? null;
  if (worktree !== null) {
    if (typeof worktree.baseBranch !== "string" || worktree.baseBranch.trim() === "") {
      throw new TypeError("worktree takes a baseBranch.");
    }
    if (target.project.isScratch) throw new Error("This project has no repository for a worktree.");
  }
  const interactionMode = input.plan === true ? "plan" : DEFAULT_INTERACTION_MODE;
  const threadId = newThreadId();
  const createdAt = new Date().toISOString();
  const title = deriveThreadTitleSeed({ text, attachments: [] });
  const result = await runAtomCommand(
    appAtomRegistry,
    threadEnvironment.startTurn,
    {
      environmentId: target.ref.environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        modelSelection,
        titleSeed: title,
        runtimeMode,
        interactionMode,
        bootstrap: {
          createThread: {
            projectId: target.project.id,
            title,
            modelSelection,
            runtimeMode,
            interactionMode,
            branch: null,
            worktreePath: null,
            createdAt,
          },
          ...(worktree === null
            ? {}
            : {
                prepareWorktree: {
                  projectCwd: target.project.workspaceRoot,
                  baseBranch: worktree.baseBranch.trim(),
                  ...(worktree.startFromOrigin ? { startFromOrigin: true } : {}),
                },
                runSetupScript: true,
              }),
        },
        createdAt,
      },
    },
    { label: "extension:start", reportFailure: false, reportDefect: true },
  );
  if (result._tag === "Failure") {
    const error = squashAtomCommandFailure(result);
    throw error instanceof Error ? error : new Error(String(error));
  }
  return { environmentId: target.ref.environmentId as string, threadId: threadId as string };
}
