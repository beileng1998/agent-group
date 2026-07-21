import { SINGLE_CHAT_PANE_SCOPE_ID } from "../lib/chatPaneScope";
import { useChatRuntimeGraphOwner } from "../hooks/useChatRuntimeGraphOwner";
import { useChatViewExecutionGraphOwner } from "../hooks/useChatViewExecutionGraphOwner";
import { useChatViewFoundationOwner } from "../hooks/useChatViewFoundationOwner";
import { useChatViewInteractionGraphOwner } from "../hooks/useChatViewInteractionGraphOwner";
import { buildChatComposerSurfaceGraph } from "./chat/buildChatComposerSurfaceGraph";
import { buildChatShellSurfaceGraph } from "./chat/buildChatShellSurfaceGraph";
import type { ChatViewProps } from "./chat/ChatView.types";
import { ChatViewSurface } from "./chat/ChatViewSurface";
import { NoActiveThreadView } from "./chat/NoActiveThreadView";

export default function ChatView(props: ChatViewProps) {
  const surfaceMode = props.surfaceMode ?? "single";
  const presentationMode = props.presentationMode ?? "default";
  const isFocusedPane = props.isFocusedPane ?? true;
  const paneScopeId = props.paneScopeId ?? SINGLE_CHAT_PANE_SCOPE_ID;
  const foundation = useChatViewFoundationOwner({
    threadId: props.threadId,
    surfaceMode,
    presentationMode,
    isFocusedPane,
  });
  const runtimeGraph = useChatRuntimeGraphOwner({
    foundation,
    panels: {
      state: props.panelState,
      onToggleDiff: props.onToggleDiffPanel,
      onToggleBrowser: props.onToggleBrowserPanel,
      onOpenBrowserUrl: props.onOpenBrowserUrl,
    },
    onSidechatPromoted: props.onSidechatPromoted,
  });
  const interactionGraph = useChatViewInteractionGraphOwner({
    foundation,
    runtimeGraph,
    route: {
      onOpenTurnDiffPanel: props.onOpenTurnDiffPanel,
      onOpenHighlightsPanel: props.onOpenHighlightsPanel,
    },
  });
  const executionGraph = useChatViewExecutionGraphOwner({
    foundation,
    runtimeGraph,
    interactionGraph,
  });

  if (!foundation.thread.activeThread) {
    return <NoActiveThreadView />;
  }

  const composerSurface = buildChatComposerSurfaceGraph({
    foundation,
    runtimeGraph,
    interactionGraph,
    executionGraph,
    paneScopeId,
  });
  const shellSurface = buildChatShellSurfaceGraph({
    foundation,
    runtimeGraph,
    interactionGraph,
    executionGraph,
    composerSurface,
    navigation: {
      ...(props.onChangeThreadInSplitPane
        ? { onChangeThreadInSplitPane: props.onChangeThreadInSplitPane }
        : {}),
      ...(props.onCloseThreadPane ? { onCloseThreadPane: props.onCloseThreadPane } : {}),
      ...(props.onOpenHighlightsPanel
        ? { onOpenHighlightsPanel: props.onOpenHighlightsPanel }
        : {}),
      ...(props.viewModeAction !== undefined ? { viewModeAction: props.viewModeAction } : {}),
    },
  });
  const dropzone = interactionGraph.composerInteraction.references.dropzone;

  return (
    <ChatViewSurface
      drag={{
        active: interactionGraph.composerInteraction.drag.isDragOverComposer,
        dropzone: {
          onDragEnter: dropzone.onComposerDragEnter,
          onDragLeave: dropzone.onComposerDragLeave,
          onDragOver: dropzone.onComposerDragOver,
          onDrop: dropzone.onComposerDrop,
        },
      }}
      header={shellSurface.headerSurfaceModel}
      dialogs={shellSurface.dialogLayerModel}
      workspace={shellSurface.workspaceSurfaceModel}
      overlays={shellSurface.overlayLayerModel}
      banners={{
        providerStatus: shellSurface.banners.providerStatus,
        onDismissProvider: shellSurface.banners.dismissProvider,
        threadError: shellSurface.banners.threadError,
        rateLimitStatus: shellSurface.banners.rateLimitStatus,
        onDismissRateLimit: shellSurface.banners.dismissRateLimit,
      }}
    />
  );
}
