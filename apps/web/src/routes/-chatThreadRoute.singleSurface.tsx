import type { ProjectId, ThreadId as ThreadIdType } from "@agent-group/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Suspense } from "react";

import { ChatPaneDropOverlay } from "../components/chat-drop-overlay/ChatPaneDropOverlay";
import { ChatMountSkeleton, DeferredChatView } from "../components/chat/ChatRouteDeferredSurface";
import { RightDock } from "../components/chat/RightDock";
import { RIGHT_DOCK_ADD_MENU_KINDS } from "../components/chat/rightDockPaneMeta";
import {
  CHAT_BACKGROUND_CLASS_NAME,
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "../components/chat/composerPickerStyles";
import { Button } from "../components/ui/button";
import type { DiffRouteSearch } from "../diffRouteSearch";
import { useAgentGroupSessionGate } from "../hooks/useAgentGroupSessionGate";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { EDITOR_CHAT_PANE_SCOPE_ID, SINGLE_CHAT_PANE_SCOPE_ID } from "../lib/chatPaneScope";
import { WorkspaceFileOpenerContext } from "../lib/workspaceFileOpener";
import { RouteInsetSurface } from "../components/RouteInsetSurface";
import { SidebarInset } from "../components/ui/sidebar";
import { cn } from "../lib/utils";
import { useSingleChatDockController } from "./-chatThreadRoute.dockController";
import { useSingleChatDockPaneRenderer } from "./-chatThreadRoute.dockPane";
import { useSingleChatEditorController } from "./-chatThreadRoute.editorController";
import { EditorWorkspaceView, LazyDiffPanel } from "./-chatThreadRoute.lazyPanels";
import { useSingleChatReadModel } from "./-chatThreadRoute.singleReadModel";
import { useSingleChatWorkspaceBridge } from "./-chatThreadRoute.workspaceBridge";

const DIFF_INLINE_DEFAULT_WIDTH = "max(28rem, calc(50vw - 8rem))";
const SINGLE_PANEL_MIN_WIDTH = 26 * 16;
const denyAnySplitDirection = () => false;
const noop = () => {};

export function SingleChatSurface(props: {
  threadId: ThreadIdType;
  search: DiffRouteSearch;
  projectId: ProjectId | null;
}) {
  const navigate = useNavigate();
  const {
    activeProject,
    activeThreadSummary,
    workspaceRoot,
    projects,
    threadSummaries,
    appSettings,
  } = useSingleChatReadModel({
    threadId: props.threadId,
    projectId: props.projectId,
  });
  const agentGroupSessionKey =
    activeProject && activeThreadSummary
      ? `${activeProject.id}:${props.threadId}:${activeThreadSummary.parentThreadId ?? "root"}:${activeThreadSummary.createdAt}`
      : null;
  const agentGroupSessionGate = useAgentGroupSessionGate({
    threadId: props.threadId,
    sessionKey: agentGroupSessionKey,
  });
  const { handleNewThread } = useHandleNewThread();
  const queryClient = useQueryClient();
  const editor = useSingleChatEditorController({
    threadId: props.threadId,
    search: props.search,
    workspaceRoot,
    projects,
    threadSummaries,
    appSettings,
    queryClient,
    navigate,
    handleNewThread,
  });
  const dock = useSingleChatDockController({
    threadId: props.threadId,
    projectId: props.projectId,
    search: props.search,
    activeProject,
    activeThreadSummary,
    threadSummaries,
    workspaceRoot,
  });

  const {
    handleReferenceInChat,
    handleAskWhyInChat,
    handleCommentInChat,
    dockFileOpener,
    editorFileOpener,
  } = useSingleChatWorkspaceBridge({
    threadId: props.threadId,
    workspaceRoot,
    openDockFile: dock.openDockFile,
    selectEditorFile: editor.explorer.selectFile,
  });

  const renderDockPane = useSingleChatDockPaneRenderer({
    threadId: props.threadId,
    projectId: props.projectId,
    workspaceRoot,
    activeProject,
    activeThreadSummary,
    dockState: dock.model.dockState,
    closePane: dock.pane.close,
    closeDockPane: dock.pane.closeManaged,
    updatePane: dock.pane.update,
    requestActiveDockPaneLive: dock.pane.requestLive,
    navigate,
    handleReferenceInChat,
    handleAskWhyInChat,
    handleCommentInChat,
    handleJumpToHighlight: dock.pane.jumpToHighlight,
  });

  if (!agentGroupSessionGate.ready) {
    if (!agentGroupSessionGate.error) return <ChatMountSkeleton />;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">{agentGroupSessionGate.error}</p>
          <Button variant="outline" size="sm" onClick={agentGroupSessionGate.retry}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (editor.route.isActive) {
    return (
      <WorkspaceFileOpenerContext.Provider value={editorFileOpener}>
        <div
          className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}
        >
          <Suspense fallback={<ChatMountSkeleton />}>
            <EditorWorkspaceView
              workspaceRoot={workspaceRoot}
              projectName={activeProject?.name ?? null}
              currentProjectId={activeProject?.id ?? null}
              projectOptions={editor.project.options}
              selectedFilePath={editor.explorer.selectedFilePath}
              expandedDirectories={editor.explorer.expandedDirectories}
              centerMode={editor.center.mode}
              diffFiles={editor.diff.files}
              diffFilesLoading={editor.diff.filesLoading}
              selectedDiffFilePath={editor.diff.panelState.diffFilePath ?? null}
              diffOptionsControl={editor.diff.optionsControl}
              onSelectDiffFile={editor.diff.selectFile}
              onSelectFile={editor.explorer.selectFile}
              onToggleDirectory={editor.explorer.toggleDirectory}
              onCenterModeChange={editor.center.setMode}
              onExitEditorView={editor.route.close}
              onReferenceInChat={handleReferenceInChat}
              onAskWhyInChat={handleAskWhyInChat}
              onCommentInChat={handleCommentInChat}
              onSelectProject={editor.project.select}
              diffPanel={
                <LazyDiffPanel
                  mode="sidebar"
                  threadId={props.threadId}
                  panelState={editor.diff.panelState}
                  onUpdatePanelState={editor.diff.updatePanelState}
                  liveRefreshEnabled={editor.center.mode === "diff"}
                  // Keep diff data warm while browsing files so switching to the
                  // diff tab renders instantly instead of cold-fetching.
                  queriesEnabled
                  hideHeader
                  onRenderableFilesChange={editor.diff.updateFiles}
                  onEditorDiffOptionsChange={editor.diff.updateOptions}
                />
              }
              chatPanel={
                <SidebarInset
                  className="min-h-0 min-w-0 overflow-hidden overscroll-y-none text-foreground"
                  surfaceClassName={CHAT_BACKGROUND_CLASS_NAME}
                >
                  <DeferredChatView
                    threadId={props.threadId}
                    paneScopeId={EDITOR_CHAT_PANE_SCOPE_ID}
                    deferMount={false}
                    surfaceMode="split"
                    presentationMode="editor"
                    isFocusedPane
                    panelState={editor.chatPanel.state}
                    onToggleDiff={editor.chatPanel.toggleDiff}
                    onToggleBrowser={noop}
                    onOpenBrowserUrl={noop}
                    onOpenTurnDiff={editor.chatPanel.openTurnDiff}
                  />
                </SidebarInset>
              }
            />
          </Suspense>
        </div>
      </WorkspaceFileOpenerContext.Provider>
    );
  }

  return (
    <WorkspaceFileOpenerContext.Provider value={dockFileOpener}>
      <div
        className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}
      >
        <ChatPaneDropOverlay
          canDropInDirection={denyAnySplitDirection}
          excludedThreadIds={dock.model.excludedThreadIds}
          onDrop={dock.split.dropThread}
          className="flex h-full min-h-0 min-w-0 flex-1"
        >
          <RouteInsetSurface surfaceClassName={CHAT_BACKGROUND_CLASS_NAME}>
            <DeferredChatView
              threadId={props.threadId}
              paneScopeId={SINGLE_CHAT_PANE_SCOPE_ID}
              deferMount={false}
              surfaceMode="single"
              isFocusedPane
              panelState={dock.model.chatPanelState}
              onToggleDiff={dock.chat.toggleDiff}
              onToggleBrowser={dock.chat.toggleBrowser}
              onOpenHighlights={dock.chat.openHighlights}
              onOpenBrowserUrl={dock.chat.openBrowser}
              onOpenTurnDiff={dock.chat.openTurnDiff}
            />
          </RouteInsetSurface>
        </ChatPaneDropOverlay>
        <RightDock
          state={dock.model.dockState}
          minWidth={SINGLE_PANEL_MIN_WIDTH}
          defaultWidth={DIFF_INLINE_DEFAULT_WIDTH}
          shouldAcceptWidth={dock.dock.shouldAcceptWidth}
          addMenuKinds={RIGHT_DOCK_ADD_MENU_KINDS}
          motionKey={props.threadId}
          activePaneRuntimeMode={dock.model.activePaneRuntimeMode}
          {...(dock.model.paneLabelOverrides
            ? { paneLabelOverrides: dock.model.paneLabelOverrides }
            : {})}
          {...(dock.model.paneIconOverrides
            ? { paneIconOverrides: dock.model.paneIconOverrides }
            : {})}
          onSelectPane={dock.dock.selectPane}
          onClosePane={dock.dock.closePane}
          onCollapse={() => dock.dock.setOpen(false)}
          onAddPane={dock.dock.addPane}
          renderPane={renderDockPane}
        />
      </div>
    </WorkspaceFileOpenerContext.Provider>
  );
}
