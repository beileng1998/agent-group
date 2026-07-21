// FILE: useThreadReferenceController.ts
// Purpose: Own pinned content, notes, and transcript reference navigation.
// Layer: Web thread controller

import {
  MessageId,
  type PinnedMessage,
  type ThreadId,
  type ThreadMarker,
} from "@agent-group/contracts";
import { useCallback, useMemo, type MutableRefObject } from "react";
import { useNavigate } from "@tanstack/react-router";

import type { MessagesTimelineController } from "../components/chat/MessagesTimeline";
import { usePinnedMessageActions } from "../components/chat/environment/usePinnedMessageActions";
import { EMPTY_PINNED_TEXT } from "../components/chat/chatViewComposerValues";
import { toastManager } from "../components/ui/toast";
import { mergeProjectInstructionsIntoThreadNotes } from "../projectInstructionsStore";
import type { TimelineEntry } from "../session-logic";
import type { ChatAssistantSelectionAttachment, ChatMessage } from "../types";

type Navigate = ReturnType<typeof useNavigate>;

export function useThreadReferenceController(input: {
  activeThreadId: ThreadId | null;
  sourceThreadId: ThreadId | null;
  pinnedMessages: readonly PinnedMessage[];
  threadMarkers: readonly ThreadMarker[];
  threadNotes: string;
  projectInstructions: string;
  timelineMessages: readonly ChatMessage[];
  timelineEntries: readonly TimelineEntry[];
  timelineControllerRef: MutableRefObject<MessagesTimelineController | null>;
  navigate: Navigate;
  onOpenHighlights: (() => void) | undefined;
  isPendingSetupBubbleId: (messageId: MessageId) => boolean;
}) {
  const pinnedMessageIds = useMemo(
    () => new Set(input.pinnedMessages.map((pin) => pin.messageId)),
    [input.pinnedMessages],
  );
  const markerMessageIds = useMemo(
    () => new Set(input.threadMarkers.map((marker) => marker.messageId)),
    [input.threadMarkers],
  );
  const { markerMessageTextById, pinnedMessageTextById } = useMemo(() => {
    const needsPinnedText = pinnedMessageIds.size > 0;
    const needsMarkerText = markerMessageIds.size > 0;
    if (!needsPinnedText && !needsMarkerText) {
      return {
        pinnedMessageTextById: EMPTY_PINNED_TEXT,
        markerMessageTextById: EMPTY_PINNED_TEXT,
      };
    }
    const pinnedTextById = new Map<MessageId, string>();
    const markerTextById = new Map<MessageId, string>();
    for (const message of input.timelineMessages) {
      if (needsPinnedText && pinnedMessageIds.has(message.id)) {
        pinnedTextById.set(message.id, message.text);
      }
      if (needsMarkerText && markerMessageIds.has(message.id)) {
        markerTextById.set(message.id, message.text);
      }
    }
    return {
      pinnedMessageTextById: needsPinnedText ? pinnedTextById : EMPTY_PINNED_TEXT,
      markerMessageTextById: needsMarkerText ? markerTextById : EMPTY_PINNED_TEXT,
    };
  }, [input.timelineMessages, markerMessageIds, pinnedMessageIds]);

  const pinnedActions = usePinnedMessageActions({
    activeThreadId: input.activeThreadId,
    pinnedMessages: input.pinnedMessages,
  });
  const togglePinMessage = useCallback(
    (messageId: MessageId) => {
      if (!input.isPendingSetupBubbleId(messageId)) {
        const wasPinned = pinnedMessageIds.has(messageId);
        pinnedActions.handleTogglePinMessage(messageId);
        if (!wasPinned) input.onOpenHighlights?.();
      }
    },
    [
      input.isPendingSetupBubbleId,
      input.onOpenHighlights,
      pinnedActions.handleTogglePinMessage,
      pinnedMessageIds,
    ],
  );
  const copyProjectInstructionsToNotes = useCallback(() => {
    if (!input.activeThreadId) return;
    const nextNotes = mergeProjectInstructionsIntoThreadNotes({
      threadNotes: input.threadNotes,
      projectInstructions: input.projectInstructions,
    });
    if (nextNotes === input.threadNotes) return;
    void pinnedActions
      .handleNotesChange(input.activeThreadId, nextNotes)
      .then(() => {
        toastManager.add({ type: "success", title: "Project instructions added to notepad." });
      })
      .catch(() => {
        // The shared notes action already surfaces the save failure.
      });
  }, [input.activeThreadId, input.projectInstructions, input.threadNotes, pinnedActions]);
  const jumpToPinnedMessage = useCallback(
    (messageId: MessageId) => input.timelineControllerRef.current?.scrollToMessage(messageId),
    [input.timelineControllerRef],
  );
  const jumpToThreadMarker = useCallback(
    (marker: ThreadMarker) => input.timelineControllerRef.current?.scrollToMarker(marker),
    [input.timelineControllerRef],
  );
  const openAssistantSelection = useCallback(
    (selection: ChatAssistantSelectionAttachment) => {
      const messageId = MessageId.makeUnsafe(selection.assistantMessageId);
      const sourceIsInCurrentTranscript = input.timelineEntries.some(
        (entry) => entry.kind === "message" && entry.message.id === messageId,
      );
      if (sourceIsInCurrentTranscript) {
        input.timelineControllerRef.current?.scrollToMessage(messageId);
        return;
      }
      const sourceThreadId = input.sourceThreadId;
      if (!sourceThreadId) {
        toastManager.add({ type: "warning", title: "Selection source is unavailable." });
        return;
      }
      void input.navigate({
        to: "/$threadId",
        params: { threadId: sourceThreadId },
        search: (previous) => ({
          ...previous,
          messageThreadId: sourceThreadId,
          messageId,
        }),
      });
    },
    [input.navigate, input.sourceThreadId, input.timelineControllerRef, input.timelineEntries],
  );

  return {
    copyProjectInstructionsToNotes,
    jumpToPinnedMessage,
    jumpToThreadMarker,
    markerMessageTextById,
    openAssistantSelection,
    pinnedMessageIds,
    pinnedMessageTextById,
    togglePinMessage,
    togglePinnedMessageDone: pinnedActions.handleTogglePinnedMessageDone,
    unpinMessage: pinnedActions.handleUnpinMessage,
    renamePinnedMessage: pinnedActions.handleRenamePinnedMessage,
    changeNotes: pinnedActions.handleNotesChange,
  };
}
