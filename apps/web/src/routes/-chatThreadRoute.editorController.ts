// FILE: -chatThreadRoute.editorController.ts
// Purpose: Own the single-thread editor route state, navigation, and diff coordination.
// Layer: Chat route controller

import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { ProjectId, ThreadId, TurnId } from "@agent-group/contracts";
import { isWorkspaceRelativePathSafe } from "@agent-group/shared/path";
import type { QueryClient } from "@tanstack/react-query";
import type { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AppSettings } from "../appSettings";
import { sortThreadsForSidebar } from "../components/Sidebar.logic";
import { toastManager } from "../components/ui/toast";
import type { DiffRouteSearch } from "../diffRouteSearch";
import { stripDiffSearchParams } from "../diffRouteSearch";
import { readEditorViewState, storeEditorViewState } from "../editorViewState";
import type { NewThreadNavigationOptions, useHandleNewThread } from "../hooks/useHandleNewThread";
import { projectListDirectoriesQueryOptions } from "../lib/projectReactQuery";
import type { NewThreadOptions } from "../lib/threadBootstrap";
import type { SplitViewPanePanelState } from "../splitViewStore";
import type { Project, SidebarThreadSummary } from "../types";
import { collectParentDirectoryPaths, stripEditorViewSearchParams } from "./-chatThreadRoute.logic";

export type EditorCenterMode = "file" | "diff";

type Navigate = ReturnType<typeof useNavigate>;
type HandleNewThread = ReturnType<typeof useHandleNewThread>["handleNewThread"];

export interface SingleChatEditorControllerInput {
  threadId: ThreadId;
  search: DiffRouteSearch;
  workspaceRoot: string | null;
  projects: ReadonlyArray<Project>;
  threadSummaries: ReadonlyArray<SidebarThreadSummary>;
  appSettings: Pick<AppSettings, "defaultThreadEnvMode" | "sidebarThreadSortOrder">;
  queryClient: QueryClient;
  navigate: Navigate;
  handleNewThread: HandleNewThread;
}

function editorNavigationSearch(previous: Record<string, unknown>): Record<string, unknown> {
  return {
    ...stripEditorViewSearchParams(stripDiffSearchParams(previous)),
    view: "editor",
  };
}

export function useSingleChatEditorController(input: SingleChatEditorControllerInput) {
  const {
    appSettings,
    handleNewThread,
    navigate,
    projects,
    queryClient,
    search,
    threadId,
    threadSummaries,
    workspaceRoot,
  } = input;
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(
    () => new Set(readEditorViewState(threadId)?.expandedDirectories ?? []),
  );
  const [centerMode, setCenterMode] = useState<EditorCenterMode>(() =>
    search.editorFilePath ? "file" : (readEditorViewState(threadId)?.centerMode ?? "diff"),
  );
  const editorViewStateThreadIdRef = useRef(threadId);
  const editorViewActive = search.view === "editor";
  const [diffPanelState, setDiffPanelState] = useState<
    Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">
  >({
    panel: "diff",
    diffTurnId: search.diffTurnId ?? null,
    diffFilePath: search.diffFilePath ?? null,
  });
  const [diffFiles, setDiffFiles] = useState<ReadonlyArray<FileDiffMetadata>>([]);
  const [diffFilesLoading, setDiffFilesLoading] = useState(false);
  const [diffOptionsControl, setDiffOptionsControl] = useState<ReactNode | null>(null);

  // The route component is reused across thread navigation. Preserve the old
  // behavior: only the persisted explorer + center state reload per thread;
  // diff panel state remains owned by this mounted route instance.
  useEffect(() => {
    if (editorViewStateThreadIdRef.current === threadId) {
      return;
    }
    editorViewStateThreadIdRef.current = threadId;
    const persisted = readEditorViewState(threadId);
    setExpandedDirectories(new Set(persisted?.expandedDirectories ?? []));
    setCenterMode(search.editorFilePath ? "file" : (persisted?.centerMode ?? "diff"));
  }, [search.editorFilePath, threadId]);

  useEffect(() => {
    if (!editorViewActive) {
      return;
    }
    storeEditorViewState(threadId, {
      expandedDirectories: [...expandedDirectories],
      centerMode,
    });
  }, [centerMode, editorViewActive, expandedDirectories, threadId]);

  const close = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => stripEditorViewSearchParams(stripDiffSearchParams(previous)),
    });
  }, [navigate, threadId]);

  const selectFile = useCallback(
    (filePath: string) => {
      setCenterMode("file");
      void navigate({
        to: "/$threadId",
        params: { threadId },
        replace: true,
        search: (previous) => ({
          ...stripDiffSearchParams(previous),
          view: "editor",
          editorFilePath: filePath,
        }),
      });
    },
    [navigate, threadId],
  );

  const toggleDirectory = useCallback((directoryPath: string) => {
    setExpandedDirectories((previous) => {
      const next = new Set(previous);
      if (next.has(directoryPath)) {
        next.delete(directoryPath);
      } else {
        next.add(directoryPath);
      }
      return next;
    });
  }, []);

  const toggleDiff = useCallback(() => {
    setCenterMode((current) => (current === "diff" && search.editorFilePath ? "file" : "diff"));
  }, [search.editorFilePath]);

  const openTurnDiff = useCallback((turnId: TurnId, filePath?: string) => {
    setCenterMode("diff");
    setDiffPanelState({
      panel: "diff",
      diffTurnId: turnId,
      diffFilePath: filePath ?? null,
    });
  }, []);

  const updateDiffPanelState = useCallback(
    (patch: Partial<Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">>) => {
      setDiffPanelState((previous) => ({
        panel: "diff",
        diffTurnId: "diffTurnId" in patch ? (patch.diffTurnId ?? null) : previous.diffTurnId,
        diffFilePath:
          "diffFilePath" in patch ? (patch.diffFilePath ?? null) : previous.diffFilePath,
      }));
    },
    [],
  );

  const updateDiffFiles = useCallback(
    (files: ReadonlyArray<FileDiffMetadata>, isLoading: boolean) => {
      setDiffFiles(files);
      setDiffFilesLoading(isLoading);
    },
    [],
  );

  const selectDiffFile = useCallback((filePath: string) => {
    setCenterMode("diff");
    setDiffPanelState((previous) => ({
      ...previous,
      panel: "diff",
      diffFilePath: filePath,
    }));
  }, []);

  const updateDiffOptions = useCallback((control: ReactNode | null) => {
    setDiffOptionsControl(control);
  }, []);

  const projectOptions = useMemo(
    () =>
      projects.flatMap((project) =>
        project.kind === "project" ? [{ id: project.id, name: project.name }] : [],
      ),
    [projects],
  );

  const openProject = useCallback(
    async (projectId: ProjectId) => {
      const latestThread = sortThreadsForSidebar(
        threadSummaries.filter((thread) => thread.projectId === projectId),
        appSettings.sidebarThreadSortOrder,
      )[0];

      if (latestThread) {
        await navigate({
          to: "/$threadId",
          params: { threadId: latestThread.id },
          search: editorNavigationSearch,
        });
        return;
      }

      await handleNewThread(
        projectId,
        {
          envMode: appSettings.defaultThreadEnvMode,
        } satisfies NewThreadOptions,
        {
          search: editorNavigationSearch,
        } satisfies NewThreadNavigationOptions,
      );
    },
    [
      appSettings.defaultThreadEnvMode,
      appSettings.sidebarThreadSortOrder,
      handleNewThread,
      navigate,
      threadSummaries,
    ],
  );

  const selectProject = useCallback(
    (projectId: ProjectId) => {
      void openProject(projectId).catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Unable to open project",
          description: error instanceof Error ? error.message : "The project could not be opened.",
        });
      });
    },
    [openProject],
  );

  // Never let an attacker-crafted route query issue traversal reads or
  // directory prefetches outside the active workspace.
  const rawSelectedFilePath = search.editorFilePath ?? null;
  const selectedFilePath =
    rawSelectedFilePath !== null && isWorkspaceRelativePathSafe(rawSelectedFilePath)
      ? rawSelectedFilePath
      : null;

  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }

    const parentPaths = collectParentDirectoryPaths(selectedFilePath);
    if (parentPaths.length === 0) {
      return;
    }

    if (workspaceRoot) {
      for (const parentPath of parentPaths) {
        void queryClient.prefetchQuery(
          projectListDirectoriesQueryOptions({
            cwd: workspaceRoot,
            relativePath: parentPath,
            includeFiles: true,
          }),
        );
      }
    }

    setExpandedDirectories((previous) => {
      let changed = false;
      const next = new Set(previous);
      for (const parentPath of parentPaths) {
        if (!next.has(parentPath)) {
          next.add(parentPath);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [queryClient, selectedFilePath, workspaceRoot]);

  const chatPanelState = useMemo<SplitViewPanePanelState>(
    () => ({
      panel: centerMode === "diff" ? "diff" : null,
      diffTurnId: diffPanelState.diffTurnId,
      diffFilePath: diffPanelState.diffFilePath,
      hasOpenedPanel: true,
      lastOpenPanel: "browser",
    }),
    [centerMode, diffPanelState.diffFilePath, diffPanelState.diffTurnId],
  );

  return {
    route: {
      isActive: editorViewActive,
      close,
    },
    explorer: {
      selectedFilePath,
      expandedDirectories,
      selectFile,
      toggleDirectory,
    },
    center: {
      mode: centerMode,
      setMode: setCenterMode,
    },
    diff: {
      panelState: diffPanelState,
      files: diffFiles,
      filesLoading: diffFilesLoading,
      optionsControl: diffOptionsControl,
      selectFile: selectDiffFile,
      updatePanelState: updateDiffPanelState,
      updateFiles: updateDiffFiles,
      updateOptions: updateDiffOptions,
    },
    project: {
      options: projectOptions,
      select: selectProject,
    },
    chatPanel: {
      state: chatPanelState,
      toggleDiff,
      openTurnDiff,
    },
  };
}
