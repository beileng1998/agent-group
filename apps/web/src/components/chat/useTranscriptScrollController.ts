// FILE: useTranscriptScrollController.ts
// Purpose: Own transcript scroll-follow, position persistence, and interaction anchoring.
// Layer: Chat transcript controller

import { type ThreadId } from "@agent-group/contracts";
import { type LegendListRef } from "@legendapp/list/react";
import { Debouncer } from "@tanstack/react-pacer";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEventHandler,
  type PointerEventHandler,
  type TouchEventHandler,
  type WheelEventHandler,
} from "react";

import { isScrollContainerNearBottom } from "../../chat-scroll";
import { DISCLOSURE_TRANSITION_MS } from "../../lib/disclosureMotion";
import type { TimelineEntry } from "../../session-logic";
import {
  readThreadScrollOffset,
  rememberThreadScrollPosition,
} from "../../threadScrollPositionStore";
import { ACTIVE_TURN_LAYOUT_SETTLE_DELAY_MS } from "../ChatView.dispatch";
import { TRANSCRIPT_DISCLOSURE_CLEANUP_BUFFER_MS } from "./MessagesTimeline.motion";

const PROGRAMMATIC_SCROLL_GUARD_MS = 200;
const SCROLL_STATE_DEBOUNCE_MS = 150;
export const TRANSCRIPT_AUTO_FOLLOW_SETTLE_DELAY_MS =
  ACTIVE_TURN_LAYOUT_SETTLE_DELAY_MS +
  DISCLOSURE_TRANSITION_MS +
  TRANSCRIPT_DISCLOSURE_CLEANUP_BUFFER_MS;

interface UseTranscriptScrollControllerOptions {
  threadId: ThreadId;
  activeThreadId: ThreadId | null;
  composerStackedChromeHeight: number;
  timelineEntries: readonly TimelineEntry[];
}

export function useTranscriptScrollController(options: UseTranscriptScrollControllerOptions) {
  const { threadId, activeThreadId, composerStackedChromeHeight, timelineEntries } = options;
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const legendListRef = useRef<LegendListRef | null>(null);
  const isAtEndRef = useRef(true);
  const autoFollowThreadIdRef = useRef<ThreadId | null>(null);
  const programmaticScrollUntilRef = useRef(0);
  const animateNextAutoFollowScrollRef = useRef(false);
  const previousComposerStackedChromeHeightRef = useRef(0);
  const pendingInteractionAnchorRef = useRef<{
    element: HTMLElement;
    top: number;
  } | null>(null);
  const pendingInteractionAnchorFrameRef = useRef<number | null>(null);
  const showScrollDebouncer = useRef(
    new Debouncer(() => setShowScrollToBottom(true), {
      wait: SCROLL_STATE_DEBOUNCE_MS,
    }),
  );
  const persistScrollPositionDebouncer = useRef(
    new Debouncer(
      (targetThreadId: ThreadId, offsetPx: number | null) => {
        rememberThreadScrollPosition(targetThreadId, offsetPx);
      },
      { wait: SCROLL_STATE_DEBOUNCE_MS },
    ),
  );
  const initialScrollOffsetPx = useMemo(() => readThreadScrollOffset(threadId), [threadId]);
  const rememberedScrollPositionRef = useRef<{
    threadId: ThreadId;
    offsetPx: number | null;
  }>({
    threadId,
    offsetPx: initialScrollOffsetPx,
  });

  useEffect(() => {
    const scrollDebouncer = showScrollDebouncer.current;
    return () => {
      scrollDebouncer.cancel();
      const pendingFrame = pendingInteractionAnchorFrameRef.current;
      if (pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame);
      }
    };
  }, []);

  useEffect(() => {
    const scrollPositionDebouncer = persistScrollPositionDebouncer.current;
    return () => {
      scrollPositionDebouncer.flush();
    };
  }, [threadId]);

  const scrollToEnd = useCallback((animated = false) => {
    programmaticScrollUntilRef.current = performance.now() + PROGRAMMATIC_SCROLL_GUARD_MS;
    legendListRef.current?.scrollToEnd?.({ animated });
  }, []);

  const isAtEnd = useCallback(() => isAtEndRef.current, []);

  const armTranscriptAutoFollow = useCallback((targetThreadId: ThreadId, animated = false) => {
    autoFollowThreadIdRef.current = targetThreadId;
    animateNextAutoFollowScrollRef.current = animated;
    isAtEndRef.current = true;
    rememberedScrollPositionRef.current = { threadId: targetThreadId, offsetPx: null };
    persistScrollPositionDebouncer.current.cancel();
    rememberThreadScrollPosition(targetThreadId, null);
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
  }, []);

  const clearTranscriptAutoFollow = useCallback(() => {
    autoFollowThreadIdRef.current = null;
    animateNextAutoFollowScrollRef.current = false;
    programmaticScrollUntilRef.current = 0;
  }, []);

  useLayoutEffect(() => {
    const shouldRestoreScrollPosition = initialScrollOffsetPx !== null;
    rememberedScrollPositionRef.current = { threadId, offsetPx: initialScrollOffsetPx };
    isAtEndRef.current = !shouldRestoreScrollPosition;
    if (shouldRestoreScrollPosition) {
      programmaticScrollUntilRef.current = performance.now() + PROGRAMMATIC_SCROLL_GUARD_MS;
    }
  }, [initialScrollOffsetPx, threadId]);

  useEffect(() => {
    const shouldRestoreScrollPosition = initialScrollOffsetPx !== null;
    isAtEndRef.current = !shouldRestoreScrollPosition;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(shouldRestoreScrollPosition);
  }, [activeThreadId, initialScrollOffsetPx]);

  useLayoutEffect(() => {
    const previousHeight = previousComposerStackedChromeHeightRef.current;
    previousComposerStackedChromeHeightRef.current = composerStackedChromeHeight;

    if (previousHeight <= 0 || composerStackedChromeHeight <= 0) {
      return;
    }

    const delta = composerStackedChromeHeight - previousHeight;
    if (delta <= 0.5 || !isAtEndRef.current) {
      return;
    }

    const scrollContainer = legendListRef.current?.getScrollableNode?.();
    if (!(scrollContainer instanceof HTMLElement)) {
      return;
    }

    programmaticScrollUntilRef.current = performance.now() + PROGRAMMATIC_SCROLL_GUARD_MS;
    scrollContainer.scrollTop += delta;
  }, [composerStackedChromeHeight]);

  // Work/tool rows deliberately do not participate in the live-follow signal.
  const { transcriptMessageCount, transcriptTailKey } = useMemo(() => {
    let messageCount = 0;
    let latestMessage: Extract<TimelineEntry, { kind: "message" }>["message"] | null = null;
    for (const entry of timelineEntries) {
      if (entry.kind !== "message") {
        continue;
      }
      messageCount += 1;
      latestMessage = entry.message;
    }

    return {
      transcriptMessageCount: messageCount,
      transcriptTailKey: latestMessage
        ? [
            latestMessage.id,
            latestMessage.role,
            latestMessage.streaming ? "streaming" : "settled",
            latestMessage.text.length > 0 ? "content" : "empty",
            latestMessage.completedAt ?? "",
          ].join(":")
        : "empty",
    };
  }, [timelineEntries]);

  useLayoutEffect(() => {
    const shouldFollowPendingTurn =
      activeThreadId !== null && autoFollowThreadIdRef.current === activeThreadId;
    if (!isAtEndRef.current && !shouldFollowPendingTurn) {
      return;
    }

    let settleTimeoutId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      const shouldAnimate = animateNextAutoFollowScrollRef.current;
      animateNextAutoFollowScrollRef.current = false;
      scrollToEnd(shouldAnimate);
      if (shouldFollowPendingTurn) {
        // A just-settled turn can keep its expanded layout briefly, then close through
        // the shared disclosure animation after the optimistic user row has landed.
        // Re-stick once that known presentation window finishes instead of coupling
        // virtualizer item measurement callbacks to bottom-follow state.
        settleTimeoutId = window.setTimeout(() => {
          if (autoFollowThreadIdRef.current !== activeThreadId) return;
          scrollToEnd(false);
        }, TRANSCRIPT_AUTO_FOLLOW_SETTLE_DELAY_MS);
      }
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      if (settleTimeoutId !== null) window.clearTimeout(settleTimeoutId);
    };
  }, [activeThreadId, scrollToEnd, transcriptMessageCount, transcriptTailKey]);

  const onIsAtEndChange = useCallback((nextIsAtEnd: boolean) => {
    if (isAtEndRef.current === nextIsAtEnd) return;
    if (!nextIsAtEnd && performance.now() < programmaticScrollUntilRef.current) return;
    isAtEndRef.current = nextIsAtEnd;
    if (nextIsAtEnd) {
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      return;
    }
    showScrollDebouncer.current.maybeExecute();
  }, []);

  const cancelPendingInteractionAnchorAdjustment = useCallback(() => {
    const pendingFrame = pendingInteractionAnchorFrameRef.current;
    if (pendingFrame === null) return;
    pendingInteractionAnchorFrameRef.current = null;
    window.cancelAnimationFrame(pendingFrame);
  }, []);

  const onMessagesClickCaptureBase = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      const scrollContainer = legendListRef.current?.getScrollableNode?.();
      if (!(scrollContainer instanceof HTMLElement) || !(event.target instanceof Element)) return;

      const trigger = event.target.closest<HTMLElement>(
        "button, summary, [role='button'], [data-scroll-anchor-target]",
      );
      if (!trigger || !scrollContainer.contains(trigger)) return;
      if (trigger.closest("[data-scroll-anchor-ignore]")) return;

      pendingInteractionAnchorRef.current = {
        element: trigger,
        top: trigger.getBoundingClientRect().top,
      };

      cancelPendingInteractionAnchorAdjustment();
      pendingInteractionAnchorFrameRef.current = window.requestAnimationFrame(() => {
        pendingInteractionAnchorFrameRef.current = null;
        const anchor = pendingInteractionAnchorRef.current;
        pendingInteractionAnchorRef.current = null;
        const activeScrollContainer = legendListRef.current?.getScrollableNode?.();
        if (!(activeScrollContainer instanceof HTMLElement) || !anchor) return;
        if (!anchor.element.isConnected || !activeScrollContainer.contains(anchor.element)) return;

        const nextTop = anchor.element.getBoundingClientRect().top;
        const delta = nextTop - anchor.top;
        if (Math.abs(delta) < 0.5) return;
        activeScrollContainer.scrollTop += delta;
      });
    },
    [cancelPendingInteractionAnchorAdjustment],
  );

  const onMessagesPointerCancelBase = useCallback<PointerEventHandler<HTMLDivElement>>(() => {
    clearTranscriptAutoFollow();
  }, [clearTranscriptAutoFollow]);
  const onMessagesPointerDownBase = useCallback<PointerEventHandler<HTMLDivElement>>(() => {
    clearTranscriptAutoFollow();
  }, [clearTranscriptAutoFollow]);
  const onMessagesPointerUpBase = useCallback<PointerEventHandler<HTMLDivElement>>(() => {}, []);
  const onMessagesScrollBase = useCallback(() => {
    if (performance.now() < programmaticScrollUntilRef.current) return;
    const scrollContainer = legendListRef.current?.getScrollableNode?.();
    if (!(scrollContainer instanceof HTMLElement)) return;

    const offsetPx = isScrollContainerNearBottom(scrollContainer)
      ? null
      : Math.max(0, Math.round(scrollContainer.scrollTop));
    rememberedScrollPositionRef.current = { threadId, offsetPx };
    persistScrollPositionDebouncer.current.maybeExecute(threadId, offsetPx);
  }, [threadId]);
  const onMessagesTouchEndBase = useCallback<TouchEventHandler<HTMLDivElement>>(() => {}, []);
  const onMessagesTouchMoveBase = useCallback<TouchEventHandler<HTMLDivElement>>(() => {
    clearTranscriptAutoFollow();
  }, [clearTranscriptAutoFollow]);
  const onMessagesTouchStartBase = useCallback<TouchEventHandler<HTMLDivElement>>(() => {
    clearTranscriptAutoFollow();
  }, [clearTranscriptAutoFollow]);
  const onMessagesWheelBase = useCallback<WheelEventHandler<HTMLDivElement>>(() => {
    clearTranscriptAutoFollow();
  }, [clearTranscriptAutoFollow]);

  const onScrollToBottom = useCallback(() => {
    isAtEndRef.current = true;
    rememberedScrollPositionRef.current = { threadId, offsetPx: null };
    persistScrollPositionDebouncer.current.cancel();
    rememberThreadScrollPosition(threadId, null);
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    scrollToEnd(true);
  }, [scrollToEnd, threadId]);

  return {
    legendListRef,
    initialScrollOffsetPx,
    showScrollToBottom,
    isAtEnd,
    scrollToEnd,
    armTranscriptAutoFollow,
    onIsAtEndChange,
    onMessagesClickCaptureBase,
    onMessagesPointerCancelBase,
    onMessagesPointerDownBase,
    onMessagesPointerUpBase,
    onMessagesScrollBase,
    onMessagesTouchEndBase,
    onMessagesTouchMoveBase,
    onMessagesTouchStartBase,
    onMessagesWheelBase,
    onScrollToBottom,
  };
}
