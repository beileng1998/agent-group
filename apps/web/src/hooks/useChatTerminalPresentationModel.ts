import type { ThreadId } from "@agent-group/contracts";
import { type ComponentProps, useCallback, useMemo } from "react";
import type { TerminalContextSelection } from "~/lib/terminalContext";

import type ThreadTerminalDrawer from "../components/ThreadTerminalDrawer";
import { resolveVisibleSidechatTargetThreadId } from "../lib/sidechatSelectionTarget";
import { selectRightDockState, useRightDockStore } from "../rightDockStore";
import type { ChatShortcutLabels } from "./useChatShortcutLabels";
import type { useChatTerminalController } from "./useChatTerminalController";

type TerminalController = ReturnType<typeof useChatTerminalController>;
type DrawerProps = Omit<
  ComponentProps<typeof ThreadTerminalDrawer>,
  "isVisible" | "onTogglePresentationMode" | "presentationMode"
>;

interface UseChatTerminalPresentationModelOptions {
  threadId: ThreadId;
  activeThreadId: ThreadId | null;
  projectCwd: string | null;
  gitCwd: string | null;
  runtimeEnv: Record<string, string>;
  controller: TerminalController;
  shortcuts: ChatShortcutLabels["terminal"];
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
}

export function useChatTerminalPresentationModel(options: UseChatTerminalPresentationModelOptions) {
  const {
    threadId,
    activeThreadId,
    projectCwd,
    gitCwd,
    runtimeEnv,
    controller,
    shortcuts,
    onAddTerminalContext,
  } = options;
  const rightDockOpen = useRightDockStore((store) => selectRightDockState(threadId)(store).open);
  const visibleSidechatTargetThreadId = useRightDockStore((store) =>
    resolveVisibleSidechatTargetThreadId(selectRightDockState(threadId)(store)),
  );
  const hasRightDockPanes = useRightDockStore(
    (store) => selectRightDockState(threadId)(store).panes.length > 0,
  );
  const setRightDockOpen = useRightDockStore((store) => store.setDockOpen);
  const toggleRightDock = useCallback(() => {
    setRightDockOpen(threadId, !rightDockOpen);
  }, [rightDockOpen, setRightDockOpen, threadId]);

  const drawerProps = useMemo<DrawerProps>(
    () => ({
      threadId,
      onTogglePanel: hasRightDockPanes ? toggleRightDock : undefined,
      isPanelOpen: hasRightDockPanes ? rightDockOpen : undefined,
      cwd: gitCwd ?? projectCwd ?? "",
      runtimeEnv,
      height: controller.terminalState.terminalHeight,
      terminalIds: controller.terminalState.terminalIds,
      terminalLabelsById: controller.terminalState.terminalLabelsById,
      terminalTitleOverridesById: controller.terminalState.terminalTitleOverridesById,
      terminalCliKindsById: controller.terminalState.terminalCliKindsById,
      terminalAttentionStatesById: controller.terminalState.terminalAttentionStatesById ?? {},
      runningTerminalIds: controller.terminalState.runningTerminalIds,
      activeTerminalId: controller.terminalState.activeTerminalId,
      terminalGroups: controller.terminalState.terminalGroups,
      activeTerminalGroupId: controller.terminalState.activeTerminalGroupId,
      focusRequestId: controller.focusRequestId,
      onSplitTerminal: controller.splitRight,
      onSplitTerminalDown: controller.splitDown,
      onNewTerminal: controller.createTerminal,
      onNewTerminalTab: controller.createTerminalTab,
      onMoveTerminalToGroup: controller.moveToNewGroup,
      splitShortcutLabel: shortcuts.split ?? undefined,
      splitDownShortcutLabel: shortcuts.splitDown ?? undefined,
      newShortcutLabel: shortcuts.new ?? undefined,
      closeShortcutLabel: shortcuts.close ?? undefined,
      workspaceCloseShortcutLabel: shortcuts.closeWorkspace ?? undefined,
      onActiveTerminalChange: controller.activate,
      onCloseTerminal: controller.closeTerminal,
      onCloseTerminalGroup: controller.closeGroup,
      onHeightChange: controller.setHeight,
      onResizeTerminalSplit: controller.resizeSplit,
      onTerminalMetadataChange: controller.setMetadata,
      onTerminalActivityChange: controller.setActivity,
      onAddTerminalContext,
    }),
    [
      controller,
      gitCwd,
      hasRightDockPanes,
      onAddTerminalContext,
      projectCwd,
      rightDockOpen,
      runtimeEnv,
      shortcuts,
      threadId,
      toggleRightDock,
    ],
  );

  const openEditorTerminal = useCallback(() => {
    if (!activeThreadId) return;
    controller.setPresentationMode("workspace");
    controller.setWorkspaceLayout("terminal-only");
    controller.setWorkspaceTab("terminal");
    controller.requestFocus();
  }, [activeThreadId, controller]);
  const closeEditorTerminal = useCallback(() => {
    void controller.closeTerminal(controller.terminalState.activeTerminalId);
  }, [controller]);

  return {
    drawerProps,
    editorActions: {
      closeTerminal: closeEditorTerminal,
      openTerminal: openEditorTerminal,
    },
    rightDock: {
      open: rightDockOpen,
      visibleSidechatTargetThreadId,
    },
  };
}
