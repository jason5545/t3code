import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import type { AnyRouter } from "@tanstack/react-router";

import { openCommandPalette } from "../commandPaletteBus";
import { useComposerDraftStore } from "../composerDraftStore";
import { shouldCreateNewThreadInCurrentProject } from "../components/Sidebar.logic";
import {
  createNewThreadHandler,
  readLastUsedProjectKey,
  resolveDefaultProjectRef,
} from "../hooks/useHandleNewThread";
import { getClientSettings } from "../hooks/useSettings";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { readProjects, readThreadShell } from "../state/entities";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { defaultProjectFallbackReadyAtom } from "../state/projects";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import type { ExtensionAction } from "./hostApi.logic";

/**
 * Fork patch 30: `t3.actions.useRun()`, the standard sidebar header's buttons for an interface
 * that has no sidebar. Like the `chat.new` shortcut, everything is read when the button is
 * pressed, so a board holding the function never re-renders for projects or drafts.
 */
export function createExtensionActions(router: AnyRouter) {
  const handleNewThread = createNewThreadHandler(router);

  const readContext = () => {
    const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
    const drafts = useComposerDraftStore.getState();
    const lastUsedProjectKey = readLastUsedProjectKey();
    return {
      activeDraftThread: target
        ? target.kind === "server"
          ? drafts.getDraftThread(target.threadRef)
          : drafts.getDraftSession(target.draftId)
        : null,
      activeThread:
        (target?.kind === "server" ? readThreadShell(target.threadRef) : null) ?? undefined,
      defaultProjectRef: resolveDefaultProjectRef(
        readProjects(),
        useUiStateStore.getState().projectOrder,
        lastUsedProjectKey,
        appAtomRegistry.get(defaultProjectFallbackReadyAtom(lastUsedProjectKey)),
      ),
      handleNewThread,
    };
  };

  const startInCurrentProject = () => {
    // With no current or open project, such as when every project is archived, pick one.
    void startNewThreadFromContext(readContext()).then((started) => {
      if (!started) openCommandPalette({ open: "new-thread-in" });
    });
  };

  return (action: ExtensionAction) => {
    switch (action) {
      case "newThread": {
        // Grouped like the sidebar, so the button agrees with the New thread shortcut.
        const groups = buildSidebarProjectSnapshots({
          projects: readProjects(),
          groupScratchProjects: true,
          settings: selectProjectGroupingSettings(getClientSettings()),
          primaryEnvironmentId: appAtomRegistry.get(primaryEnvironmentIdAtom),
          resolveEnvironmentLabel: () => null,
        });
        if (
          shouldCreateNewThreadInCurrentProject(
            false,
            groups.filter((group) => !group.archived).length,
            groups.length,
          )
        ) {
          startInCurrentProject();
        } else {
          openCommandPalette({ open: "new-thread-in" });
        }
        return;
      }
      case "newThreadInProject":
        startInCurrentProject();
        return;
      case "addProject":
        openCommandPalette({ open: "add-project" });
        return;
      case "search":
        openCommandPalette();
        return;
    }
  };
}
