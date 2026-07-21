import type { ProjectId, ProviderKind, ThreadId, TurnId } from "@agent-group/contracts";
import { useCallback } from "react";

import { ProviderIcon } from "../components/ProviderIcon";
import { ChatPaneDropOverlay } from "../components/chat-drop-overlay/ChatPaneDropOverlay";
import { DeferredChatView } from "../components/chat/ChatRouteDeferredSurface";
import { CHAT_BACKGROUND_CLASS_NAME } from "../components/chat/composerPickerStyles";
import { SidebarInset } from "../components/ui/sidebar";
import { splitViewPaneScopeId } from "../lib/chatPaneScope";
import type {
  PaneId,
  SplitDirection,
  SplitDropSide,
  SplitView,
  SplitViewPanePanelState,
} from "../splitViewStore";
import { cn } from "~/lib/utils";
import { resolveThreadPickerTitle } from "./-chatThreadRoute.logic";
import { SplitPaneEmbeddedPanel } from "./-chatThreadRoute.splitLayout";

function SplitPaneEmptyState(props: {
  isFocused: boolean;
  onFocus: () => void;
  threads: readonly {
    id: ThreadId;
    title: string | null;
    projectId: ProjectId;
    modelSelection: { provider: ProviderKind };
  }[];
  projects: readonly { id: ProjectId; name: string }[];
  excludedThreadIds: ReadonlySet<ThreadId>;
  onSelectThread: (threadId: ThreadId) => void;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col items-center px-6 pt-16",
        CHAT_BACKGROUND_CLASS_NAME,
        props.isFocused ? "ring-2 ring-inset ring-primary/70" : "",
      )}
      onMouseDown={props.onFocus}
    >
      <div className="w-full max-w-sm space-y-4">
        <p className="text-center text-sm font-medium text-foreground/70">Select a chat</p>
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {props.threads.map((thread) => {
            const isUsed = props.excludedThreadIds.has(thread.id);
            const projectName =
              props.projects.find((p) => p.id === thread.projectId)?.name ?? "Project";
            return (
              <button
                key={thread.id}
                type="button"
                disabled={isUsed}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                  isUsed
                    ? "cursor-default border-border/30 opacity-35"
                    : "border-[color:var(--color-border-light)] hover:bg-[var(--sidebar-accent)]",
                )}
                onClick={() => {
                  if (!isUsed) props.onSelectThread(thread.id);
                }}
              >
                <ProviderIcon
                  provider={thread.modelSelection.provider}
                  className="size-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {resolveThreadPickerTitle(thread.title)}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{projectName}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SplitPaneSurface(props: {
  splitView: SplitView;
  paneId: PaneId;
  threadId: ThreadId | null;
  panelState: SplitViewPanePanelState;
  isFocused: boolean;
  deferChatMount: boolean;
  canDropInDirection: (direction: SplitDirection) => boolean;
  excludedThreadIds: ReadonlySet<ThreadId>;
  threads: readonly {
    id: ThreadId;
    title: string | null;
    projectId: ProjectId;
    modelSelection: { provider: ProviderKind };
  }[];
  projects: readonly { id: ProjectId; name: string }[];
  onFocus: () => void;
  onToggleDiff: () => void;
  onToggleBrowser: () => void;
  onOpenBrowserUrl: (url: string) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onClosePanel: () => void;
  onUpdatePanelState: (
    patch: Partial<Pick<SplitViewPanePanelState, "panel" | "diffTurnId" | "diffFilePath">>,
  ) => void;
  onMaximize: () => void;
  onCloseThreadPane: () => void;
  onChooseThread: () => void;
  onSelectThread: (threadId: ThreadId) => void;
  onChatMounted: () => void;
  onDropThread: (payload: {
    droppedThreadId: ThreadId;
    direction: SplitDirection;
    side: SplitDropSide;
  }) => void;
}) {
  const paneScopeId = splitViewPaneScopeId(props.splitView.id, props.paneId);
  const panelOpen = props.panelState.panel !== null;
  const shouldRenderPanelContent = panelOpen || props.panelState.hasOpenedPanel;

  const onDropThread = props.onDropThread;
  const handleDrop = useCallback(
    (payload: { threadId: ThreadId; direction: SplitDirection; side: SplitDropSide }) => {
      onDropThread({
        droppedThreadId: payload.threadId,
        direction: payload.direction,
        side: payload.side,
      });
    },
    [onDropThread],
  );

  return (
    <div
      className={cn(
        "group relative flex min-h-0 min-w-0 flex-1 [contain:layout_style_paint]",
        CHAT_BACKGROUND_CLASS_NAME,
      )}
    >
      <ChatPaneDropOverlay
        paneScopeId={paneScopeId}
        canDropInDirection={props.canDropInDirection}
        excludedThreadIds={props.excludedThreadIds}
        onDrop={handleDrop}
        className="flex min-h-0 min-w-0 flex-1"
      >
        <SidebarInset
          className={cn(
            "min-h-0 min-w-0 overflow-hidden overscroll-y-none text-foreground transition-shadow",
            props.isFocused ? "ring-2 ring-inset ring-primary/70" : "",
          )}
          surfaceClassName={CHAT_BACKGROUND_CLASS_NAME}
          onMouseDown={props.onFocus}
        >
          {props.threadId ? (
            <DeferredChatView
              threadId={props.threadId}
              paneScopeId={paneScopeId}
              deferMount={props.deferChatMount}
              surfaceMode="split"
              isFocusedPane={props.isFocused}
              panelState={props.panelState}
              onToggleDiff={props.onToggleDiff}
              onToggleBrowser={props.onToggleBrowser}
              onOpenBrowserUrl={props.onOpenBrowserUrl}
              onOpenTurnDiff={props.onOpenTurnDiff}
              onMaximize={props.onMaximize}
              onChangeThread={props.onChooseThread}
              onCloseThreadPane={props.onCloseThreadPane}
              onMounted={props.onChatMounted}
            />
          ) : (
            <SplitPaneEmptyState
              isFocused={props.isFocused}
              onFocus={props.onFocus}
              threads={props.threads}
              projects={props.projects}
              excludedThreadIds={props.excludedThreadIds}
              onSelectThread={props.onSelectThread}
            />
          )}
        </SidebarInset>
      </ChatPaneDropOverlay>
      <SplitPaneEmbeddedPanel
        splitViewId={props.splitView.id}
        paneId={props.paneId}
        paneScopeId={paneScopeId}
        panelOpen={panelOpen && shouldRenderPanelContent}
        panel={props.panelState.panel}
        threadId={props.threadId}
        onClosePanel={props.onClosePanel}
        panelState={props.panelState}
        isFocused={props.isFocused}
        onUpdatePanelState={props.onUpdatePanelState}
      />
      {props.isFocused ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-[0.9px] z-20 border border-[color-mix(in_srgb,var(--info)_45%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--info)_12%,transparent)] transition-opacity duration-150"
        />
      ) : null}
      {!props.isFocused ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 bg-foreground/[0.060] transition-opacity duration-150"
        />
      ) : null}
    </div>
  );
}
