// FILE: useChatTerminalController.ts
// Purpose: Own ChatView terminal state, navigation, lifecycle, and focus actions.
// Layer: Web chat terminal controller

import { type ThreadId } from "@agent-group/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { useAppSettings } from "../appSettings";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  shouldAutoDeleteTerminalThreadOnLastClose,
  shouldRenderTerminalWorkspace,
} from "../components/ChatView.threadPresentation";
import { randomTerminalId } from "../components/terminal/terminalId";
import { disposeAndCloseTerminalSession } from "../components/terminal/terminalSession";
import { useHandleNewChat } from "./useHandleNewChat";
import { reconcileDeletedThreadFromClient } from "../lib/deletedThreadClientReconciliation";
import {
  confirmTerminalTabClose,
  resolveTerminalCloseTitle,
  shouldPromptForTerminalClose,
} from "../lib/terminalCloseConfirmation";
import { resolveTerminalNewAction } from "../lib/terminalNewAction";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import {
  resolveSplitViewFocusedThreadId,
  selectSplitView,
  type SplitViewId,
  useSplitViewStore,
} from "../splitViewStore";
import { useStore } from "../store";
import { collectTerminalIdsFromLayout } from "../terminalPaneLayout";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { MAX_TERMINALS_PER_GROUP, type Thread } from "../types";

interface UseChatTerminalControllerOptions {
  focusedPane: boolean;
  hasProject: boolean;
  isServerThread: boolean;
  splitViewId: SplitViewId | null;
  thread: Thread | null | undefined;
  threadId: ThreadId;
}

export function useChatTerminalController(options: UseChatTerminalControllerOptions) {
  const { focusedPane, hasProject, isServerThread, splitViewId, thread, threadId } = options;
  const activeThreadId = thread?.id ?? null;
  const { settings } = useAppSettings();
  const navigate = useNavigate();
  const { handleNewChat } = useHandleNewChat();
  const activeSplitView = useSplitViewStore(selectSplitView(splitViewId));
  const removeThreadFromSplitViews = useSplitViewStore((state) => state.removeThreadFromSplitViews);
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, threadId),
  );
  const setOpenStore = useTerminalStateStore((state) => state.setTerminalOpen);
  const setPresentationModeStore = useTerminalStateStore(
    (state) => state.setTerminalPresentationMode,
  );
  const setWorkspaceLayoutStore = useTerminalStateStore(
    (state) => state.setTerminalWorkspaceLayout,
  );
  const openChatThreadPage = useTerminalStateStore((state) => state.openChatThreadPage);
  const openTerminalThreadPage = useTerminalStateStore((state) => state.openTerminalThreadPage);
  const setWorkspaceTabStore = useTerminalStateStore((state) => state.setTerminalWorkspaceTab);
  const setHeightStore = useTerminalStateStore((state) => state.setTerminalHeight);
  const setMetadataStore = useTerminalStateStore((state) => state.setTerminalMetadata);
  const setActivityStore = useTerminalStateStore((state) => state.setTerminalActivity);
  const splitLeftStore = useTerminalStateStore((state) => state.splitTerminalLeft);
  const splitRightStore = useTerminalStateStore((state) => state.splitTerminalRight);
  const splitDownStore = useTerminalStateStore((state) => state.splitTerminalDown);
  const splitUpStore = useTerminalStateStore((state) => state.splitTerminalUp);
  const newTerminalStore = useTerminalStateStore((state) => state.newTerminal);
  const newTerminalTabStore = useTerminalStateStore((state) => state.newTerminalTab);
  const openFullWidthStore = useTerminalStateStore((state) => state.openNewFullWidthTerminal);
  const closeWorkspaceChatStore = useTerminalStateStore((state) => state.closeWorkspaceChat);
  const setActiveStore = useTerminalStateStore((state) => state.setActiveTerminal);
  const closeTerminalStore = useTerminalStateStore((state) => state.closeTerminal);
  const closeGroupStore = useTerminalStateStore((state) => state.closeTerminalGroup);
  const resizeSplitStore = useTerminalStateStore((state) => state.resizeTerminalSplit);
  const clearStateStore = useTerminalStateStore((state) => state.clearTerminalState);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const requestFocus = useCallback(() => setFocusRequestId((value) => value + 1), []);

  const activeGroup =
    terminalState.terminalGroups.find(
      (group) => group.id === terminalState.activeTerminalGroupId,
    ) ??
    terminalState.terminalGroups.find((group) =>
      collectTerminalIdsFromLayout(group.layout).includes(terminalState.activeTerminalId),
    ) ??
    null;
  const splitLimitReached =
    (activeGroup ? collectTerminalIdsFromLayout(activeGroup.layout).length : 0) >=
    MAX_TERMINALS_PER_GROUP;
  const workspaceOpen = shouldRenderTerminalWorkspace({
    presentationMode: terminalState.presentationMode,
    terminalOpen: terminalState.terminalOpen,
  });

  const setOpen = useCallback(
    (open: boolean) => {
      if (activeThreadId) setOpenStore(activeThreadId, open);
    },
    [activeThreadId, setOpenStore],
  );
  const setPresentationMode = useCallback(
    (mode: "drawer" | "workspace") => {
      if (activeThreadId) setPresentationModeStore(activeThreadId, mode);
    },
    [activeThreadId, setPresentationModeStore],
  );
  const setWorkspaceLayout = useCallback(
    (layout: "both" | "terminal-only") => {
      if (activeThreadId) setWorkspaceLayoutStore(activeThreadId, layout);
    },
    [activeThreadId, setWorkspaceLayoutStore],
  );
  const setWorkspaceTab = useCallback(
    (tab: "terminal" | "chat") => {
      if (activeThreadId) setWorkspaceTabStore(activeThreadId, tab);
    },
    [activeThreadId, setWorkspaceTabStore],
  );
  const setHeight = useCallback(
    (height: number) => {
      if (activeThreadId) setHeightStore(activeThreadId, height);
    },
    [activeThreadId, setHeightStore],
  );

  const toggleVisibility = useCallback(() => {
    if (!activeThreadId) return;
    if (!terminalState.terminalOpen) setPresentationMode("drawer");
    setOpen(!terminalState.terminalOpen);
  }, [activeThreadId, setOpen, setPresentationMode, terminalState.terminalOpen]);
  const expandWorkspace = useCallback(() => {
    if (!activeThreadId) return;
    setPresentationMode("workspace");
    setWorkspaceLayout("both");
    setWorkspaceTab("terminal");
  }, [activeThreadId, setPresentationMode, setWorkspaceLayout, setWorkspaceTab]);
  const collapseWorkspace = useCallback(() => {
    if (activeThreadId) setPresentationMode("drawer");
  }, [activeThreadId, setPresentationMode]);

  const split = useCallback(
    (direction: "left" | "right" | "down" | "up") => {
      if (!activeThreadId || splitLimitReached) return;
      const terminalId = randomTerminalId();
      if (direction === "left") splitLeftStore(activeThreadId, terminalId);
      if (direction === "right") splitRightStore(activeThreadId, terminalId);
      if (direction === "down") splitDownStore(activeThreadId, terminalId);
      if (direction === "up") splitUpStore(activeThreadId, terminalId);
      requestFocus();
    },
    [
      activeThreadId,
      requestFocus,
      splitDownStore,
      splitLeftStore,
      splitLimitReached,
      splitRightStore,
      splitUpStore,
    ],
  );
  const splitLeft = useCallback(() => split("left"), [split]);
  const splitRight = useCallback(() => split("right"), [split]);
  const splitDown = useCallback(() => split("down"), [split]);
  const splitUp = useCallback(() => split("up"), [split]);

  const createTerminal = useCallback(() => {
    if (!activeThreadId) return;
    newTerminalStore(activeThreadId, randomTerminalId());
    requestFocus();
  }, [activeThreadId, newTerminalStore, requestFocus]);
  const createTerminalTab = useCallback(
    (targetTerminalId: string) => {
      if (!activeThreadId) return;
      newTerminalTabStore(activeThreadId, targetTerminalId, randomTerminalId());
      requestFocus();
    },
    [activeThreadId, newTerminalTabStore, requestFocus],
  );
  const createFromShortcut = useCallback(() => {
    const action = resolveTerminalNewAction({
      terminalOpen: terminalState.terminalOpen,
      activeTerminalId: terminalState.activeTerminalId,
      activeTerminalGroupId: terminalState.activeTerminalGroupId,
      terminalGroups: terminalState.terminalGroups,
    });
    if (action.kind === "new-group") {
      if (!terminalState.terminalOpen) setOpen(true);
      createTerminal();
      return;
    }
    createTerminalTab(action.targetTerminalId);
  }, [
    createTerminal,
    createTerminalTab,
    setOpen,
    terminalState.activeTerminalGroupId,
    terminalState.activeTerminalId,
    terminalState.terminalGroups,
    terminalState.terminalOpen,
  ]);
  const moveToNewGroup = useCallback(
    (terminalId: string) => {
      if (!activeThreadId) return;
      newTerminalStore(activeThreadId, terminalId);
      requestFocus();
    },
    [activeThreadId, newTerminalStore, requestFocus],
  );
  const openNewFullWidth = useCallback(() => {
    if (!activeThreadId || !hasProject) return;
    openFullWidthStore(activeThreadId, randomTerminalId());
    requestFocus();
  }, [activeThreadId, hasProject, openFullWidthStore, requestFocus]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function" || !focusedPane) return;
    const unsubscribe = onMenuAction((action) => {
      if (action === "new-terminal-tab") createFromShortcut();
    });
    return () => unsubscribe?.();
  }, [createFromShortcut, focusedPane]);

  const activate = useCallback(
    (terminalId: string) => {
      if (!activeThreadId) return;
      setActiveStore(activeThreadId, terminalId);
      requestFocus();
    },
    [activeThreadId, requestFocus, setActiveStore],
  );
  const closeTerminal = useCallback(
    async (terminalId: string) => {
      const api = readNativeApi();
      if (!activeThreadId || !api) return;
      const finalTerminal = terminalState.terminalIds.length <= 1;
      const deletePlaceholderThread = shouldAutoDeleteTerminalThreadOnLastClose({
        isLastTerminal: finalTerminal,
        isServerThread,
        terminalEntryPoint: terminalState.entryPoint,
        thread,
      });
      const confirmed = await confirmTerminalTabClose({
        api,
        enabled: shouldPromptForTerminalClose({
          confirmationEnabled: settings.confirmTerminalTabClose,
          runningTerminalIds: terminalState.runningTerminalIds,
          terminalAttentionStatesById: terminalState.terminalAttentionStatesById,
          terminalId,
        }),
        terminalTitle: resolveTerminalCloseTitle({
          terminalId,
          terminalLabelsById: terminalState.terminalLabelsById,
          terminalTitleOverridesById: terminalState.terminalTitleOverridesById,
        }),
        willDeleteThread: deletePlaceholderThread,
      });
      if (!confirmed) return;

      disposeAndCloseTerminalSession({
        api,
        threadId: activeThreadId,
        terminalId,
        clearHistoryBeforeClose: finalTerminal,
      });
      closeTerminalStore(activeThreadId, terminalId);
      requestFocus();
      if (!deletePlaceholderThread) return;

      void (async () => {
        try {
          await api.orchestration.dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: activeThreadId,
          });
          void reconcileDeletedThreadFromClient({
            threadId: activeThreadId,
            removeDeletedThreadFromClientState:
              useStore.getState().removeDeletedThreadFromClientState,
          });
          useComposerDraftStore.getState().clearDraftThread(activeThreadId);
          clearStateStore(activeThreadId);
          removeThreadFromSplitViews(activeThreadId);
          if (activeSplitView) {
            const nextSplitView = useSplitViewStore.getState().splitViewsById[activeSplitView.id];
            const nextThreadId = nextSplitView
              ? resolveSplitViewFocusedThreadId(nextSplitView)
              : null;
            if (nextSplitView && nextThreadId) {
              await navigate({
                to: "/$threadId",
                params: { threadId: nextThreadId },
                replace: true,
                search: () => ({ splitViewId: nextSplitView.id }),
              });
              return;
            }
          }
          await handleNewChat({ fresh: true });
        } catch (error) {
          console.error("Failed to delete empty terminal thread after closing its last terminal", {
            threadId: activeThreadId,
            error,
          });
        }
      })();
    },
    [
      activeSplitView,
      activeThreadId,
      clearStateStore,
      closeTerminalStore,
      handleNewChat,
      isServerThread,
      navigate,
      removeThreadFromSplitViews,
      requestFocus,
      settings.confirmTerminalTabClose,
      terminalState.entryPoint,
      terminalState.runningTerminalIds,
      terminalState.terminalAttentionStatesById,
      terminalState.terminalIds.length,
      terminalState.terminalLabelsById,
      terminalState.terminalTitleOverridesById,
      thread,
    ],
  );

  const closeActiveWorkspaceView = useCallback(() => {
    if (!activeThreadId || !workspaceOpen) return;
    if (terminalState.workspaceLayout === "both" && terminalState.workspaceActiveTab === "chat") {
      if (terminalState.entryPoint === "chat") {
        collapseWorkspace();
        return;
      }
      closeWorkspaceChatStore(activeThreadId);
      return;
    }
    void closeTerminal(terminalState.activeTerminalId);
  }, [
    activeThreadId,
    closeTerminal,
    closeWorkspaceChatStore,
    collapseWorkspace,
    terminalState.activeTerminalId,
    terminalState.entryPoint,
    terminalState.workspaceActiveTab,
    terminalState.workspaceLayout,
    workspaceOpen,
  ]);

  const closeGroup = useCallback(
    (groupId: string) => {
      if (activeThreadId) closeGroupStore(activeThreadId, groupId);
    },
    [activeThreadId, closeGroupStore],
  );
  const resizeSplit = useCallback(
    (groupId: string, splitId: string, weights: number[]) => {
      if (activeThreadId) resizeSplitStore(activeThreadId, groupId, splitId, weights);
    },
    [activeThreadId, resizeSplitStore],
  );
  const setMetadata = useCallback(
    (terminalId: string, metadata: Parameters<typeof setMetadataStore>[2]) => {
      if (activeThreadId) setMetadataStore(activeThreadId, terminalId, metadata);
    },
    [activeThreadId, setMetadataStore],
  );
  const setActivity = useCallback(
    (terminalId: string, activity: Parameters<typeof setActivityStore>[2]) => {
      if (activeThreadId) setActivityStore(activeThreadId, terminalId, activity);
    },
    [activeThreadId, setActivityStore],
  );

  return {
    activate,
    closeActiveWorkspaceView,
    closeGroup,
    closeTerminal,
    collapseWorkspace,
    createFromShortcut,
    createTerminal,
    createTerminalTab,
    expandWorkspace,
    focusRequestId,
    moveToNewGroup,
    openChatThreadPage,
    openNewFullWidth,
    openTerminalThreadPage,
    requestFocus,
    resizeSplit,
    setActivity,
    setHeight,
    setMetadata,
    setOpen,
    setPresentationMode,
    setWorkspaceLayout,
    setWorkspaceTab,
    splitDown,
    splitLeft,
    splitRight,
    splitUp,
    terminalState,
    toggleVisibility,
    workspaceOpen,
  };
}
