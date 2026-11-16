import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/**
 * Fork patch 30: what installed extensions see of T3, on web (`t3`) and in a server part's
 * calls (`context.t3`). It is a public contract: extensions check `apiVersion` and say so when
 * a server is older. Upstream's types stay behind it, so an upstream change is absorbed here.
 */
/**
 * 3 added, on web, `t3.pages`, `t3.actions`, `t3.navigation`, `t3.shortcuts` and
 * `t3.components.StatusNotices`; the server's `context.t3` is unchanged since 2.
 */
export const EXTENSION_API_VERSION = 3;

const LATEST_MESSAGE_CHARS = 2000;

/** One thread as an extension sees it. Times are ISO strings. */
export interface ExtensionThreadSummary {
  /** Web only; a server part only sees its own environment. */
  readonly environmentId: string | null;
  readonly id: string;
  readonly projectId: string;
  readonly projectTitle: string | null;
  /** The project's folder; the thread works in `worktreePath` when that is set. */
  readonly projectRoot: string | null;
  readonly title: string;
  readonly provider: string;
  readonly model: string;
  /** The reasoning effort option, when the model has one. */
  readonly effort: string | null;
  /** "idle", or the latest run's status. */
  readonly status: string;
  readonly activeRunId: string | null;
  readonly latestRunId: string | null;
  readonly runRequestedAt: string | null;
  readonly runStartedAt: string | null;
  readonly runCompletedAt: string | null;
  readonly pendingRequest: {
    readonly kind: string;
    readonly createdAt: string;
    readonly userOnly: boolean;
  } | null;
  /** The newest visible message, cut to 2,000 characters. */
  readonly latestMessage: {
    readonly role: string;
    readonly text: string;
    readonly updatedAt: string;
  } | null;
  readonly parentThreadId: string | null;
  readonly launchedByThreadId: string | null;
  /** "fork", "subagent", "side-chat" or null for a top-level thread. */
  readonly relationship: string | null;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly ephemeral: boolean;
  readonly lastVisitedAt: string | null;
  readonly settledAt: string | null;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const iso = (value: DateTime.Utc | null | undefined) =>
  value === null || value === undefined ? null : DateTime.formatIso(value);

const effortOf = (selection: OrchestrationV2ThreadShell["modelSelection"]) => {
  const options = Array.isArray(selection.options) ? selection.options : [];
  const option = options.find(({ id }) => id === "effort" || id === "reasoningEffort");
  return option === undefined || option.value === null ? null : String(option.value);
};

export interface ExtensionProjectInfo {
  readonly title: string;
  readonly workspaceRoot: string;
}

interface CachedSummary {
  readonly project: ExtensionProjectInfo | null;
  readonly summary: ExtensionThreadSummary;
}
const summaries = new WeakMap<OrchestrationV2ThreadShell, Map<string, CachedSummary>>();

/** Built once per shell and project, so a list that did not change keeps the same summaries. */
export function summarizeThreadShell(
  shell: OrchestrationV2ThreadShell,
  environmentId: string | null,
  project: ExtensionProjectInfo | null,
): ExtensionThreadSummary {
  const key = environmentId ?? "";
  const cached = summaries.get(shell)?.get(key);
  if (cached !== undefined && cached.project === project) return cached.summary;
  const message = shell.latestVisibleMessage;
  const request = shell.pendingRuntimeRequest;
  const summary: ExtensionThreadSummary = {
    environmentId,
    id: shell.id,
    projectId: shell.projectId,
    projectTitle: project?.title ?? null,
    projectRoot: project?.workspaceRoot ?? null,
    title: shell.title,
    provider: shell.providerInstanceId,
    model: shell.modelSelection.model,
    effort: effortOf(shell.modelSelection),
    status: shell.status,
    activeRunId: shell.activeRunId,
    latestRunId: shell.latestRunId,
    runRequestedAt: iso(shell.latestRunRequestedAt),
    runStartedAt: iso(shell.latestRunStartedAt),
    runCompletedAt: iso(shell.latestRunCompletedAt),
    pendingRequest:
      request === null
        ? null
        : {
            kind: request.kind,
            createdAt: DateTime.formatIso(request.createdAt),
            userOnly: request.userOnly === true,
          },
    latestMessage:
      message === null
        ? null
        : {
            role: message.role,
            text: message.text.slice(0, LATEST_MESSAGE_CHARS),
            updatedAt: DateTime.formatIso(message.updatedAt),
          },
    parentThreadId: shell.lineage.parentThreadId,
    launchedByThreadId: shell.launchedByThreadId ?? null,
    relationship:
      shell.lineage.sideChat === true ? "side-chat" : shell.lineage.relationshipToParent,
    branch: shell.branch,
    worktreePath: shell.worktreePath,
    ephemeral: shell.ephemeral === true,
    lastVisitedAt: iso(shell.lastVisitedAt),
    settledAt: iso(shell.settledAt),
    archivedAt: iso(shell.archivedAt),
    createdAt: DateTime.formatIso(shell.createdAt),
    updatedAt: DateTime.formatIso(shell.updatedAt),
  };
  let byEnvironment = summaries.get(shell);
  if (byEnvironment === undefined) {
    byEnvironment = new Map();
    summaries.set(shell, byEnvironment);
  }
  byEnvironment.set(key, { project, summary });
  return summary;
}

/** A tool step of a run, as `t3.runs.activity` returns it. */
export interface ExtensionActivityItem {
  readonly ordinal: number;
  readonly type: string;
  readonly status: string;
  readonly title: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly updatedAt: string;
  /** command_execution: the command line, cut to 64 KiB. */
  readonly command?: string;
  /** file_change: the file, as the provider named it. */
  readonly file?: string;
  /** dynamic_tool: the tool and its input, every string cut to 1,000 characters; null over 256 KiB. */
  readonly tool?: { readonly name: string | null; readonly input: unknown };
}

export interface ExtensionRunActivity {
  readonly run: {
    readonly id: string;
    readonly ordinal: number;
    readonly status: string;
    readonly requestedAt: string;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    /** The message that started the run. */
    readonly trigger: { readonly text: string; readonly createdBy: string | null } | null;
  } | null;
  /** The newest update of any item in the run. */
  readonly lastActivityAt: string | null;
  /** The newest item still pending, running or waiting, of any type. */
  readonly current: ExtensionActivityItem | null;
  /** Commands, file changes and tool calls after `afterOrdinal`, oldest first, at most 500. */
  readonly items: ReadonlyArray<ExtensionActivityItem>;
  /** Pass as `afterOrdinal` to read only what came next; -1 when there is nothing. */
  readonly lastOrdinal: number;
  /** More items follow `lastOrdinal`. */
  readonly hasMore: boolean;
}
