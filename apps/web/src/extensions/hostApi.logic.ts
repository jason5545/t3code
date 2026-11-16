import { arrayElementsEqual } from "@t3tools/client-runtime/state/entities";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import type {
  OrchestrationV2ShellSnapshot,
  ProviderApprovalDecision,
  ProviderApprovalOption,
} from "@t3tools/contracts";
import {
  REPLY_MAX_CHARS,
  REPLY_MAX_THREADS,
  REPLY_PREVIEW_CHARS,
  summarizeThreadShell,
  type ExtensionProjectInfo,
  type ExtensionThreadSummary,
} from "@t3tools/shared/extensionApi";

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
