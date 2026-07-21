// FILE: MessagesTimeline.tsx
// Purpose: Renders the chat transcript rows and lets LegendList own scrolling/follow behavior.
// Layer: Web chat presentation component
// Exports: MessagesTimeline

import { type MessageId, ThreadId, type ThreadMarker, type TurnId } from "@agent-group/contracts";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { memo, useMemo, type ComponentProps, type ReactNode, type RefObject } from "react";
import { deriveTimelineEntries } from "../../session-logic";
import type {
  ChatAssistantSelectionAttachment,
  TurnDiffSummary,
  WorktreeSetupSnapshot,
} from "../../types";
import { cn } from "~/lib/utils";
import {
  DEFAULT_CHAT_FONT_SIZE_PX,
  normalizeChatFontSizePx,
  type TimestampFormat,
} from "../../appSettings";
import { getAppTypographyScale } from "../../lib/appTypography";
import type { ActiveTrailSnapshot } from "./messageTrail.logic";
import {
  CHAT_COLUMN_GUTTER_CLASS_NAME,
  ENVIRONMENT_CONTENT_INSET_MOTION_CLASS,
} from "./composerPickerStyles";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { deriveMessagesTimelineRows, type MessagesTimelineRow } from "./MessagesTimeline.logic";
import {
  useMessageSendEnterAnimations,
  useSettledTurnCollapseTransitions,
  useStableRows,
  useWorktreeSetupPresentation,
} from "./MessagesTimeline.controllers";
import { renderMessagesTimelineRow, type MessagesTimelineRowContext } from "./MessagesTimeline.row";
import { ToolCallDetailsDialog } from "./ToolCallDetailsDialog";
import {
  TRAIL_VIEWABILITY_CONFIG,
  useMessagesTimelineViewport,
  type MessagesTimelineController,
} from "./useMessagesTimelineViewport";
import { useMessagesTimelineUiState } from "./useMessagesTimelineUiState";
import { getChatMessageFooterTextStyle, getChatTranscriptTextStyle } from "./chatTypography";

// The composer overlaps the transcript by design, so the list needs extra tail
// space beyond the overlap to keep final cards from sitting flush against it.
const MIN_BOTTOM_CONTENT_INSET_PX = 64;
const EMPTY_MESSAGE_ID_SET: ReadonlySet<MessageId> = new Set();

export { findToolDetailsEntryById } from "./MessagesTimeline.controllers";

/**
 * Imperative handle the transcript exposes so the Environment panel's pinned-message
 * checklist can scroll the virtualized list to (and briefly flash) a specific message.
 */
export type { MessagesTimelineController };

interface MessagesTimelineProps {
  hasMessages: boolean;
  isWorking: boolean;
  activeTurnInProgress: boolean;
  activeTurnStartedAt: string | null;
  /** Transient "New worktree" setup progress; rendered as an ephemeral step card at the tail. */
  worktreeSetup?: WorktreeSetupSnapshot | null;
  followLiveOutput?: boolean;
  /** Restores a thread viewport instead of applying the default initial tail stick. */
  initialScrollOffsetPx?: number;
  emptyStateContent?: ReactNode;
  listRef?: RefObject<LegendListRef | null>;
  /** Receives the scroll-to-message controller so the Environment panel can jump to a pin. */
  controllerRef?: RefObject<MessagesTimelineController | null>;
  /** Message ids currently pinned for the active thread (drives the footer pin toggle state). */
  pinnedMessageIds?: ReadonlySet<MessageId>;
  /** Excludes transient rows from persistent pin affordances. */
  canPinMessage?: (messageId: MessageId) => boolean;
  /** Toggle a message's pinned state from the assistant footer. */
  onTogglePinMessage?: (messageId: MessageId) => void;
  /** Text markers for assistant messages in the active thread. */
  threadMarkers?: readonly ThreadMarker[];
  /** User messages inserted locally by send actions, eligible for the subtle enter affordance. */
  enteringUserMessageIds?: ReadonlySet<MessageId>;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  nowIso?: string;
  expandedWorkGroups?: Record<string, boolean>;
  onToggleWorkGroup?: (groupId: string) => void;
  onOpenAgentActivity?: (activityId: string) => void;
  onOpenAssistantSelection?: (selection: ChatAssistantSelectionAttachment) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onOpenThread?: (threadId: ThreadId) => void;
  /** Open an automation's detail page from a "created automation" transcript card. */
  onOpenAutomation?: (automationId: string) => void;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onRevertUserMessage: (messageId: MessageId) => void;
  onUndoTurnFiles?: (turnCounts: readonly number[]) => void;
  onEditUserMessage?: (messageId: MessageId, text: string) => boolean | Promise<boolean>;
  activeTurnId?: TurnId | null;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onIsAtEndChange?: (isAtEnd: boolean) => void;
  /** Emits current + visible sent-message anchors as the viewport scrolls (drives the trail). */
  onTrailHighlightsChange?: (snapshot: ActiveTrailSnapshot) => void;
  onMessagesClickCapture?: ComponentProps<typeof LegendList>["onClickCapture"];
  onMessagesMouseUp?: ComponentProps<typeof LegendList>["onMouseUp"];
  onMessagesPointerCancel?: ComponentProps<typeof LegendList>["onPointerCancel"];
  onMessagesPointerDown?: ComponentProps<typeof LegendList>["onPointerDown"];
  onMessagesPointerUp?: ComponentProps<typeof LegendList>["onPointerUp"];
  onMessagesScroll?: ComponentProps<typeof LegendList>["onScroll"];
  onMessagesTouchEnd?: ComponentProps<typeof LegendList>["onTouchEnd"];
  onMessagesTouchMove?: ComponentProps<typeof LegendList>["onTouchMove"];
  onMessagesTouchStart?: ComponentProps<typeof LegendList>["onTouchStart"];
  onMessagesWheel?: ComponentProps<typeof LegendList>["onWheel"];
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  chatFontSizePx?: number;
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  bottomContentInsetPx?: number | undefined;
  /**
   * Right padding (px) applied to the scroll viewport so transcript rows clear a right-edge
   * overlay (e.g. the docked Environment card). The scrollbar stays pinned to the viewport's
   * far right; only the content is inset.
   */
  contentInsetRightPx?: number | undefined;
}

export const MessagesTimeline = memo(function MessagesTimeline({
  hasMessages,
  isWorking,
  activeTurnInProgress,
  activeTurnStartedAt,
  worktreeSetup = null,
  followLiveOutput = false,
  initialScrollOffsetPx,
  listRef,
  controllerRef,
  pinnedMessageIds,
  canPinMessage,
  onTogglePinMessage,
  threadMarkers = [],
  enteringUserMessageIds = EMPTY_MESSAGE_ID_SET,
  timelineEntries,
  turnDiffSummaryByAssistantMessageId,
  nowIso,
  expandedWorkGroups,
  onToggleWorkGroup,
  onOpenAgentActivity,
  onOpenAssistantSelection,
  onOpenTurnDiff,
  onOpenThread,
  onOpenAutomation,
  revertTurnCountByUserMessageId,
  onRevertUserMessage,
  onUndoTurnFiles,
  onEditUserMessage,
  activeTurnId,
  isRevertingCheckpoint,
  onImageExpand,
  onIsAtEndChange,
  onTrailHighlightsChange,
  onMessagesClickCapture,
  onMessagesMouseUp,
  onMessagesPointerCancel,
  onMessagesPointerDown,
  onMessagesPointerUp,
  onMessagesScroll,
  onMessagesTouchEnd,
  onMessagesTouchMove,
  onMessagesTouchStart,
  onMessagesWheel,
  markdownCwd,
  resolvedTheme,
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
  timestampFormat,
  workspaceRoot,
  emptyStateContent,
  bottomContentInsetPx,
  contentInsetRightPx,
}: MessagesTimelineProps) {
  const normalizedChatFontSizePx = normalizeChatFontSizePx(chatFontSizePx);
  // Inset rows from the right (overriding the gutter's right padding) without moving the
  // scroll viewport, so the scrollbar stays pinned to the far right while content clears
  // any right-edge overlay. Kept stable so LegendList isn't re-rendered on unrelated updates.
  const listScrollStyle = useMemo(
    () => (contentInsetRightPx ? { paddingRight: contentInsetRightPx } : undefined),
    [contentInsetRightPx],
  );
  const appTypographyScale = useMemo(
    () => getAppTypographyScale(normalizedChatFontSizePx),
    [normalizedChatFontSizePx],
  );
  const chatTypographyStyle = useMemo(
    () => getChatTranscriptTextStyle(normalizedChatFontSizePx),
    [normalizedChatFontSizePx],
  );
  const chatMessageFooterStyle = useMemo(
    () => getChatMessageFooterTextStyle(normalizedChatFontSizePx),
    [normalizedChatFontSizePx],
  );
  const bottomSpacerHeightPx = Math.max(bottomContentInsetPx ?? 0, MIN_BOTTOM_CONTENT_INSET_PX);
  const listFooter = useMemo(
    () => <div aria-hidden="true" style={{ height: bottomSpacerHeightPx }} />,
    [bottomSpacerHeightPx],
  );

  const presentedWorktreeSetup = useWorktreeSetupPresentation(worktreeSetup);
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        isWorking,
        worktreeSetup: presentedWorktreeSetup?.snapshot ?? null,
        worktreeSetupOpen: presentedWorktreeSetup?.open ?? false,
        activeTurnInProgress,
        activeTurnId,
        activeTurnStartedAt,
        turnDiffSummaryByAssistantMessageId,
        revertTurnCountByUserMessageId,
      }),
    [
      timelineEntries,
      isWorking,
      presentedWorktreeSetup,
      activeTurnInProgress,
      activeTurnId,
      activeTurnStartedAt,
      turnDiffSummaryByAssistantMessageId,
      revertTurnCountByUserMessageId,
    ],
  );
  const rows = useStableRows(rawRows);
  const settledTurnCollapseTransitions = useSettledTurnCollapseTransitions(rows);
  const enteringMessageRowIds = useMessageSendEnterAnimations(rows, enteringUserMessageIds);
  const {
    cancelUserMessageEdit,
    editingUserMessageId,
    expandedCollapsedWork,
    expandedFileChangesByTurnId,
    expandedFileListByTurnId,
    expandedUserMessagesById,
    expandedWorkGroupsState,
    handleToggleWorkGroup,
    handleToolDetailsOpenChange,
    latestEditableUserMessageId,
    openToolDetails,
    selectedToolDetailsEntry,
    setCollapsedWorkExpanded,
    setExpandedUserMessagesById,
    startUserMessageEdit,
    submitUserMessageEdit,
    submittingEditedUserMessageId,
    threadMarkersByMessageId,
    toggleFileChangesExpanded,
    toggleFileListExpanded,
  } = useMessagesTimelineUiState({
    ...(activeTurnId !== undefined ? { activeTurnId } : {}),
    ...(expandedWorkGroups !== undefined ? { expandedWorkGroups } : {}),
    ...(onEditUserMessage ? { onEditUserMessage } : {}),
    ...(onToggleWorkGroup ? { onToggleWorkGroup } : {}),
    rows,
    threadMarkers,
  });
  const {
    handleListScroll,
    handleViewableItemsChanged,
    highlightedMessageId,
    resolvedListRef,
    scrollTailExpansionToEnd,
    tailContentRowId,
    timelineRootRef,
  } = useMessagesTimelineViewport({
    rows,
    listRef,
    controllerRef,
    initialScrollOffsetPx,
    onIsAtEndChange,
    onMessagesScroll,
    onTrailHighlightsChange,
  });
  const timelineExtraData = useMemo(
    () => ({
      editingUserMessageId,
      enteringMessageRowIds,
      expandedCollapsedWork,
      expandedFileChangesByTurnId,
      expandedFileListByTurnId,
      expandedUserMessagesById,
      expandedWorkGroupsState,
      highlightedMessageId,
      pinnedMessageIds,
      settledTurnCollapseTransitions,
      submittingEditedUserMessageId,
      threadMarkersByMessageId,
    }),
    [
      editingUserMessageId,
      enteringMessageRowIds,
      expandedCollapsedWork,
      expandedFileChangesByTurnId,
      expandedFileListByTurnId,
      expandedUserMessagesById,
      expandedWorkGroupsState,
      highlightedMessageId,
      pinnedMessageIds,
      settledTurnCollapseTransitions,
      submittingEditedUserMessageId,
      threadMarkersByMessageId,
    ],
  );
  const rowRenderContext: MessagesTimelineRowContext = {
    appTypographyScale,
    assistant: {
      activeTurnInProgress,
      appTypographyScale,
      canPinMessage,
      chatMessageFooterStyle,
      chatTypographyStyle,
      expandedCollapsedWork,
      expandedFileChangesByTurnId,
      expandedFileListByTurnId,
      expandedWorkGroupsState,
      handleToggleWorkGroup,
      markdownCwd,
      normalizedChatFontSizePx,
      onImageExpand,
      onOpenAgentActivity,
      onOpenAutomation,
      onOpenThread,
      onOpenToolDetails: openToolDetails,
      onOpenTurnDiff,
      onTogglePinMessage,
      onUndoTurnFiles,
      pinnedMessageIds: pinnedMessageIds ?? EMPTY_MESSAGE_ID_SET,
      resolvedTheme,
      scrollTailExpansionToEnd,
      setCollapsedWorkExpanded,
      settledTurnCollapseTransitions,
      tailContentRowId,
      threadMarkersByMessageId,
      timestampFormat,
      toggleFileChangesExpanded,
      toggleFileListExpanded,
    },
    chatTypographyStyle,
    enteringMessageRowIds,
    expandedWorkGroupsState,
    handleToggleWorkGroup,
    highlightedMessageId,
    nowIso,
    user: {
      activeChatFontSizePx: normalizedChatFontSizePx,
      cancelUserMessageEdit,
      chatMessageFooterStyle,
      editingUserMessageId,
      expandedUserMessagesById,
      isRevertingCheckpoint,
      isWorking,
      latestEditableUserMessageId,
      markdownCwd,
      onEditUserMessage,
      onImageExpand,
      onOpenAssistantSelection,
      onRevertUserMessage,
      resolvedTheme,
      scrollTailExpansionToEnd,
      setExpandedUserMessagesById,
      startUserMessageEdit,
      submitUserMessageEdit,
      submittingEditedUserMessageId,
      tailContentRowId,
      timestampFormat,
    },
    workspaceRoot,
  };
  // Transient rows (for example failed first-send worktree setup) must be able
  // to render even when there are no persisted chat messages yet.
  const hasRenderableTranscriptContent = hasMessages || rows.length > 0;
  if (!hasRenderableTranscriptContent && !isWorking) {
    if (emptyStateContent) {
      return <div className="flex h-full items-center justify-center">{emptyStateContent}</div>;
    }
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground/30">
          Send a message to start the conversation.
        </p>
      </div>
    );
  }

  return (
    <div ref={timelineRootRef} className="contents" data-messages-timeline-root="true">
      <LegendList<MessagesTimelineRow>
        ref={resolvedListRef}
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => renderMessagesTimelineRow(item, rowRenderContext)}
        estimatedItemSize={90}
        // LegendList caches rendered rows, so every local expansion map that changes row content
        // has to be surfaced through extraData.
        extraData={timelineExtraData}
        initialScrollAtEnd={initialScrollOffsetPx === undefined}
        {...(initialScrollOffsetPx !== undefined
          ? { initialScrollOffset: initialScrollOffsetPx }
          : {})}
        maintainScrollAtEnd={followLiveOutput}
        maintainScrollAtEndThreshold={0.1}
        {...(!followLiveOutput ? { maintainVisibleContentPosition: true } : {})}
        onClickCapture={onMessagesClickCapture}
        onMouseUp={onMessagesMouseUp}
        onPointerCancel={onMessagesPointerCancel}
        onPointerDown={onMessagesPointerDown}
        onPointerUp={onMessagesPointerUp}
        onScroll={handleListScroll}
        {...(onTrailHighlightsChange
          ? {
              onViewableItemsChanged: handleViewableItemsChanged,
              viewabilityConfig: TRAIL_VIEWABILITY_CONFIG,
            }
          : {})}
        onTouchEnd={onMessagesTouchEnd}
        onTouchMove={onMessagesTouchMove}
        onTouchStart={onMessagesTouchStart}
        onWheel={onMessagesWheel}
        data-chat-scroll-container="true"
        ListFooterComponent={listFooter}
        // `scroll-fade-b` (vendored shadcn 4.12.0 util in index.css) masks the bottom
        // edge so streamed content dissolves toward the composer. It is scroll-aware
        // via `animation-timeline: scroll()`, so the fade clears at the live edge and a
        // pinned or non-scrollable transcript stays crisp (no permanent shadow).
        className={cn(
          "scroll-fade-b h-full overflow-x-hidden overscroll-y-contain py-3 [scrollbar-gutter:stable] sm:py-4",
          ENVIRONMENT_CONTENT_INSET_MOTION_CLASS,
          CHAT_COLUMN_GUTTER_CLASS_NAME,
        )}
        {...(listScrollStyle ? { style: listScrollStyle } : {})}
      />
      <ToolCallDetailsDialog
        entry={selectedToolDetailsEntry}
        open={selectedToolDetailsEntry !== null}
        onOpenChange={handleToolDetailsOpenChange}
      />
    </div>
  );
});
