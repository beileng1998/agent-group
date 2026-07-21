// FILE: useSidebarWorkspaceOwner.ts
// Purpose: Own sidebar workspace terminal status, rename, delete, reorder, and creation actions.
// Layer: Web sidebar controller

import type { DragEndEvent } from "@dnd-kit/core";
import { useCallback, useMemo, useState } from "react";
import { readNativeApi } from "../nativeApi";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { terminalStatusFromThreadState } from "../components/sidebar/SidebarThreadPresentation";
import { terminalRuntimeRegistry } from "../components/terminal/terminalRuntimeRegistry";
import { useWorkspaceStore, workspaceThreadId } from "../workspaceStore";

interface UseSidebarWorkspaceOwnerInput {
  routeWorkspaceId: string | null;
  navigateToWorkspace: (workspaceId: string, options?: { replace?: boolean }) => void;
}

export function useSidebarWorkspaceOwner({
  routeWorkspaceId,
  navigateToWorkspace,
}: UseSidebarWorkspaceOwnerInput) {
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const workspacePages = useWorkspaceStore((store) => store.workspacePages);
  const createWorkspace = useWorkspaceStore((store) => store.createWorkspace);
  const renameWorkspace = useWorkspaceStore((store) => store.renameWorkspace);
  const deleteWorkspace = useWorkspaceStore((store) => store.deleteWorkspace);
  const reorderWorkspace = useWorkspaceStore((store) => store.reorderWorkspace);
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null);
  const [renamingWorkspaceTitle, setRenamingWorkspaceTitle] = useState("");

  const rows = useMemo(
    () =>
      workspacePages.map((workspace) => {
        const terminalState = selectThreadTerminalState(
          terminalStateByThreadId,
          workspaceThreadId(workspace.id),
        );
        return {
          ...workspace,
          terminalCount: terminalState.terminalOpen ? terminalState.terminalIds.length : 0,
          terminalStatus: terminalStatusFromThreadState({
            runningTerminalIds: terminalState.runningTerminalIds,
            terminalAttentionStatesById: terminalState.terminalAttentionStatesById,
          }),
          runningTerminalIds: terminalState.runningTerminalIds,
        };
      }),
    [terminalStateByThreadId, workspacePages],
  );

  const create = useCallback(() => {
    const workspaceId = createWorkspace();
    navigateToWorkspace(workspaceId);
  }, [createWorkspace, navigateToWorkspace]);
  const beginRename = useCallback((workspaceId: string, title: string) => {
    setRenamingWorkspaceId(workspaceId);
    setRenamingWorkspaceTitle(title);
  }, []);
  const cancelRename = useCallback((title: string) => {
    setRenamingWorkspaceId(null);
    setRenamingWorkspaceTitle(title);
  }, []);
  const commitRename = useCallback(() => {
    if (!renamingWorkspaceId) return;
    renameWorkspace(renamingWorkspaceId, renamingWorkspaceTitle);
    setRenamingWorkspaceId(null);
  }, [renameWorkspace, renamingWorkspaceId, renamingWorkspaceTitle]);
  const remove = useCallback(
    async (workspaceId: string) => {
      const workspaceThread = workspaceThreadId(workspaceId);
      const api = readNativeApi();
      const terminalState = selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadId,
        workspaceThread,
      );

      if (api && typeof api.terminal.close === "function") {
        terminalRuntimeRegistry.disposeThread(workspaceThread);
        await Promise.allSettled(
          terminalState.terminalIds.map((terminalId) =>
            api.terminal.close({
              threadId: workspaceThread,
              terminalId,
              deleteHistory: true,
            }),
          ),
        );
      }

      clearTerminalState(workspaceThread);
      deleteWorkspace(workspaceId);
      const nextWorkspaceId = useWorkspaceStore.getState().workspacePages[0]?.id ?? null;
      if (routeWorkspaceId === workspaceId && nextWorkspaceId) {
        navigateToWorkspace(nextWorkspaceId, { replace: true });
      }
    },
    [clearTerminalState, deleteWorkspace, navigateToWorkspace, routeWorkspaceId],
  );
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const nextIndex = workspacePages.findIndex((workspace) => workspace.id === String(over.id));
      if (nextIndex >= 0) reorderWorkspace(String(active.id), nextIndex);
    },
    [reorderWorkspace, workspacePages],
  );

  return {
    actions: {
      beginRename,
      cancelRename,
      commitRename,
      create,
      handleDragEnd,
      navigateToWorkspace,
      remove,
      setRenamingWorkspaceTitle,
    },
    model: {
      renamingWorkspaceId,
      renamingWorkspaceTitle,
      routeWorkspaceId,
      rows,
    },
  };
}

export type SidebarWorkspaceOwner = ReturnType<typeof useSidebarWorkspaceOwner>;
