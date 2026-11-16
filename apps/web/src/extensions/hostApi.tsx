import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import {
  EXTENSION_API_VERSION,
  type ExtensionReply,
  type ExtensionThreadSummary,
} from "@t3tools/shared/extensionApi";
import { Outlet, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { AppSidebarLayout } from "../components/AppSidebarLayout";
import { CommandPalette } from "../components/CommandPalette";
import { readPullRequestListPreferences } from "../components/pullRequest/pullRequestListPreferences";
import { environmentCatalog } from "../connection/catalog";
import { shortcutLabelForCommand } from "../keybindings";
import { newMessageId } from "../lib/utils";
import { navigateHistory, useCanNavigateHistory } from "../navigationHistory";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import { usePullRequestsSupported } from "../state/environments";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { primaryServerKeybindingsAtom } from "../state/server";
import { readEnvironmentScope } from "../state/session";
import { environmentThreadDetails, threadEnvironment } from "../state/threads";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
import { callExtension } from "./commands";
import { ExtensionHidesComposer } from "./composerVisibility";
import { createExtensionActions } from "./hostActions";
import {
  availableExtensionPages,
  collectThreadSummaries,
  EXTENSION_ACTIONS,
  EXTENSION_PAGES,
  planReplyReads,
  readExtensionName,
  readRequestResponse,
  summarizePendingRequest,
  type ExtensionAction,
  type ExtensionPage,
  type ExtensionPendingRequest,
} from "./hostApi.logic";
import { StatusNotices } from "./StatusNotices";

export type { ExtensionAction, ExtensionPage, ExtensionPendingRequest };

/**
 * Fork patch 30: what an installed web part reaches beyond React, slots and its own calls.
 * Extensions see `ExtensionThreadSummary`, never upstream's types, so when upstream reshapes
 * the shell or the layout this file changes and the extensions do not.
 */
export interface ThreadRef {
  readonly environmentId: string;
  readonly threadId: string;
}

/** Since API 4: one thread's reply as `t3.threads.readReplies` answers it. */
export interface ExtensionReplyResult {
  readonly ref: ThreadRef;
  /** Null when the thread has no finished assistant message yet, or the read failed. */
  readonly reply: ExtensionReply | null;
  /** Why its environment did not answer: offline, or a server older than API 4. */
  readonly error: string | null;
}

export interface ExtensionEnvironment {
  readonly id: string;
  readonly label: string;
  readonly primary: boolean;
  readonly connected: boolean;
}

export interface WebHostApi {
  readonly apiVersion: number;
  readonly components: {
    /**
     * The current route's page without the standard sidebar. It is as tall as the window.
     * Since API 4, `composer: false` leaves out an open thread's composer while no approval or
     * question waits; a new thread's draft keeps it.
     */
    readonly CurrentPage: (props?: { readonly composer?: boolean }) => React.ReactNode;
    /**
     * Since API 3: the standard sidebar footer's notices (undo, provider and app updates), on
     * the app's sidebar colours. Its width follows what it shows, up to about 34rem.
     */
    readonly StatusNotices: () => React.ReactNode;
  };
  readonly environments: { readonly use: () => ReadonlyArray<ExtensionEnvironment> };
  readonly threads: {
    /** Threads of every connected environment, newest update first, archived ones left out. */
    readonly use: () => ReadonlyArray<ExtensionThreadSummary>;
    /** The thread the current route shows, or null. */
    readonly useCurrent: () => ThreadRef | null;
    /** A function that shows a thread in `CurrentPage`. */
    readonly useOpen: () => (ref: ThreadRef) => void;
    /** Sends a message as the user. `steer` reaches the running turn; `queue` waits for it. */
    readonly send: (
      ref: ThreadRef,
      text: string,
      options?: { readonly mode?: "queue" | "steer" },
    ) => Promise<void>;
    /** Stops the running turn; resolves even when nothing was running. */
    readonly interrupt: (ref: ThreadRef) => Promise<void>;
    /**
     * Since API 4: each thread's newest finished assistant message, read from the thread's own
     * environment, in the order asked. First 600 characters, or the whole message (up to
     * 100,000) with `full`. Shell rows carry no message bodies, so this is how to read reports.
     */
    readonly readReplies: (
      refs: ReadonlyArray<ThreadRef>,
      options?: { readonly full?: boolean },
    ) => Promise<ReadonlyArray<ExtensionReplyResult>>;
    /**
     * Since API 4: the approval or question the thread waits on, oldest approval first, or null.
     * It follows the thread's detail, as an open thread does, so call it only for threads that
     * have a `pendingRequest`. Secret and link cards are never here: only the user answers them,
     * in the thread itself (`pendingRequest.userOnly`).
     */
    readonly useRequest: (ref: ThreadRef | null) => ExtensionPendingRequest | null;
    /**
     * Since API 4: answers a request `useRequest` shows while it is mounted: `{ decision }` with
     * one of the approval's options, or `{ answers }` with an option `value` (an array for a
     * multiple choice) or the user's own words for every question id.
     */
    readonly respond: (ref: ThreadRef, requestId: string, response: unknown) => Promise<void>;
  };
  readonly pages: {
    /**
     * Since API 3: a function that opens one of T3's own pages. Settings and Usage are drawn
     * over the interface; home (a new thread) and pull requests open in `CurrentPage`.
     */
    readonly useOpen: () => (page: ExtensionPage) => void;
    /** Since API 3: the pages this environment has; pull requests need a supported forge. */
    readonly useAvailable: () => ReadonlyArray<ExtensionPage>;
  };
  /** Since API 3: the standard sidebar header's buttons, by name. */
  readonly actions: {
    readonly useRun: () => (action: ExtensionAction) => void;
  };
  /** Since API 3: the window's back and forward, as the sidebar's arrows use them. */
  readonly navigation: {
    readonly useHistory: () => {
      readonly canGoBack: boolean;
      readonly canGoForward: boolean;
      readonly go: (direction: "back" | "forward") => void;
    };
  };
  /** Since API 3: the user's shortcut for each named action, as tooltip text, or null. */
  readonly shortcuts: {
    readonly useLabels: () => Readonly<Record<ExtensionShortcut, string | null>>;
  };
}

/** Pages by name, so an upstream route rename changes this table and not the extensions. */
const PAGE_ROUTES = {
  home: "/",
  settings: "/settings",
  usage: "/usage",
  pullRequests: "/pull-requests",
} as const satisfies Record<ExtensionPage, string>;

const SHORTCUT_COMMANDS = {
  back: "navigation.back",
  forward: "navigation.forward",
  newThread: "chat.new",
  newThreadInProject: "chat.newLocal",
  search: "commandPalette.toggle",
  usage: "usage.open",
} as const;
export type ExtensionShortcut = keyof typeof SHORTCUT_COMMANDS;

const threadSummariesAtom = Atom.make((get): ReadonlyArray<ExtensionThreadSummary> =>
  collectThreadSummaries(
    Array.from(
      enabledEnvironmentIds(get(environmentCatalog.catalogValueAtom)),
      (environmentId) => ({
        environmentId,
        snapshot: get(threadEnvironment.snapshotAtom(environmentId)),
      }),
    ),
    Option.getOrNull(get.self<ReadonlyArray<ExtensionThreadSummary>>()),
  ),
).pipe(Atom.withLabel("extension-thread-summaries"));

const environmentsAtom = Atom.make((get): ReadonlyArray<ExtensionEnvironment> => {
  const primary = get(primaryEnvironmentIdAtom);
  const next = [...get(environmentPresentations.presentationsAtom)].map(
    ([id, presentation]): ExtensionEnvironment => ({
      id,
      label: presentation.entry.target.label,
      primary: id === primary,
      connected: presentation.connection.phase === "connected",
    }),
  );
  const previous = Option.getOrNull(get.self<ReadonlyArray<ExtensionEnvironment>>());
  return previous !== null &&
    previous.length === next.length &&
    next.every(
      (environment, index) =>
        environment.id === previous[index]?.id &&
        environment.label === previous[index]?.label &&
        environment.primary === previous[index]?.primary &&
        environment.connected === previous[index]?.connected,
    )
    ? previous
    : next;
}).pipe(Atom.withLabel("extension-environments"));

function CurrentPage(props?: { readonly composer?: boolean }) {
  return (
    <ExtensionHidesComposer.Provider value={props?.composer === false}>
      <CommandPalette>
        <AppSidebarLayout showSidebar={false}>
          <Outlet />
        </AppSidebarLayout>
      </CommandPalette>
    </ExtensionHidesComposer.Provider>
  );
}

function useCurrentThread(): ThreadRef | null {
  const target = resolveThreadRouteTarget(useParams({ strict: false }));
  if (target?.kind !== "server") return null;
  return { environmentId: target.threadRef.environmentId, threadId: target.threadRef.threadId };
}

function useOpenThread() {
  const navigate = useNavigate();
  return (ref: ThreadRef) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(
        scopeThreadRef(EnvironmentId.make(ref.environmentId), ThreadId.make(ref.threadId)),
      ),
    });
  };
}

function useOpenPage() {
  const navigate = useNavigate();
  return (page: ExtensionPage) => {
    const name = readExtensionName(EXTENSION_PAGES, page, "pages.useOpen()");
    if (name === "pullRequests") {
      void navigate({ to: PAGE_ROUTES.pullRequests, search: readPullRequestListPreferences() });
      return;
    }
    void navigate({ to: PAGE_ROUTES[name] });
  };
}

const usePagesAvailable = () => availableExtensionPages(usePullRequestsSupported());

function useRunAction() {
  const router = useRouter();
  // One per mounted interface; the actions read everything when they run.
  const [run] = useState(() => createExtensionActions(router));
  return (action: ExtensionAction) =>
    run(readExtensionName(EXTENSION_ACTIONS, action, "actions.useRun()"));
}

function useHistory() {
  const canGoBack = useCanNavigateHistory("back");
  const canGoForward = useCanNavigateHistory("forward");
  return {
    canGoBack,
    canGoForward,
    go: (direction: "back" | "forward") =>
      navigateHistory(direction === "forward" ? "forward" : "back"),
  };
}

function useShortcutLabels() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const labels = {} as Record<ExtensionShortcut, string | null>;
  for (const [name, command] of Object.entries(SHORTCUT_COMMANDS)) {
    labels[name as ExtensionShortcut] = shortcutLabelForCommand(keybindings, command) ?? null;
  }
  return labels;
}

const readShell = (ref: ThreadRef): OrchestrationV2ThreadShell => {
  const snapshot = appAtomRegistry.get(
    threadEnvironment.snapshotAtom(EnvironmentId.make(ref.environmentId)),
  );
  const shell = snapshot?.threads.find((thread) => thread.id === ref.threadId);
  if (shell === undefined) throw new Error("That thread is not on a connected environment.");
  if (!readEnvironmentScope(EnvironmentId.make(ref.environmentId), AuthOrchestrationOperateScope)) {
    throw new Error("This connection cannot change threads.");
  }
  return shell;
};

const failure = (result: {
  readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
}) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error : new Error(String(error));
};

async function sendToThread(
  ref: ThreadRef,
  text: string,
  options?: { readonly mode?: "queue" | "steer" },
) {
  if (typeof text !== "string" || text.trim() === "") throw new TypeError("send takes a message.");
  const shell = readShell(ref);
  const result = await runAtomCommand(
    appAtomRegistry,
    threadEnvironment.startTurn,
    {
      environmentId: EnvironmentId.make(ref.environmentId),
      input: {
        threadId: shell.id,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        dispatchMode: options?.mode === "steer" ? "steer" : "queue",
        createdAt: new Date().toISOString(),
      },
    },
    { label: "extension:send", reportFailure: false, reportDefect: true },
  );
  if (result._tag === "Failure") throw failure(result);
}

async function interruptThread(ref: ThreadRef) {
  const shell = readShell(ref);
  const result = await runAtomCommand(
    appAtomRegistry,
    threadEnvironment.interruptTurn,
    { environmentId: EnvironmentId.make(ref.environmentId), input: { threadId: shell.id } },
    { label: "extension:interrupt", reportFailure: false, reportDefect: true },
  );
  if (result._tag === "Failure") throw failure(result);
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function readReplies(
  refs: ReadonlyArray<ThreadRef>,
  options?: { readonly full?: boolean },
): Promise<ReadonlyArray<ExtensionReplyResult>> {
  const plan = planReplyReads(refs, options?.full === true);
  const key = (environmentId: string, threadId: string) => `${environmentId}\u0000${threadId}`;
  const replies = new Map<string, ExtensionReply>();
  const errors = new Map<string, string>();
  await Promise.all(
    plan.batches.map(async ({ environmentId, threadIds }) => {
      try {
        const result = await runAtomCommand(
          appAtomRegistry,
          callExtension,
          {
            environmentId: EnvironmentId.make(environmentId),
            request: {
              id: "extension-manager",
              method: "latestReplies",
              input: { threadIds, chars: plan.chars },
            },
          },
          { label: "extension:replies", reportFailure: false, reportDefect: true },
        );
        if (result._tag === "Failure") throw failure(result);
        const answer = Option.getOrNull(result.value);
        if (answer === null) throw new Error("That environment is not connected.");
        if (!answer.ok) throw new Error(answer.error);
        for (const reply of answer.value as ReadonlyArray<ExtensionReply>) {
          replies.set(key(environmentId, reply.threadId), reply);
        }
      } catch (error) {
        for (const threadId of threadIds)
          errors.set(key(environmentId, threadId), errorMessage(error));
      }
    }),
  );
  return refs.map((ref) => ({
    ref: { environmentId: ref.environmentId, threadId: ref.threadId },
    reply: replies.get(key(ref.environmentId, ref.threadId)) ?? null,
    error: errors.get(key(ref.environmentId, ref.threadId)) ?? null,
  }));
}

const readThreadRef = (ref: unknown, caller: string): ThreadRef => {
  if (
    typeof ref !== "object" ||
    ref === null ||
    !("environmentId" in ref) ||
    !("threadId" in ref) ||
    typeof ref.environmentId !== "string" ||
    typeof ref.threadId !== "string"
  ) {
    throw new TypeError(`${caller} takes { environmentId, threadId }.`);
  }
  return { environmentId: ref.environmentId, threadId: ref.threadId };
};

const scoped = (ref: ThreadRef) =>
  scopeThreadRef(EnvironmentId.make(ref.environmentId), ThreadId.make(ref.threadId));

const NO_PENDING_REQUESTS = Atom.make<PendingThreadRequests | null>(null).pipe(
  Atom.withLabel("extension-no-pending-requests"),
);

function useRequest(ref: ThreadRef | null): ExtensionPendingRequest | null {
  const checked = ref === null ? null : readThreadRef(ref, "threads.useRequest()");
  const pending = useAtomValue(
    checked === null
      ? NO_PENDING_REQUESTS
      : environmentThreadDetails.pendingRequestsAtom(scoped(checked)),
  );
  return summarizePendingRequest(pending);
}

async function respondToRequest(refInput: ThreadRef, requestId: string, response: unknown) {
  const ref = readThreadRef(refInput, "threads.respond()");
  if (typeof requestId !== "string") throw new TypeError("threads.respond() takes a request id.");
  const shell = readShell(ref);
  if (shell.pendingRuntimeRequest?.id === requestId && shell.pendingRuntimeRequest.userOnly) {
    throw new Error("Only the user answers this request, in the thread itself.");
  }
  // Read from the detail `useRequest` keeps mounted; without it nothing is loaded to check against.
  const pending = appAtomRegistry.get(environmentThreadDetails.pendingRequestsAtom(scoped(ref)));
  const request = summarizePendingRequest(
    pending === null
      ? null
      : {
          approvals: pending.approvals.filter((approval) => approval.requestId === requestId),
          userInputs: pending.userInputs.filter((input) => input.requestId === requestId),
        },
  );
  if (request === null) {
    throw new Error("That request is not waiting any more, or useRequest does not show it.");
  }
  const answer = readRequestResponse(request, response);
  const environmentId = EnvironmentId.make(ref.environmentId);
  const options = { label: "extension:respond", reportFailure: false, reportDefect: true };
  const result =
    answer.type === "approval"
      ? await runAtomCommand(
          appAtomRegistry,
          threadEnvironment.respondToApproval,
          {
            environmentId,
            input: {
              threadId: shell.id,
              requestId: RuntimeRequestId.make(requestId),
              decision: answer.decision,
            },
          },
          options,
        )
      : await runAtomCommand(
          appAtomRegistry,
          threadEnvironment.respondToUserInput,
          {
            environmentId,
            input: {
              threadId: shell.id,
              requestId: RuntimeRequestId.make(requestId),
              answers: answer.answers,
            },
          },
          options,
        );
  if (result._tag === "Failure") throw failure(result);
}

const webHostApi: WebHostApi = Object.freeze({
  apiVersion: EXTENSION_API_VERSION,
  components: Object.freeze({ CurrentPage, StatusNotices }),
  environments: Object.freeze({ use: () => useAtomValue(environmentsAtom) }),
  threads: Object.freeze({
    use: () => useAtomValue(threadSummariesAtom),
    useCurrent: useCurrentThread,
    useOpen: useOpenThread,
    send: sendToThread,
    interrupt: interruptThread,
    readReplies,
    useRequest,
    respond: respondToRequest,
  }),
  pages: Object.freeze({ useOpen: useOpenPage, useAvailable: usePagesAvailable }),
  actions: Object.freeze({ useRun: useRunAction }),
  navigation: Object.freeze({ useHistory }),
  shortcuts: Object.freeze({ useLabels: useShortcutLabels }),
});

/** One frozen object; every web part gets the same one. */
export const readWebHostApi = () => webHostApi;
