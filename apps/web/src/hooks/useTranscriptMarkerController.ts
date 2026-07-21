// FILE: useTranscriptMarkerController.ts
// Purpose: Own transcript highlight creation, editing, and removal interactions.
// Layer: Web transcript controller

import {
  MessageId,
  ThreadMarkerId,
  type ThreadId,
  type ThreadMarker,
  type ThreadMarkerColor,
  type ThreadMarkerStyle,
} from "@agent-group/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, type MouseEventHandler } from "react";

import type { PendingTranscriptSelectionAction } from "../components/chat/useTranscriptAssistantSelectionAction";
import { resolveTranscriptMarkerRange } from "../components/chat/chatSelectionActions";
import { toastManager } from "../components/ui/toast";
import type { ChatMessage } from "../types";
import {
  dispatchThreadMarkerAdd,
  dispatchThreadMarkerColorSet,
  dispatchThreadMarkerNoteSet,
  dispatchThreadMarkerRemove,
} from "../threadMarkers";

export function useTranscriptMarkerController(input: {
  activeThreadId: ThreadId | null;
  defaultColor: ThreadMarkerColor;
  pendingSelection: PendingTranscriptSelectionAction | null;
  threadMarkers: readonly ThreadMarker[];
  timelineMessages: readonly ChatMessage[];
  dismissSelection: () => void;
  isPendingSetupBubbleId: (messageId: MessageId) => boolean;
  onMessagesClickCapture: MouseEventHandler<HTMLDivElement>;
}) {
  const queryClient = useQueryClient();
  const [editingMarker, setEditingMarker] = useState<{
    markerId: ThreadMarkerId;
    anchorRect: DOMRect;
  } | null>(null);
  const editingMarkerRecord = editingMarker
    ? (input.threadMarkers.find((marker) => marker.id === editingMarker.markerId) ?? null)
    : null;
  const invalidateHighlights = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ["highlights"] }),
    [queryClient],
  );

  const removeMarker = useCallback(
    (markerId: ThreadMarkerId) => {
      if (!input.activeThreadId) return;
      void dispatchThreadMarkerRemove(input.activeThreadId, markerId)
        .then(invalidateHighlights)
        .catch((error) => {
          console.error("Failed to remove thread marker", error);
          toastManager.add({ type: "error", title: "Could not remove marker." });
        });
    },
    [input.activeThreadId, invalidateHighlights],
  );

  const createMarkerFromPendingSelection = useCallback(
    (style: ThreadMarkerStyle, color: ThreadMarkerColor) => {
      const pendingSelection = input.pendingSelection;
      if (!pendingSelection || !input.activeThreadId) return;
      const messageId = MessageId.makeUnsafe(pendingSelection.selection.assistantMessageId);
      if (input.isPendingSetupBubbleId(messageId)) {
        input.dismissSelection();
        window.getSelection()?.removeAllRanges();
        return;
      }
      const message = input.timelineMessages.find((candidate) => candidate.id === messageId);
      if (!message) {
        toastManager.add({ type: "warning", title: "Could not find the selected message." });
        return;
      }
      const range = resolveTranscriptMarkerRange({
        messageText: message.text,
        selectedText: pendingSelection.selection.text,
        ...(pendingSelection.selection.sourceRange
          ? { sourceRange: pendingSelection.selection.sourceRange }
          : {}),
      });
      if (!range) {
        toastManager.add({
          type: "warning",
          title: "Select a unique phrase to mark it.",
          description: "Try including a few more words so Agent Group can find the exact place.",
        });
        return;
      }
      input.dismissSelection();
      window.getSelection()?.removeAllRanges();
      const overlaps = input.threadMarkers.some(
        (marker) =>
          marker.messageId === messageId &&
          marker.startOffset < range.endOffset &&
          range.startOffset < marker.endOffset,
      );
      if (overlaps) {
        toastManager.add({
          type: "warning",
          title: "Highlights cannot overlap.",
          description: "Edit or remove the existing highlight first.",
        });
        return;
      }
      void dispatchThreadMarkerAdd({
        threadId: input.activeThreadId,
        markerId: ThreadMarkerId.makeUnsafe(crypto.randomUUID()),
        messageId,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        selectedText: message.text.slice(range.startOffset, range.endOffset),
        style,
        color,
      })
        .then(invalidateHighlights)
        .catch((error) => {
          console.error("Failed to create thread marker", error);
          toastManager.add({ type: "error", title: "Could not create marker." });
        });
    },
    [input, invalidateHighlights],
  );

  const createHighlight = useCallback(
    () => createMarkerFromPendingSelection("highlight", input.defaultColor),
    [createMarkerFromPendingSelection, input.defaultColor],
  );
  const changeMarkerColor = useCallback(
    (markerId: ThreadMarkerId, color: ThreadMarkerColor) => {
      if (!input.activeThreadId) return;
      void dispatchThreadMarkerColorSet(input.activeThreadId, markerId, color)
        .then(invalidateHighlights)
        .catch((error) => {
          console.error("Failed to change thread marker color", error);
          toastManager.add({ type: "error", title: "Could not change marker color." });
        });
    },
    [input.activeThreadId, invalidateHighlights],
  );
  const changeMarkerNote = useCallback(
    (markerId: ThreadMarkerId, note: string | null) => {
      if (!input.activeThreadId) return;
      void dispatchThreadMarkerNoteSet(input.activeThreadId, markerId, note)
        .then(invalidateHighlights)
        .catch((error) => {
          console.error("Failed to change highlight note", error);
          toastManager.add({ type: "error", title: "Could not save highlight note." });
        });
    },
    [input.activeThreadId, invalidateHighlights],
  );
  const onMessagesClickCaptureWithMarkerEdit = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      if (event.target instanceof Element) {
        const markerElement = event.target.closest("[data-thread-marker-id]");
        if (markerElement instanceof HTMLElement) {
          const markerId = markerElement.getAttribute("data-thread-marker-id");
          if (markerId) {
            input.dismissSelection();
            setEditingMarker({
              markerId: markerId as ThreadMarkerId,
              anchorRect: markerElement.getBoundingClientRect(),
            });
            return;
          }
        }
      }
      input.onMessagesClickCapture(event);
    },
    [input.dismissSelection, input.onMessagesClickCapture],
  );

  return {
    changeMarkerColor,
    changeMarkerNote,
    closeEditingMarker: () => setEditingMarker(null),
    createHighlight,
    editingMarker,
    editingMarkerRecord,
    onMessagesClickCaptureWithMarkerEdit,
    removeMarker,
  };
}
