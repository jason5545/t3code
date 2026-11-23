import { arrayElementsEqual } from "@t3tools/client-runtime/state/entities";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import type {
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  ProviderApprovalDecision,
  ProviderApprovalOption,
} from "@t3tools/contracts";
import {
  REPLY_MAX_CHARS,
  REPLY_MAX_THREADS,
  REPLY_PREVIEW_CHARS,
  summarizeThreadShell,
  type ExtensionLiveActivity,
  type ExtensionLiveReasoning,
  type ExtensionLiveStep,
  type ExtensionProjectInfo,
  type ExtensionThreadSummary,
} from "@t3tools/shared/extensionApi";
import * as DateTime from "effect/DateTime";

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

/** Since API 4: which environment to ask for which replies, and how many characters. */
export function planReplyReads(
  refs: ReadonlyArray<{ readonly environmentId: string; readonly threadId: string }>,
  full: boolean,
): {
  readonly chars: number;
  readonly batches: ReadonlyArray<{
    readonly environmentId: string;
    readonly threadIds: ReadonlyArray<string>;
  }>;
} {
  if (
    !Array.isArray(refs) ||
    !refs.every(
      (ref) =>
        typeof ref === "object" &&
        ref !== null &&
        typeof ref.environmentId === "string" &&
        typeof ref.threadId === "string",
    )
  ) {
    throw new TypeError("threads.readReplies takes a list of thread refs.");
  }
  const byEnvironment = new Map<string, Set<string>>();
  for (const { environmentId, threadId } of refs) {
    const ids = byEnvironment.get(environmentId) ?? new Set<string>();
    ids.add(threadId);
    byEnvironment.set(environmentId, ids);
  }
  // A whole reply can be 100,000 characters; one per call keeps each answer under 1 MiB.
  const size = full ? 1 : REPLY_MAX_THREADS;
  const batches: Array<{ environmentId: string; threadIds: ReadonlyArray<string> }> = [];
  for (const [environmentId, ids] of byEnvironment) {
    const list = [...ids];
    for (let start = 0; start < list.length; start += size) {
      batches.push({ environmentId, threadIds: list.slice(start, start + size) });
    }
  }
  return { chars: full ? REPLY_MAX_CHARS : REPLY_PREVIEW_CHARS, batches };
}

/** Since API 4: an approval the thread waits on, as `t3.threads.useRequest` returns it. */
export interface ExtensionApprovalRequest {
  readonly id: string;
  readonly kind: "approval";
  /** command, file-read, file-change and the like. */
  readonly requestKind: string;
  readonly createdAt: string;
  readonly detail: string | null;
  readonly reason: string | null;
  readonly options: ReadonlyArray<{
    readonly decision: ProviderApprovalDecision;
    readonly label: string;
    readonly warning: string | null;
  }>;
  /** False once the provider process that asked is gone. */
  readonly canRespond: boolean;
}

/** Since API 4: questions the thread waits on. An answer is an option's `value` or own words. */
export interface ExtensionQuestionRequest {
  readonly id: string;
  readonly kind: "user_input";
  readonly createdAt: string;
  readonly questions: ReadonlyArray<{
    readonly id: string;
    readonly header: string;
    readonly question: string;
    readonly multiSelect: boolean;
    readonly allowCustomAnswer: boolean;
    readonly options: ReadonlyArray<{
      readonly label: string;
      readonly description: string;
      readonly value: string;
    }>;
  }>;
  readonly canRespond: boolean;
}

export type ExtensionPendingRequest = ExtensionApprovalRequest | ExtensionQuestionRequest;

/** What the standard composer offers when the provider sends no options of its own. */
const DEFAULT_APPROVAL_OPTIONS: ReadonlyArray<ProviderApprovalOption> = [
  { decision: "cancel", label: "Cancel" },
  { decision: "decline", label: "Decline" },
  { decision: "acceptForSession", label: "Always allow this session" },
  { decision: "accept", label: "Approve" },
];

const oldestFirst = <T extends { readonly createdAt: string }>(list: ReadonlyArray<T>) =>
  [...list].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));

/**
 * The request the standard composer would show first: an approval before a question, the oldest
 * of each. Secret and link cards are not runtime requests, so they never appear here.
 */
export function summarizePendingRequest(
  pending: PendingThreadRequests | null,
): ExtensionPendingRequest | null {
  if (pending === null) return null;
  const approval = oldestFirst(pending.approvals)[0];
  if (approval !== undefined) {
    return {
      id: approval.requestId,
      kind: "approval",
      requestKind: approval.requestKind,
      createdAt: approval.createdAt,
      detail: approval.detail ?? null,
      reason: approval.reason ?? null,
      options: (approval.options ?? DEFAULT_APPROVAL_OPTIONS).map((option) => ({
        decision: option.decision,
        label: option.label,
        warning: option.warning ?? null,
      })),
      canRespond: approval.responseCapability === "live",
    };
  }
  const input = oldestFirst(pending.userInputs)[0];
  if (input === undefined) return null;
  return {
    id: input.requestId,
    kind: "user_input",
    createdAt: input.createdAt,
    questions: input.questions.map((question) => ({
      id: question.id,
      header: question.header,
      question: question.question,
      multiSelect: question.multiSelect === true,
      allowCustomAnswer: question.allowCustomAnswer !== false,
      options: question.options.map((option) => ({
        label: option.label,
        description: option.description,
        value: option.value ?? option.label,
      })),
    })),
    canRespond: input.responseCapability !== "not_resumable",
  };
}

export type ExtensionRequestResponse =
  | { readonly type: "approval"; readonly decision: ProviderApprovalDecision }
  | {
      readonly type: "user_input";
      readonly answers: Readonly<Record<string, string | ReadonlyArray<string>>>;
    };

/**
 * `t3.threads.respond`'s answer, checked against the request it answers: a decision the
 * approval offers, or an answer for every question. Anything else is a TypeError.
 */
export function readRequestResponse(
  request: ExtensionPendingRequest,
  response: unknown,
): ExtensionRequestResponse {
  if (!request.canRespond) throw new TypeError("This request can no longer be answered here.");
  const body = typeof response === "object" && response !== null ? response : {};
  if (request.kind === "approval") {
    const decision = "decision" in body ? body.decision : undefined;
    const option = request.options.find((candidate) => candidate.decision === decision);
    if (option === undefined) {
      throw new TypeError(
        `respond takes { decision } with ${request.options.map((o) => o.decision).join(", ")}.`,
      );
    }
    return { type: "approval", decision: option.decision };
  }
  const given = "answers" in body ? body.answers : undefined;
  if (typeof given !== "object" || given === null || Array.isArray(given)) {
    throw new TypeError("respond takes { answers } keyed by question id.");
  }
  const answers: Record<string, string | ReadonlyArray<string>> = {};
  for (const question of request.questions) {
    const value: unknown = Object.hasOwn(given, question.id)
      ? (given as Record<string, unknown>)[question.id]
      : undefined;
    const offered = new Set(question.options.map((option) => option.value));
    if (question.multiSelect && Array.isArray(value)) {
      if (value.length === 0 || !value.every((v) => typeof v === "string" && offered.has(v))) {
        throw new TypeError(`Question ${question.id} takes values of its options.`);
      }
      answers[question.id] = [...new Set(value as ReadonlyArray<string>)];
      continue;
    }
    if (typeof value !== "string") {
      throw new TypeError(`Question ${question.id} has no answer.`);
    }
    if (offered.has(value)) {
      answers[question.id] = value;
    } else if (question.allowCustomAnswer && value.trim() !== "") {
      answers[question.id] = value.trim();
    } else {
      throw new TypeError(`Question ${question.id} takes one of its options.`);
    }
  }
  return { type: "user_input", answers };
}

const ACTIVE_STEP_STATUSES = new Set(["pending", "running", "waiting"]);
const TOOL_STEP_TYPES = new Set([
  "command_execution",
  "file_change",
  "dynamic_tool",
  "file_search",
  "web_search",
  "subagent",
]);

const isoOrNull = (value: DateTime.Utc | null | undefined) =>
  value === null || value === undefined ? null : DateTime.formatIso(value);

function describeLiveStep(item: OrchestrationV2TurnItem): ExtensionLiveStep {
  let kind: string = item.type;
  let text = "";
  switch (item.type) {
    case "command_execution":
      kind = "command";
      text = (item.input || item.title || "").slice(0, 200);
      break;
    case "file_change":
      kind = "file";
      text = item.fileName || "";
      break;
    case "dynamic_tool":
      kind = "tool";
      text = (item.toolName || "tool").replace("mcp__", "").replace("__", ":");
      break;
    case "file_search":
      kind = "file_search";
      text = item.pattern || item.title || "";
      break;
    case "web_search":
      kind = "web_search";
      text = item.patterns?.join(", ") || item.title || "";
      break;
    case "subagent":
      kind = "subagent";
      text = item.title || "";
      break;
    case "assistant_message":
    case "reasoning":
      text = "";
      break;
    default:
      text = item.title || "";
      break;
  }
  return {
    id: item.id,
    ordinal: item.ordinal,
    kind,
    text,
    status: item.status,
    failed: item.status === "failed",
    at: isoOrNull(item.completedAt) ?? isoOrNull(item.updatedAt),
  };
}

const sameLiveStep = (left: ExtensionLiveStep | null, right: ExtensionLiveStep | null): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.id === right.id &&
    left.ordinal === right.ordinal &&
    left.kind === right.kind &&
    left.text === right.text &&
    left.status === right.status &&
    left.failed === right.failed &&
    sameSecond(left.at, right.at));

const sameLiveReasoning = (
  left: ExtensionLiveReasoning | null,
  right: ExtensionLiveReasoning | null,
): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.id === right.id &&
    left.ordinal === right.ordinal &&
    left.text === right.text &&
    left.streaming === right.streaming &&
    left.status === right.status);

const sameSecond = (left: string | null, right: string | null): boolean =>
  left === right || (left !== null && right !== null && left.slice(0, 19) === right.slice(0, 19));

/**
 * Since API 8: live activity of a thread's latest run for `t3.threads.useActivity`.
 * Adjacent reasoning items in the same thinking span are joined so multi-part streams stay whole.
 */
export function summarizeLiveActivity(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "turnItems"> | null,
  previous: ExtensionLiveActivity | null,
): ExtensionLiveActivity | null {
  if (projection === null || projection.runs.length === 0) return null;
  let latestRun = projection.runs[0]!;
  for (let index = 1; index < projection.runs.length; index += 1) {
    const candidate = projection.runs[index]!;
    if (candidate.ordinal >= latestRun.ordinal) latestRun = candidate;
  }
  const runItems = projection.turnItems
    .filter((item) => item.runId === latestRun.id)
    .toSorted((left, right) => left.ordinal - right.ordinal);

  let currentItem: OrchestrationV2TurnItem | null = null;
  let lastToolItem: OrchestrationV2TurnItem | null = null;
  let lastActivityAt: string | null = null;
  type ReasoningItem = Extract<OrchestrationV2TurnItem, { readonly type: "reasoning" }>;
  const reasoningGroups: Array<Array<ReasoningItem>> = [];
  let openGroup: Array<ReasoningItem> | null = null;

  for (const item of runItems) {
    const updated = DateTime.formatIso(item.updatedAt);
    if (lastActivityAt === null || updated > lastActivityAt) lastActivityAt = updated;
    if (ACTIVE_STEP_STATUSES.has(item.status)) {
      currentItem = item;
    } else if (TOOL_STEP_TYPES.has(item.type)) {
      lastToolItem = item;
    }
    if (item.type === "reasoning") {
      if (openGroup === null) {
        openGroup = [item];
        reasoningGroups.push(openGroup);
      } else {
        openGroup.push(item);
      }
    } else if (TOOL_STEP_TYPES.has(item.type) || item.type === "assistant_message") {
      openGroup = null;
    }
  }

  let reasoning: ExtensionLiveReasoning | null = null;
  for (let index = reasoningGroups.length - 1; index >= 0; index -= 1) {
    const group = reasoningGroups[index]!;
    const streaming = group.some((item) => item.streaming || item.status === "running");
    const parts = group.map((item) => item.text.trim()).filter((part) => part !== "");
    if (parts.length === 0 && !streaming) continue;
    const tail = group.at(-1)!;
    reasoning = {
      id: tail.id,
      ordinal: tail.ordinal,
      text: parts.join("\n\n"),
      streaming,
      status: tail.status,
      updatedAt: DateTime.formatIso(tail.updatedAt),
    };
    break;
  }

  const next: ExtensionLiveActivity = {
    runId: latestRun.id,
    status: latestRun.status,
    current: currentItem === null ? null : describeLiveStep(currentItem),
    last: lastToolItem === null ? null : describeLiveStep(lastToolItem),
    reasoning,
    lastActivityAt,
  };
  if (
    previous !== null &&
    previous.runId === next.runId &&
    previous.status === next.status &&
    sameLiveStep(previous.current, next.current) &&
    sameLiveStep(previous.last, next.last) &&
    sameLiveReasoning(previous.reasoning, next.reasoning) &&
    sameSecond(previous.lastActivityAt, next.lastActivityAt)
  ) {
    return previous;
  }
  return next;
}
