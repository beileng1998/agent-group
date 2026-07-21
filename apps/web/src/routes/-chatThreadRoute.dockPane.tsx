import type { HighlightListItem, ProjectId, ThreadId } from "@agent-group/contracts";
import type { useNavigate } from "@tanstack/react-router";
import { Suspense, type ReactNode, useCallback } from "react";

import { DeferredChatView } from "../components/chat/ChatRouteDeferredSurface";
import { PanelStateMessage } from "../components/chat/PanelStateMessage";
import type { ChatFileReference } from "../lib/chatReferences";
import type { DockPaneRuntimeMode } from "../lib/dockPaneActivation";
import type { FileCommentSelection } from "../lib/fileComments";
import { dockSidechatPaneScopeId } from "../lib/chatPaneScope";
import type { RightDockPane, RightDockThreadState } from "../rightDockStore.logic";
import type { Project, SidebarThreadSummary } from "../types";
import {
  AgentGroupContextPane,
  AgentGroupSettingsPane,
  BrowserPanel,
  DOCK_EMBEDDED_PANEL_STATE,
  DockExplorerPane,
  DockFilePane,
  DockTerminalPane,
  GitPanel,
  HighlightsDockPane,
  LazyDiffPanel,
  PullRequestDockPane,
  RightDockPanePlaceholder,
} from "./-chatThreadRoute.lazyPanels";

type Navigate = ReturnType<typeof useNavigate>;
type UpdateDockPane = (
  paneId: string,
  patch: Partial<Pick<RightDockPane, "diffTurnId" | "diffFilePath">>,
) => void;

const noop = () => {};

export function useSingleChatDockPaneRenderer(input: {
  threadId: ThreadId;
  projectId: ProjectId | null;
  workspaceRoot: string | null;
  activeProject: Project | null | undefined;
  activeThreadSummary: SidebarThreadSummary | null | undefined;
  dockState: RightDockThreadState;
  closePane: (paneId: string) => void;
  closeDockPane: (paneId: string) => void;
  updatePane: UpdateDockPane;
  requestActiveDockPaneLive: () => void;
  navigate: Navigate;
  handleReferenceInChat: (reference: ChatFileReference) => void;
  handleAskWhyInChat: (reference: ChatFileReference) => void;
  handleCommentInChat: (comment: FileCommentSelection) => void;
  handleJumpToHighlight: (item: HighlightListItem) => void;
}) {
  return useCallback(
    (
      pane: RightDockPane,
      context: { runtimeMode: DockPaneRuntimeMode; isActive: boolean; isVisible: boolean },
    ): ReactNode => {
      switch (pane.kind) {
        case "context":
          if (!input.activeProject) {
            return <PanelStateMessage>Group context is unavailable.</PanelStateMessage>;
          }
          return (
            <Suspense fallback={<PanelStateMessage>Loading context...</PanelStateMessage>}>
              <AgentGroupContextPane
                sessionId={input.threadId}
                threadUpdatedAt={input.activeThreadSummary?.updatedAt}
              />
            </Suspense>
          );
        case "highlights":
          if (!input.activeProject) {
            return <PanelStateMessage>Highlights are unavailable.</PanelStateMessage>;
          }
          return (
            <Suspense fallback={<PanelStateMessage>Loading highlights...</PanelStateMessage>}>
              <HighlightsDockPane
                sessionId={input.threadId}
                projectId={input.activeProject.id}
                onJump={input.handleJumpToHighlight}
              />
            </Suspense>
          );
        case "group":
          if (!input.activeProject) {
            return <PanelStateMessage>Group settings are unavailable.</PanelStateMessage>;
          }
          return (
            <Suspense fallback={<PanelStateMessage>Loading group settings...</PanelStateMessage>}>
              <AgentGroupSettingsPane groupId={input.activeProject.id} />
            </Suspense>
          );
        case "browser":
          return (
            <Suspense fallback={<PanelStateMessage>Loading browser...</PanelStateMessage>}>
              <BrowserPanel
                mode="sidebar"
                threadId={input.threadId}
                onClosePanel={() => input.closePane(pane.id)}
                runtimeMode={context.runtimeMode}
                onRequestLive={input.requestActiveDockPaneLive}
              />
            </Suspense>
          );
        case "pullRequest":
          return (
            <Suspense fallback={<PanelStateMessage>Loading pull request...</PanelStateMessage>}>
              <PullRequestDockPane
                pane={pane}
                pollingEnabled={context.isVisible}
                onClose={() => input.closePane(pane.id)}
              />
            </Suspense>
          );
        case "diff":
          return (
            <LazyDiffPanel
              mode="sidebar"
              threadId={input.threadId}
              panelState={{
                panel: "diff",
                diffTurnId: pane.diffTurnId,
                diffFilePath: pane.diffFilePath,
              }}
              onUpdatePanelState={(patch) =>
                input.updatePane(pane.id, {
                  diffTurnId: patch.diffTurnId ?? null,
                  diffFilePath: patch.diffFilePath ?? null,
                })
              }
              onClosePanel={() => input.closePane(pane.id)}
              liveRefreshEnabled={context.isActive && input.dockState.open}
              queriesEnabled={context.isActive && input.dockState.open}
            />
          );
        case "terminal":
          if (context.runtimeMode === "preview") {
            return <PanelStateMessage>Terminal is sleeping. Restoring shortly.</PanelStateMessage>;
          }
          // Kept mounted across tab switches; visibility toggles the xterm runtime
          // instead of detaching/reattaching it (avoids the open-lag + fit flicker).
          // Also sleep it while the dock is collapsed: a closed dock keeps the pane
          // mounted (offcanvas is CSS-only), so without this the off-screen terminal
          // would keep WebGL + resize observers alive for nothing.
          return (
            <Suspense fallback={<PanelStateMessage>Loading terminal...</PanelStateMessage>}>
              <DockTerminalPane
                hostThreadId={input.threadId}
                projectId={input.projectId}
                isActive={context.isActive && input.dockState.open}
              />
            </Suspense>
          );
        case "git":
          return (
            <Suspense fallback={<PanelStateMessage>Loading Git...</PanelStateMessage>}>
              <GitPanel
                hostThreadId={input.threadId}
                projectId={input.projectId}
                onClose={() => input.closePane(pane.id)}
              />
            </Suspense>
          );
        case "explorer":
          return (
            <Suspense fallback={<PanelStateMessage>Loading explorer...</PanelStateMessage>}>
              <DockExplorerPane
                workspaceRoot={input.workspaceRoot}
                onReferenceInChat={input.handleReferenceInChat}
                onAskWhyInChat={input.handleAskWhyInChat}
                onCommentInChat={input.handleCommentInChat}
              />
            </Suspense>
          );
        case "file":
          return (
            <Suspense fallback={<PanelStateMessage>Loading file...</PanelStateMessage>}>
              <DockFilePane
                workspaceRoot={input.workspaceRoot}
                filePath={pane.filePath}
                onReferenceInChat={input.handleReferenceInChat}
                onAskWhyInChat={input.handleAskWhyInChat}
                onCommentInChat={input.handleCommentInChat}
              />
            </Suspense>
          );
        case "sidechat":
          if (!pane.threadId) {
            return <RightDockPanePlaceholder kind="sidechat" />;
          }
          if (context.runtimeMode === "preview") {
            return null;
          }
          return (
            <DeferredChatView
              threadId={pane.threadId}
              paneScopeId={dockSidechatPaneScopeId(pane.id)}
              deferMount={false}
              surfaceMode="split"
              isFocusedPane={false}
              panelState={DOCK_EMBEDDED_PANEL_STATE}
              onToggleDiff={noop}
              onToggleBrowser={noop}
              onOpenBrowserUrl={noop}
              onOpenTurnDiff={noop}
              onCloseThreadPane={() => input.closeDockPane(pane.id)}
              retainThreadDetail
              onSidechatPromoted={async (threadId) => {
                input.closePane(pane.id);
                await input.navigate({
                  to: "/$threadId",
                  params: { threadId },
                });
              }}
            />
          );
        default:
          return <RightDockPanePlaceholder kind={pane.kind} />;
      }
    },
    [
      input.closePane,
      input.closeDockPane,
      input.dockState.open,
      input.activeProject,
      input.activeThreadSummary?.createdAt,
      input.activeThreadSummary?.parentThreadId,
      input.activeThreadSummary?.updatedAt,
      input.handleAskWhyInChat,
      input.handleCommentInChat,
      input.handleJumpToHighlight,
      input.handleReferenceInChat,
      input.projectId,
      input.threadId,
      input.navigate,
      input.requestActiveDockPaneLive,
      input.updatePane,
      input.workspaceRoot,
    ],
  );
}
