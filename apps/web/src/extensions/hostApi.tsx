import { useAtomValue } from "@effect/atom-react";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { EXTENSION_API_VERSION, type ExtensionThreadSummary } from "@t3tools/shared/extensionApi";
import { Outlet, useNavigate, useParams } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { AppSidebarLayout } from "../components/AppSidebarLayout";
import { CommandPalette } from "../components/CommandPalette";
import { environmentCatalog } from "../connection/catalog";
import { newMessageId } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { readEnvironmentScope } from "../state/session";
import { threadEnvironment } from "../state/threads";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
import { collectThreadSummaries } from "./hostApi.logic";

/**
 * Fork patch 30: what an installed web part reaches beyond React, slots and its own calls.
 * Extensions see `ExtensionThreadSummary`, never upstream's types, so when upstream reshapes
 * the shell or the layout this file changes and the extensions do not.
 */
export interface ThreadRef {
  readonly environmentId: string;
  readonly threadId: string;
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
    /** The current route's page without the standard sidebar. It is as tall as the window. */
    readonly CurrentPage: () => React.ReactNode;
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
  };
  readonly pages: {
    /** Since API 3: a function that opens one of T3's own pages, drawn over the interface. */
    readonly useOpen: () => (page: ExtensionPage) => void;
  };
}

/** Pages by name, so an upstream route rename changes this table and not the extensions. */
const PAGE_ROUTES = { settings: "/settings", usage: "/usage" } as const;
export type ExtensionPage = keyof typeof PAGE_ROUTES;

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

function CurrentPage() {
  return (
    <CommandPalette>
      <AppSidebarLayout showSidebar={false}>
        <Outlet />
      </AppSidebarLayout>
    </CommandPalette>
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
    if (!Object.hasOwn(PAGE_ROUTES, page)) {
      throw new TypeError(`pages.useOpen opens ${Object.keys(PAGE_ROUTES).join(" or ")}.`);
    }
    void navigate({ to: PAGE_ROUTES[page] });
  };
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

const webHostApi: WebHostApi = Object.freeze({
  apiVersion: EXTENSION_API_VERSION,
  components: Object.freeze({ CurrentPage }),
  environments: Object.freeze({ use: () => useAtomValue(environmentsAtom) }),
  threads: Object.freeze({
    use: () => useAtomValue(threadSummariesAtom),
    useCurrent: useCurrentThread,
    useOpen: useOpenThread,
    send: sendToThread,
    interrupt: interruptThread,
  }),
  pages: Object.freeze({ useOpen: useOpenPage }),
});

/** One frozen object; every web part gets the same one. */
export const readWebHostApi = () => webHostApi;
