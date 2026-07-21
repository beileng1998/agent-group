// FILE: useMessagesTimelineViewport.ts
// Purpose: Own transcript scrolling, marker jumps, tail expansion, and trail highlights.
// Layer: Web chat timeline controller

import type { MessageId, ThreadMarker } from "@agent-group/contracts";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import {
  resolveActiveTrailSnapshot,
  type ActiveTrailSnapshot,
  type MessageTrailAnchor,
} from "./messageTrail.logic";

const JUMP_HIGHLIGHT_DURATION_MS = 1200;
const MARKER_FINE_SCROLL_RETRY_TIMEOUT_MS = 4_000;
const MARKER_FINE_SCROLL_MAX_RETRY_FRAMES = 300;
export const TRAIL_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 0 } as const;
const ACTIVE_MARKER_CLASS_NAME = "thread-marker-active";

export interface MessagesTimelineController {
  scrollToMessage: (messageId: MessageId) => boolean;
  scrollToMarker: (marker: ThreadMarker) => boolean;
}

function cssAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getMonotonicTimeMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function collectThreadMarkerElements(
  root: ParentNode | null,
  marker: Pick<ThreadMarker, "id" | "messageId">,
): HTMLElement[] {
  if (!root) return [];
  const messageId = cssAttributeSelectorValue(marker.messageId);
  const markerId = cssAttributeSelectorValue(marker.id);
  const selector = `[data-assistant-message-id="${messageId}"] [data-thread-marker-id="${markerId}"]`;
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

function findVisibleThreadMarkerElement(elements: readonly HTMLElement[]): HTMLElement | null {
  return elements.find((element) => element.getClientRects().length > 0) ?? null;
}

export function useMessagesTimelineViewport(input: {
  rows: readonly MessagesTimelineRow[];
  listRef?: RefObject<LegendListRef | null> | undefined;
  controllerRef?: RefObject<MessagesTimelineController | null> | undefined;
  initialScrollOffsetPx?: number | undefined;
  onIsAtEndChange?: ((isAtEnd: boolean) => void) | undefined;
  onMessagesScroll?: ComponentProps<typeof LegendList>["onScroll"];
  onTrailHighlightsChange?: ((snapshot: ActiveTrailSnapshot) => void) | undefined;
}) {
  const fallbackListRef = useRef<LegendListRef | null>(null);
  const resolvedListRef = input.listRef ?? fallbackListRef;
  const timelineRootRef = useRef<HTMLDivElement | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<MessageId | null>(null);
  const rowsRef = useRef(input.rows);
  useEffect(() => {
    rowsRef.current = input.rows;
  }, [input.rows]);

  const jumpHighlightTimeoutRef = useRef<number | null>(null);
  const markerFineScrollFrameRef = useRef<number | null>(null);
  const decoratedMarkerElementsRef = useRef<HTMLElement[]>([]);
  const clearActiveMarkerDecoration = useCallback(() => {
    for (const element of decoratedMarkerElementsRef.current) {
      element.classList.remove(ACTIVE_MARKER_CLASS_NAME);
    }
    decoratedMarkerElementsRef.current = [];
  }, []);
  const applyActiveMarkerDecoration = useCallback(
    (elements: readonly HTMLElement[]) => {
      clearActiveMarkerDecoration();
      for (const element of elements) element.classList.add(ACTIVE_MARKER_CLASS_NAME);
      decoratedMarkerElementsRef.current = [...elements];
    },
    [clearActiveMarkerDecoration],
  );

  useEffect(
    () => () => {
      if (jumpHighlightTimeoutRef.current !== null) {
        window.clearTimeout(jumpHighlightTimeoutRef.current);
      }
      if (markerFineScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(markerFineScrollFrameRef.current);
      }
      clearActiveMarkerDecoration();
    },
    [clearActiveMarkerDecoration],
  );

  useEffect(() => {
    if (!input.controllerRef) return;
    const scrollToMessage = (messageId: MessageId) => {
      const index = rowsRef.current.findIndex(
        (row) => row.kind === "message" && row.message.id === messageId,
      );
      const list = resolvedListRef.current;
      if (index < 0 || !list) return false;
      void list.scrollToIndex({ index, animated: true, viewPosition: 0.2 });
      return true;
    };
    const clearJumpHighlightAfterDelay = () => {
      if (jumpHighlightTimeoutRef.current !== null) {
        window.clearTimeout(jumpHighlightTimeoutRef.current);
      }
      jumpHighlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedMessageId(null);
        clearActiveMarkerDecoration();
        jumpHighlightTimeoutRef.current = null;
      }, JUMP_HIGHLIGHT_DURATION_MS);
    };
    const cancelPendingMarkerFineScroll = () => {
      if (markerFineScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(markerFineScrollFrameRef.current);
        markerFineScrollFrameRef.current = null;
      }
    };
    const scheduleMarkerFineScroll = (marker: ThreadMarker) => {
      cancelPendingMarkerFineScroll();
      const deadlineMs = getMonotonicTimeMs() + MARKER_FINE_SCROLL_RETRY_TIMEOUT_MS;
      let attempts = 0;
      const tick = () => {
        markerFineScrollFrameRef.current = null;
        const elements = collectThreadMarkerElements(timelineRootRef.current, marker);
        const visibleElement = findVisibleThreadMarkerElement(elements);
        if (visibleElement) {
          applyActiveMarkerDecoration(elements);
          visibleElement.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
          clearJumpHighlightAfterDelay();
          return;
        }
        attempts += 1;
        if (getMonotonicTimeMs() <= deadlineMs && attempts < MARKER_FINE_SCROLL_MAX_RETRY_FRAMES) {
          markerFineScrollFrameRef.current = window.requestAnimationFrame(tick);
        }
      };
      markerFineScrollFrameRef.current = window.requestAnimationFrame(tick);
    };
    const controller: MessagesTimelineController = {
      scrollToMessage: (messageId) => {
        cancelPendingMarkerFineScroll();
        clearActiveMarkerDecoration();
        if (!scrollToMessage(messageId)) return false;
        setHighlightedMessageId(messageId);
        clearJumpHighlightAfterDelay();
        return true;
      },
      scrollToMarker: (marker) => {
        clearActiveMarkerDecoration();
        if (!scrollToMessage(marker.messageId)) return false;
        setHighlightedMessageId(marker.messageId);
        clearJumpHighlightAfterDelay();
        scheduleMarkerFineScroll(marker);
        return true;
      },
    };
    input.controllerRef.current = controller;
    return () => {
      if (input.controllerRef?.current === controller) input.controllerRef.current = null;
    };
  }, [
    input.controllerRef,
    resolvedListRef,
    applyActiveMarkerDecoration,
    clearActiveMarkerDecoration,
  ]);

  const tailContentRowId = useMemo(() => {
    for (let index = input.rows.length - 1; index >= 0; index -= 1) {
      const row = input.rows[index]!;
      if (row.kind !== "working" && row.kind !== "worktree-setup") return row.id;
    }
    return null;
  }, [input.rows]);
  const tailScrollFrameRef = useRef<number | null>(null);
  const tailScrollTimeoutsRef = useRef<number[]>([]);
  const clearTailExpansionScrollTimers = useCallback(() => {
    if (tailScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(tailScrollFrameRef.current);
      tailScrollFrameRef.current = null;
    }
    for (const timeoutId of tailScrollTimeoutsRef.current) window.clearTimeout(timeoutId);
    tailScrollTimeoutsRef.current = [];
  }, []);
  const scrollTailExpansionToEnd = useCallback(() => {
    clearTailExpansionScrollTimers();
    const scrollToEnd = () => void resolvedListRef.current?.scrollToEnd?.({ animated: false });
    tailScrollFrameRef.current = window.requestAnimationFrame(() => {
      tailScrollFrameRef.current = null;
      scrollToEnd();
    });
    for (const delay of [80, 180, 260]) {
      const timeoutId = window.setTimeout(scrollToEnd, delay);
      tailScrollTimeoutsRef.current.push(timeoutId);
    }
  }, [clearTailExpansionScrollTimers, resolvedListRef]);
  useEffect(() => clearTailExpansionScrollTimers, [clearTailExpansionScrollTimers]);

  const previousRowCountRef = useRef(input.rows.length);
  useEffect(() => {
    const previousRowCount = previousRowCountRef.current;
    previousRowCountRef.current = input.rows.length;
    if (
      previousRowCount > 0 ||
      input.rows.length === 0 ||
      input.initialScrollOffsetPx !== undefined
    ) {
      return;
    }
    input.onIsAtEndChange?.(true);
    const frameId = window.requestAnimationFrame(() => {
      void resolvedListRef.current?.scrollToEnd?.({ animated: false });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [input.initialScrollOffsetPx, input.onIsAtEndChange, input.rows.length, resolvedListRef]);

  const userMessageAnchors = useMemo<MessageTrailAnchor[]>(() => {
    const anchors: MessageTrailAnchor[] = [];
    input.rows.forEach((row, index) => {
      if (row.kind === "message" && row.message.role === "user") {
        anchors.push({ id: row.message.id, rowIndex: index });
      }
    });
    return anchors;
  }, [input.rows]);
  const userMessageAnchorsRef = useRef(userMessageAnchors);
  userMessageAnchorsRef.current = userMessageAnchors;
  const emitTrailHighlightsForViewport = useCallback(
    (topRowIndex: number, bottomRowIndex: number) => {
      if (!input.onTrailHighlightsChange || !Number.isFinite(topRowIndex)) return;
      input.onTrailHighlightsChange(
        resolveActiveTrailSnapshot(userMessageAnchorsRef.current, topRowIndex, bottomRowIndex),
      );
    },
    [input.onTrailHighlightsChange],
  );
  const handleListScroll = useCallback<NonNullable<ComponentProps<typeof LegendList>["onScroll"]>>(
    (event) => {
      input.onMessagesScroll?.(event);
      const state = resolvedListRef.current?.getState?.();
      if (state) {
        input.onIsAtEndChange?.(state.isAtEnd);
        emitTrailHighlightsForViewport(state.start, state.end);
      }
    },
    [
      emitTrailHighlightsForViewport,
      input.onIsAtEndChange,
      input.onMessagesScroll,
      resolvedListRef,
    ],
  );
  const handleViewableItemsChanged = useCallback<
    NonNullable<ComponentProps<typeof LegendList>["onViewableItemsChanged"]>
  >(
    ({ viewableItems }) => {
      let topIndex = Number.POSITIVE_INFINITY;
      let bottomIndex = Number.NEGATIVE_INFINITY;
      for (const token of viewableItems) {
        if (token.isViewable) {
          topIndex = Math.min(topIndex, token.index);
          bottomIndex = Math.max(bottomIndex, token.index);
        }
      }
      emitTrailHighlightsForViewport(topIndex, bottomIndex);
    },
    [emitTrailHighlightsForViewport],
  );
  useEffect(() => {
    if (!input.onTrailHighlightsChange) return;
    const frameId = window.requestAnimationFrame(() => {
      const state = resolvedListRef.current?.getState?.();
      if (state) emitTrailHighlightsForViewport(state.start, state.end);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [
    emitTrailHighlightsForViewport,
    input.onTrailHighlightsChange,
    resolvedListRef,
    input.rows.length,
  ]);

  return {
    handleListScroll,
    handleViewableItemsChanged,
    highlightedMessageId,
    resolvedListRef,
    scrollTailExpansionToEnd,
    tailContentRowId,
    timelineRootRef,
  };
}
