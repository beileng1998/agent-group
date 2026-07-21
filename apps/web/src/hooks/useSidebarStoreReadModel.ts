// FILE: useSidebarStoreReadModel.ts
// Purpose: Read and derive the sidebar's stable store, workspace, project, and thread models.
// Layer: Web sidebar read model

import type { ThreadId } from "@agent-group/contracts";
import { useMemo } from "react";
import type { SidebarProjectSortOrder } from "../appSettings";
import { shouldRenderTerminalWorkspace } from "../components/ChatView.logic";
import {
  partitionSidebarThreadsByProjectIds,
  sortProjectsForSidebar,
} from "../components/Sidebar.logic";
import { useComposerDraftStore } from "../composerDraftStore";
import { useFocusedChatContext } from "../focusedChatContext";
import { isHomeChatContainerProject } from "../lib/chatProjects";
import { collectStudioProjectIds } from "../lib/studioProjects";
import { useStore } from "../store";
import {
  createSidebarDisplayThreadsSelector,
  createSidebarThreadSummariesSelector,
} from "../storeSelectors";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useTemporaryThreadStore } from "../temporaryThreadStore";
import { useWorkspaceStore } from "../workspaceStore";

export function useSidebarStoreReadModel(input: {
  readonly route: { readonly threadId: ThreadId | null };
  readonly settings: { readonly projectSortOrder: SidebarProjectSortOrder };
}) {
  const projects = useStore((store) => store.projects);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const sidebarThreadSummaryById = useStore((store) => store.sidebarThreadSummaryById);
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const temporaryThreadIds = useTemporaryThreadStore((store) => store.temporaryThreadIds);
  const homeDir = useWorkspaceStore((store) => store.homeDir);
  const chatWorkspaceRoot = useWorkspaceStore((store) => store.chatWorkspaceRoot);
  const studioWorkspaceRoot = useWorkspaceStore((store) => store.studioWorkspaceRoot);
  const { activeProjectId: focusedProjectId } = useFocusedChatContext();
  const selectSidebarThreads = useMemo(() => createSidebarThreadSummariesSelector(), []);
  const selectSidebarDisplayThreads = useMemo(() => createSidebarDisplayThreadsSelector(), []);
  const sidebarThreads = useStore(selectSidebarThreads);
  const sidebarDisplayThreads = useStore(selectSidebarDisplayThreads);
  const sortedProjects = useMemo(
    () => sortProjectsForSidebar(projects, sidebarThreads, input.settings.projectSortOrder),
    [input.settings.projectSortOrder, projects, sidebarThreads],
  );
  const standardProjectsBase = useMemo(
    () =>
      sortedProjects.filter(
        (project) =>
          project.kind === "project" &&
          !isHomeChatContainerProject(project, { homeDir, chatWorkspaceRoot }),
      ),
    [chatWorkspaceRoot, homeDir, sortedProjects],
  );
  const studioProjectIdSet = useMemo(
    () =>
      collectStudioProjectIds(projects, {
        homeDir,
        chatWorkspaceRoot,
        studioWorkspaceRoot,
      }),
    [chatWorkspaceRoot, homeDir, projects, studioWorkspaceRoot],
  );
  const { nonStudioThreads, studioThreads } = useMemo(
    () => partitionSidebarThreadsByProjectIds(sidebarThreads, studioProjectIdSet),
    [sidebarThreads, studioProjectIdSet],
  );
  const { nonStudioThreads: nonStudioDisplayThreads, studioThreads: studioDisplayThreads } =
    useMemo(
      () => partitionSidebarThreadsByProjectIds(sidebarDisplayThreads, studioProjectIdSet),
      [sidebarDisplayThreads, studioProjectIdSet],
    );
  const routeState = input.route.threadId
    ? selectThreadTerminalState(terminalStateByThreadId, input.route.threadId)
    : null;
  const terminalOpen = routeState?.terminalOpen ?? false;
  const terminalWorkspaceOpen = shouldRenderTerminalWorkspace({
    presentationMode: routeState?.presentationMode ?? "drawer",
    terminalOpen,
  });
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );
  const projectCwdById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cwd] as const)),
    [projects],
  );

  return {
    store: {
      projects,
      threadsHydrated,
      sidebarThreadSummaryById,
      terminalStateByThreadId,
      draftThreadsByThreadId,
      temporaryThreadIds,
    },
    workspace: {
      homeDir,
      chatWorkspaceRoot,
      studioWorkspaceRoot,
      focusedProjectId,
    },
    projects: {
      sorted: sortedProjects,
      standardBase: standardProjectsBase,
      studioIds: studioProjectIdSet,
      byId: projectsById,
      cwdById: projectCwdById,
    },
    threads: {
      all: sidebarThreads,
      display: sidebarDisplayThreads,
      nonStudio: nonStudioThreads,
      studio: studioThreads,
      nonStudioDisplay: nonStudioDisplayThreads,
      studioDisplay: studioDisplayThreads,
    },
    terminal: {
      routeState,
      open: terminalOpen,
      workspaceOpen: terminalWorkspaceOpen,
    },
  };
}

export type SidebarStoreReadModel = ReturnType<typeof useSidebarStoreReadModel>;
