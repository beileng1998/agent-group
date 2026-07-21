// FILE: ThreadTerminalDrawer.tsx
// Purpose: Hosts the terminal drawer/workspace chrome and each xterm viewport for a thread.
// Layer: Chat terminal workspace UI
// Depends on: terminal workspace state from ChatView and focused terminal UI modules.

import { type ThreadId } from "@agent-group/contracts";
import {
  type TerminalActivityState,
  type TerminalCliKind,
} from "@agent-group/shared/terminalThreads";
import { type TerminalContextSelection } from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { type ThreadTerminalGroup, type ThreadTerminalPresentationMode } from "../types";
import { TerminalSidebar, TerminalWorkspaceTabBar } from "./terminal/TerminalChrome";
import TerminalViewportPane from "./terminal/TerminalViewportPane";
import { useTerminalDrawerHeight } from "./terminal/useTerminalDrawerHeight";
import { ThreadTerminalViewport } from "./thread-terminal/ThreadTerminalViewport";
import { useThreadTerminalDrawerModel } from "./thread-terminal/useThreadTerminalDrawerModel";

interface ThreadTerminalDrawerProps {
  threadId: ThreadId;
  cwd: string;
  runtimeEnv?: Record<string, string>;
  height: number;
  presentationMode: ThreadTerminalPresentationMode;
  isVisible?: boolean;
  terminalIds: string[];
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById: Record<string, string>;
  terminalCliKindsById: Record<string, TerminalCliKind>;
  terminalAttentionStatesById: Record<string, "attention" | "review">;
  runningTerminalIds: string[];
  activeTerminalId: string;
  terminalGroups: ThreadTerminalGroup[];
  activeTerminalGroupId: string;
  focusRequestId: number;
  onSplitTerminal: () => void;
  onSplitTerminalDown: () => void;
  onNewTerminal: () => void;
  onNewTerminalTab: (terminalId: string) => void;
  onMoveTerminalToGroup: (terminalId: string) => void;
  splitShortcutLabel?: string | undefined;
  splitDownShortcutLabel?: string | undefined;
  newShortcutLabel?: string | undefined;
  closeShortcutLabel?: string | undefined;
  workspaceCloseShortcutLabel?: string | undefined;
  onActiveTerminalChange: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onCloseTerminalGroup: (groupId: string) => void;
  onHeightChange: (height: number) => void;
  onResizeTerminalSplit: (groupId: string, splitId: string, weights: number[]) => void;
  onTerminalMetadataChange: (
    terminalId: string,
    metadata: { cliKind: TerminalCliKind | null; label: string },
  ) => void;
  onTerminalActivityChange: (
    terminalId: string,
    activity: { hasRunningSubprocess: boolean; agentState: TerminalActivityState | null },
  ) => void;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
  onTogglePresentationMode?: (() => void) | undefined;
  onTogglePanel?: (() => void) | undefined;
  isPanelOpen?: boolean | undefined;
}

export default function ThreadTerminalDrawer({
  threadId,
  cwd,
  runtimeEnv,
  height,
  presentationMode,
  isVisible = true,
  terminalIds,
  terminalLabelsById,
  terminalTitleOverridesById,
  terminalCliKindsById,
  terminalAttentionStatesById,
  runningTerminalIds,
  activeTerminalId,
  terminalGroups,
  activeTerminalGroupId,
  focusRequestId,
  onSplitTerminal,
  onSplitTerminalDown,
  onNewTerminal,
  onNewTerminalTab,
  onMoveTerminalToGroup,
  splitShortcutLabel,
  splitDownShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
  workspaceCloseShortcutLabel,
  onActiveTerminalChange,
  onCloseTerminal,
  onCloseTerminalGroup,
  onHeightChange,
  onResizeTerminalSplit,
  onTerminalMetadataChange,
  onTerminalActivityChange,
  onAddTerminalContext,
  onTogglePresentationMode,
  onTogglePanel,
  isPanelOpen,
}: ThreadTerminalDrawerProps) {
  const { drawerHeight, handleResizePointerDown, handleResizePointerMove, handleResizePointerEnd } =
    useTerminalDrawerHeight({
      height,
      onHeightChange,
      resetKey: threadId,
    });
  const {
    isWorkspaceMode,
    normalizedTerminalIds,
    resolvedActiveTerminalId,
    resolvedActiveGroupId,
    resolvedTerminalGroups,
    activeGroupLayout,
    hasTerminalSidebar,
    showGroupHeaders,
    hasReachedSplitLimit,
    terminalVisualIdentityById,
    resolvedCloseShortcutLabel,
    showTerminalGroupTabs,
    terminalChromeActions,
  } = useThreadTerminalDrawerModel({
    threadId,
    presentationMode,
    terminalIds,
    terminalLabelsById,
    terminalTitleOverridesById,
    terminalCliKindsById,
    terminalAttentionStatesById,
    runningTerminalIds,
    activeTerminalId,
    terminalGroups,
    activeTerminalGroupId,
    splitShortcutLabel,
    splitDownShortcutLabel,
    newShortcutLabel,
    closeShortcutLabel,
    workspaceCloseShortcutLabel,
    onSplitTerminal,
    onSplitTerminalDown,
    onNewTerminal,
    onCloseTerminal,
  });

  return (
    <aside
      className={cn(
        "thread-terminal-drawer relative flex w-full min-w-0 flex-col overflow-hidden bg-[var(--color-background-surface)]",
        isWorkspaceMode ? "h-full min-h-0" : "shrink-0 border-t border-border/70",
      )}
      style={isWorkspaceMode ? undefined : { height: `${drawerHeight}px` }}
    >
      {!isWorkspaceMode ? (
        <div
          className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
        />
      ) : null}

      {showTerminalGroupTabs ? (
        <TerminalWorkspaceTabBar
          terminalGroups={resolvedTerminalGroups}
          activeGroupId={resolvedActiveGroupId}
          terminalVisualIdentityById={terminalVisualIdentityById}
          actions={terminalChromeActions}
          onActiveGroupChange={(groupId) => {
            const nextGroup = resolvedTerminalGroups.find((group) => group.id === groupId);
            if (!nextGroup) return;
            onActiveTerminalChange(nextGroup.activeTerminalId);
          }}
          onCloseGroup={onCloseTerminalGroup}
        />
      ) : null}

      <div className="min-h-0 w-full flex-1">
        <div
          className={cn(
            "flex h-full min-h-0",
            hasTerminalSidebar && !isWorkspaceMode ? "gap-1.5" : "",
          )}
        >
          <div className="min-w-0 flex-1 h-full">
            <TerminalViewportPane
              groupId={resolvedActiveGroupId}
              layout={activeGroupLayout}
              resolvedActiveTerminalId={resolvedActiveTerminalId}
              terminalVisualIdentityById={terminalVisualIdentityById}
              onActiveTerminalChange={onActiveTerminalChange}
              onResizeSplit={onResizeTerminalSplit}
              onSplitTerminalRight={
                hasReachedSplitLimit
                  ? undefined
                  : (terminalId) => {
                      onActiveTerminalChange(terminalId);
                      onSplitTerminal();
                    }
              }
              onSplitTerminalDown={
                hasReachedSplitLimit
                  ? undefined
                  : (terminalId) => {
                      onActiveTerminalChange(terminalId);
                      onSplitTerminalDown();
                    }
              }
              onNewTerminalTab={
                hasReachedSplitLimit
                  ? undefined
                  : (terminalId) => {
                      onNewTerminalTab(terminalId);
                    }
              }
              onMoveTerminalToGroup={isWorkspaceMode ? onMoveTerminalToGroup : undefined}
              onCloseTerminal={onCloseTerminal}
              presentationMode={presentationMode}
              onTogglePresentationMode={onTogglePresentationMode}
              onTogglePanel={onTogglePanel}
              isPanelOpen={isPanelOpen}
              renderViewport={(terminalId, options) => (
                <ThreadTerminalViewport
                  key={terminalId}
                  threadId={threadId}
                  terminalId={terminalId}
                  terminalLabel={terminalVisualIdentityById.get(terminalId)?.title ?? "Terminal"}
                  terminalCliKind={terminalVisualIdentityById.get(terminalId)?.cliKind ?? null}
                  cwd={cwd}
                  {...(runtimeEnv ? { runtimeEnv } : {})}
                  onSessionExited={() => onCloseTerminal(terminalId)}
                  onTerminalMetadataChange={onTerminalMetadataChange}
                  onTerminalActivityChange={onTerminalActivityChange}
                  onAddTerminalContext={onAddTerminalContext}
                  focusRequestId={focusRequestId}
                  autoFocus={options.autoFocus}
                  isVisible={isVisible && options.isVisible}
                />
              )}
            />
          </div>

          {hasTerminalSidebar && !isWorkspaceMode ? (
            <TerminalSidebar
              terminalIds={normalizedTerminalIds}
              terminalGroups={resolvedTerminalGroups}
              activeTerminalId={resolvedActiveTerminalId}
              activeGroupId={resolvedActiveGroupId}
              showGroupHeaders={showGroupHeaders}
              closeShortcutLabel={resolvedCloseShortcutLabel}
              terminalVisualIdentityById={terminalVisualIdentityById}
              actions={terminalChromeActions}
              onActiveTerminalChange={onActiveTerminalChange}
              onCloseTerminal={onCloseTerminal}
            />
          ) : null}
        </div>
      </div>
    </aside>
  );
}
