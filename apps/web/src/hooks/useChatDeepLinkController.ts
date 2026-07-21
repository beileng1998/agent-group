// FILE: useChatDeepLinkController.ts
// Purpose: Resolve message and highlight deep links into transcript navigation.
// Layer: Web chat navigation controller

import { type MessageId, type ThreadId, type ThreadMarker } from "@agent-group/contracts";
import { useEffect, useRef, type MutableRefObject } from "react";
import { useNavigate } from "@tanstack/react-router";

import type { TimelineEntry } from "../session-logic";
import type { MessagesTimelineController } from "../components/chat/MessagesTimeline";
import { toastManager } from "../components/ui/toast";

type Navigate = ReturnType<typeof useNavigate>;

export function useChatDeepLinkController(input: {
  activeThreadId: ThreadId | null;
  routeThreadId: ThreadId;
  messageThreadId: ThreadId | null | undefined;
  messageId: MessageId | null | undefined;
  highlightId: string | null | undefined;
  timelineEntries: readonly TimelineEntry[];
  threadMarkers: readonly ThreadMarker[];
  timelineControllerRef: MutableRefObject<MessagesTimelineController | null>;
  navigate: Navigate;
}): void {
  const handledMessageLinkRef = useRef<string | null>(null);
  const handledHighlightLinkRef = useRef<string | null>(null);

  useEffect(() => {
    const { messageThreadId, messageId } = input;
    if (!messageThreadId || !messageId) {
      handledMessageLinkRef.current = null;
      return;
    }
    if (input.activeThreadId !== messageThreadId) return;
    const linkKey = `${messageThreadId}:${messageId}`;
    if (handledMessageLinkRef.current === linkKey) return;

    const consumeLink = () => {
      handledMessageLinkRef.current = linkKey;
      void input.navigate({
        to: "/$threadId",
        params: { threadId: messageThreadId },
        replace: true,
        search: (previous) => {
          const {
            messageThreadId: _messageThreadId,
            messageId: _messageId,
            ...rest
          } = previous as Record<string, unknown>;
          return rest;
        },
      });
    };
    const sourceIsAvailable = input.timelineEntries.some(
      (entry) => entry.kind === "message" && entry.message.id === messageId,
    );
    if (!sourceIsAvailable) {
      const unavailableTimeout = window.setTimeout(() => {
        toastManager.add({ type: "warning", title: "Selection source is unavailable." });
        consumeLink();
      }, 4_000);
      return () => window.clearTimeout(unavailableTimeout);
    }

    const deadline = performance.now() + 4_000;
    let retryFrame = 0;
    const attemptScroll = () => {
      const controller = input.timelineControllerRef.current;
      if (controller) {
        controller.scrollToMessage(messageId);
        consumeLink();
        return;
      }
      if (performance.now() >= deadline) {
        toastManager.add({ type: "warning", title: "Selection source is unavailable." });
        consumeLink();
        return;
      }
      retryFrame = window.requestAnimationFrame(attemptScroll);
    };
    retryFrame = window.requestAnimationFrame(attemptScroll);
    return () => window.cancelAnimationFrame(retryFrame);
  }, [
    input.activeThreadId,
    input.messageId,
    input.messageThreadId,
    input.navigate,
    input.timelineControllerRef,
    input.timelineEntries,
  ]);

  useEffect(() => {
    const { highlightId } = input;
    if (!highlightId) {
      handledHighlightLinkRef.current = null;
      return;
    }
    if (!input.activeThreadId) return;
    const linkKey = `${input.activeThreadId}:${highlightId}`;
    if (handledHighlightLinkRef.current === linkKey) return;
    const marker = input.threadMarkers.find((candidate) => candidate.id === highlightId);

    const consumeLink = () => {
      handledHighlightLinkRef.current = linkKey;
      void input.navigate({
        to: "/$threadId",
        params: { threadId: input.routeThreadId },
        replace: true,
        search: (previous) => {
          const { highlightId: _highlightId, ...rest } = previous as Record<string, unknown>;
          return rest;
        },
      });
    };
    const reportUnavailable = () => {
      toastManager.add({ type: "warning", title: "Highlight source is unavailable." });
      consumeLink();
    };
    if (!marker) {
      const unavailableTimeout = window.setTimeout(reportUnavailable, 4_000);
      return () => window.clearTimeout(unavailableTimeout);
    }

    const deadline = performance.now() + 4_000;
    let retryFrame = 0;
    const attemptScroll = () => {
      if (input.timelineControllerRef.current?.scrollToMarker(marker)) {
        consumeLink();
        return;
      }
      if (performance.now() >= deadline) {
        reportUnavailable();
        return;
      }
      retryFrame = window.requestAnimationFrame(attemptScroll);
    };
    retryFrame = window.requestAnimationFrame(attemptScroll);
    return () => window.cancelAnimationFrame(retryFrame);
  }, [
    input.activeThreadId,
    input.highlightId,
    input.navigate,
    input.routeThreadId,
    input.threadMarkers,
    input.timelineControllerRef,
  ]);
}
