// FILE: useChatTranscriptSurfaceOwner.tsx
// Purpose: Assemble transcript and workspace presentation models from grouped chat owners.
// Layer: Web chat presentation owner

import type { ReactNode } from "react";

import { AGENT_GROUP_CAPABILITIES } from "../agentGroupCapabilities";
import {
  type ChatTranscriptSurfaceModel,
  ChatTranscriptSurface,
} from "../components/chat/ChatTranscriptSurface";
import type { ChatWorkspaceSurfaceModel } from "../components/chat/ChatWorkspaceSurface";
import {
  ENVIRONMENT_DOCKED_CONTENT_INSET_PX,
  type EnvironmentPanelProps,
} from "../components/chat/environment/EnvironmentPanel";
import { EMPTY_REVERT_TURN_COUNTS } from "../components/chat/chatViewComposerValues";
import type { ChatEnvironmentPanelController } from "./useChatEnvironmentPanelController";
import type { useChatTerminalController } from "./useChatTerminalController";

type TranscriptModel = ChatTranscriptSurfaceModel["transcript"];
type TerminalController = ReturnType<typeof useChatTerminalController>;

type TranscriptTimelineInput = Pick<
  TranscriptModel,
  | "chatFontSizePx"
  | "enteringUserMessageIds"
  | "listRef"
  | "pinnedMessageIds"
  | "resolvedTheme"
  | "scrollButtonVisible"
  | "threadMarkers"
  | "timelineControllerRef"
  | "timelineEntries"
  | "timestampFormat"
  | "turnDiffSummaryByAssistantMessageId"
> & {
  readonly hasLiveOutput: boolean;
  readonly hasStreamingAssistantText: boolean;
  readonly initialScrollOffsetPx: number | null;
  readonly revertTurnCountByUserMessageId: TranscriptModel["revertTurnCountByUserMessageId"];
};

type TranscriptInteractionInput = Pick<
  TranscriptModel,
  | "isRevertingCheckpoint"
  | "onCloseAgentActivityDetail"
  | "onEditUserMessage"
  | "onExpandTimelineImage"
  | "onIsAtEndChange"
  | "onMessagesClickCapture"
  | "onMessagesMouseUp"
  | "onMessagesPointerCancel"
  | "onMessagesPointerDown"
  | "onMessagesPointerUp"
  | "onMessagesScroll"
  | "onMessagesTouchEnd"
  | "onMessagesTouchMove"
  | "onMessagesTouchStart"
  | "onMessagesWheel"
  | "onOpenAgentActivity"
  | "onOpenAssistantSelection"
  | "onOpenAutomation"
  | "onOpenThread"
  | "onOpenTurnDiff"
  | "onRevertUserMessage"
  | "onScrollToBottom"
  | "onTogglePinMessage"
  | "onUndoTurnFiles"
> & {
  readonly isPendingSetupBubbleId: NonNullable<TranscriptModel["canPinMessage"]>;
};

export interface ChatTranscriptSurfaceOwnerInput {
  readonly visibility: {
    readonly shouldRenderChatPaneContent: boolean;
    readonly isCenteredEmptyLanding: boolean;
    readonly secondaryChromeReady: boolean;
  };
  readonly thread: Pick<
    TranscriptModel,
    | "activeThreadId"
    | "activeTurnId"
    | "activeTurnInProgress"
    | "activeTurnStartedAt"
    | "agentActivityDetail"
    | "worktreeSetup"
  > & {
    readonly activeProjectDisplayName: string | undefined;
    readonly isEditorRail: boolean;
    readonly isHomeLanding: boolean;
    readonly markdownCwd: string | null | undefined;
    readonly workspaceRoot: string | null | undefined;
  };
  readonly timeline: TranscriptTimelineInput;
  readonly interactions: TranscriptInteractionInput;
  readonly composer: {
    readonly content: ReactNode;
    readonly stackedChromeHeight: number;
  };
  readonly accessory: ChatTranscriptSurfaceModel["accessory"] & {
    readonly pullRequest: ChatTranscriptSurfaceModel["pullRequest"];
  };
  readonly workspace: {
    readonly controller: Pick<
      TerminalController,
      | "collapseWorkspace"
      | "expandWorkspace"
      | "setWorkspaceTab"
      | "terminalState"
      | "workspaceOpen"
    >;
    readonly drawerProps: ChatWorkspaceSurfaceModel["terminal"]["drawerProps"];
    readonly isEditorRail: boolean;
    readonly isWorking: boolean;
    readonly terminalWorkspaceTerminalTabActive: boolean;
  };
  readonly environment: {
    readonly controller: Pick<
      ChatEnvironmentPanelController,
      "appliesContentInset" | "enabled" | "variant" | "visible"
    >;
    readonly props: Omit<EnvironmentPanelProps, "open" | "variant">;
  };
  readonly plan: {
    readonly open: boolean;
    readonly activeTaskList: ChatWorkspaceSurfaceModel["plan"]["props"]["activeTaskList"];
    readonly activeProposedPlan: ChatWorkspaceSurfaceModel["plan"]["props"]["activeProposedPlan"];
    readonly onClose: ChatWorkspaceSurfaceModel["plan"]["props"]["onClose"];
  };
}

export interface ChatTranscriptSurfaceOwner {
  readonly transcriptSurfaceModel: ChatTranscriptSurfaceModel;
  readonly workspaceSurfaceModel: ChatWorkspaceSurfaceModel;
}

export function buildChatTranscriptSurface(
  input: ChatTranscriptSurfaceOwnerInput,
): ChatTranscriptSurfaceOwner {
  const { controller: terminalController } = input.workspace;
  const { terminalState } = terminalController;
  const transcriptSurfaceModel: ChatTranscriptSurfaceModel = {
    visibility: {
      shouldRenderContent: input.visibility.shouldRenderChatPaneContent,
      centeredEmptyLanding: input.visibility.isCenteredEmptyLanding,
      secondaryChromeReady: input.visibility.secondaryChromeReady,
      ...(input.environment.controller.appliesContentInset
        ? { rightInsetPx: ENVIRONMENT_DOCKED_CONTENT_INSET_PX }
        : {}),
    },
    landing: {
      isHomeLanding: input.thread.isHomeLanding,
      projectDisplayName: input.thread.activeProjectDisplayName,
    },
    transcript: {
      activeThreadId: input.thread.activeThreadId,
      ...(input.thread.activeTurnId !== undefined
        ? { activeTurnId: input.thread.activeTurnId }
        : {}),
      ...(input.thread.agentActivityDetail !== undefined
        ? { agentActivityDetail: input.thread.agentActivityDetail }
        : {}),
      hasMessages: input.timeline.timelineEntries.length > 0,
      isWorking: input.timeline.hasLiveOutput,
      worktreeSetup: input.thread.worktreeSetup,
      activeTurnInProgress: input.thread.activeTurnInProgress,
      activeTurnStartedAt: input.thread.activeTurnStartedAt,
      listRef: input.timeline.listRef,
      ...(input.timeline.timelineControllerRef !== undefined
        ? { timelineControllerRef: input.timeline.timelineControllerRef }
        : {}),
      ...(input.timeline.pinnedMessageIds !== undefined
        ? { pinnedMessageIds: input.timeline.pinnedMessageIds }
        : {}),
      canPinMessage: (messageId) => !input.interactions.isPendingSetupBubbleId(messageId),
      ...(input.interactions.onTogglePinMessage !== undefined
        ? { onTogglePinMessage: input.interactions.onTogglePinMessage }
        : {}),
      ...(input.timeline.threadMarkers !== undefined
        ? { threadMarkers: input.timeline.threadMarkers }
        : {}),
      ...(input.timeline.enteringUserMessageIds !== undefined
        ? { enteringUserMessageIds: input.timeline.enteringUserMessageIds }
        : {}),
      timelineEntries: input.timeline.timelineEntries,
      turnDiffSummaryByAssistantMessageId: input.timeline.turnDiffSummaryByAssistantMessageId,
      onOpenTurnDiff: input.interactions.onOpenTurnDiff,
      onOpenThread: input.interactions.onOpenThread,
      ...(input.interactions.onOpenAutomation !== undefined
        ? { onOpenAutomation: input.interactions.onOpenAutomation }
        : {}),
      ...(input.interactions.onOpenAssistantSelection !== undefined
        ? { onOpenAssistantSelection: input.interactions.onOpenAssistantSelection }
        : {}),
      revertTurnCountByUserMessageId: AGENT_GROUP_CAPABILITIES.checkpoints
        ? input.timeline.revertTurnCountByUserMessageId
        : EMPTY_REVERT_TURN_COUNTS,
      onRevertUserMessage: input.interactions.onRevertUserMessage,
      ...(AGENT_GROUP_CAPABILITIES.checkpoints && input.interactions.onUndoTurnFiles
        ? { onUndoTurnFiles: input.interactions.onUndoTurnFiles }
        : {}),
      ...(AGENT_GROUP_CAPABILITIES.checkpoints && input.interactions.onEditUserMessage
        ? { onEditUserMessage: input.interactions.onEditUserMessage }
        : {}),
      isRevertingCheckpoint: input.interactions.isRevertingCheckpoint,
      onExpandTimelineImage: input.interactions.onExpandTimelineImage,
      followLiveOutput: input.timeline.hasStreamingAssistantText,
      ...(input.timeline.initialScrollOffsetPx !== null
        ? { initialScrollOffsetPx: input.timeline.initialScrollOffsetPx }
        : {}),
      onIsAtEndChange: input.interactions.onIsAtEndChange,
      markdownCwd: input.thread.markdownCwd ?? undefined,
      resolvedTheme: input.timeline.resolvedTheme,
      chatFontSizePx: input.timeline.chatFontSizePx,
      timestampFormat: input.timeline.timestampFormat,
      workspaceRoot: input.thread.workspaceRoot ?? undefined,
      ...(input.thread.isEditorRail ? { emptyStateContent: <span aria-hidden="true" /> } : {}),
      emptyStateProjectName: input.thread.activeProjectDisplayName,
      terminalWorkspaceTerminalTabActive: input.workspace.terminalWorkspaceTerminalTabActive,
      onMessagesScroll: input.interactions.onMessagesScroll,
      onMessagesClickCapture: input.interactions.onMessagesClickCapture,
      onMessagesMouseUp: input.interactions.onMessagesMouseUp,
      onMessagesWheel: input.interactions.onMessagesWheel,
      onMessagesPointerDown: input.interactions.onMessagesPointerDown,
      onMessagesPointerUp: input.interactions.onMessagesPointerUp,
      onMessagesPointerCancel: input.interactions.onMessagesPointerCancel,
      onMessagesTouchStart: input.interactions.onMessagesTouchStart,
      onMessagesTouchMove: input.interactions.onMessagesTouchMove,
      onMessagesTouchEnd: input.interactions.onMessagesTouchEnd,
      ...(input.interactions.onOpenAgentActivity !== undefined
        ? { onOpenAgentActivity: input.interactions.onOpenAgentActivity }
        : {}),
      ...(input.interactions.onCloseAgentActivityDetail !== undefined
        ? { onCloseAgentActivityDetail: input.interactions.onCloseAgentActivityDetail }
        : {}),
      scrollButtonVisible: input.timeline.scrollButtonVisible,
      onScrollToBottom: input.interactions.onScrollToBottom,
      ...(input.composer.stackedChromeHeight > 0
        ? { bottomContentInsetPx: input.composer.stackedChromeHeight + 8 }
        : {}),
    },
    composer: input.composer.content,
    accessory: input.accessory,
    pullRequest: input.accessory.pullRequest,
  };
  const workspaceSurfaceModel: ChatWorkspaceSurfaceModel = {
    tabs: {
      visible: terminalController.workspaceOpen && !input.workspace.isEditorRail,
      props: {
        activeTab: terminalState.workspaceActiveTab,
        isWorking: input.workspace.isWorking,
        terminalHasRunningActivity: terminalState.runningTerminalIds.length > 0,
        terminalCount: terminalState.terminalIds.length,
        workspaceLayout: terminalState.workspaceLayout,
        onSelectTab: terminalController.setWorkspaceTab,
      },
    },
    chat: {
      content: <ChatTranscriptSurface model={transcriptSurfaceModel} />,
      terminalWorkspaceActive: input.workspace.terminalWorkspaceTerminalTabActive,
    },
    terminal: {
      open: terminalState.terminalOpen,
      drawerProps: input.workspace.drawerProps,
      workspace: {
        open: terminalController.workspaceOpen,
        active: input.workspace.terminalWorkspaceTerminalTabActive,
        onTogglePresentationMode:
          terminalState.workspaceLayout === "both"
            ? terminalController.collapseWorkspace
            : undefined,
      },
      drawer: { onTogglePresentationMode: terminalController.expandWorkspace },
    },
    environment: {
      enabled: input.environment.controller.enabled,
      props: {
        ...input.environment.props,
        open: input.environment.controller.visible,
        variant: input.environment.controller.variant,
      },
    },
    plan: {
      open: input.plan.open,
      props: {
        activeTaskList: input.plan.activeTaskList,
        activeProposedPlan: input.plan.activeProposedPlan,
        markdownCwd: input.thread.markdownCwd ?? undefined,
        workspaceRoot: input.thread.workspaceRoot ?? undefined,
        timestampFormat: input.timeline.timestampFormat,
        onClose: input.plan.onClose,
      },
    },
  };

  return { transcriptSurfaceModel, workspaceSurfaceModel };
}
