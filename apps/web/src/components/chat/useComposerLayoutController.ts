// FILE: useComposerLayoutController.ts
// Purpose: Own composer width tiers, placeholder height, and stacked chrome measurement.
// Layer: Chat composer layout controller

import { type ThreadId } from "@agent-group/contracts";
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

import {
  resolveNextComposerFooterTier,
  shouldUseCompactComposerFooter,
} from "../composerFooterLayout";

interface UseComposerLayoutControllerOptions {
  activeThreadId: ThreadId | null;
  composerFormRef: RefObject<HTMLFormElement | null>;
  footerHasWideActions: boolean;
  inactive: boolean;
  isTranscriptAtEnd: () => boolean;
  scrollTranscriptToEnd: (animated?: boolean) => void;
}

export function useComposerLayoutController(options: UseComposerLayoutControllerOptions) {
  const {
    activeThreadId,
    composerFormRef,
    footerHasWideActions,
    inactive,
    isTranscriptAtEnd,
    scrollTranscriptToEnd,
  } = options;
  const [isFooterCompact, setIsFooterCompact] = useState(false);
  const [footerTier, setFooterTier] = useState(0);
  const [placeholderHeight, setPlaceholderHeight] = useState(88);
  const footerTierRef = useRef(0);
  const footerDemotionWidthsRef = useRef<ReadonlyArray<number | undefined>>([]);
  const footerLayoutSyncRef = useRef<(() => void) | null>(null);
  const formHeightRef = useRef(0);

  useLayoutEffect(() => {
    if (inactive) return;
    const composerForm = composerFormRef.current;
    if (!composerForm) return;

    const syncFooterLayout = () => {
      const nextCompact = shouldUseCompactComposerFooter(composerForm.clientWidth, {
        hasWideActions: footerHasWideActions,
      });
      setIsFooterCompact((previous) => (previous === nextCompact ? previous : nextCompact));

      const footerRow = composerForm.querySelector<HTMLElement>("[data-chat-composer-footer]");
      if (!footerRow) return;

      const rowOverflows = footerRow.scrollWidth > footerRow.clientWidth + 1;
      const leadingCluster = footerRow.querySelector<HTMLElement>("[data-chat-composer-leading]");
      const leadingClips =
        nextCompact &&
        leadingCluster !== null &&
        leadingCluster.scrollWidth > leadingCluster.clientWidth + 1;
      const nextStep = resolveNextComposerFooterTier({
        currentTier: footerTierRef.current,
        clientWidth: footerRow.clientWidth,
        isOverflowing: rowOverflows || leadingClips,
        demotionWidths: footerDemotionWidthsRef.current,
      });
      footerDemotionWidthsRef.current = nextStep.demotionWidths;
      if (nextStep.tier !== footerTierRef.current) {
        footerTierRef.current = nextStep.tier;
        setFooterTier(nextStep.tier);
      }
    };
    footerLayoutSyncRef.current = syncFooterLayout;

    const measuredHeight = Math.ceil(composerForm.getBoundingClientRect().height);
    formHeightRef.current = measuredHeight;
    if (measuredHeight > 0) {
      setPlaceholderHeight((current) => (current === measuredHeight ? current : measuredHeight));
    }
    syncFooterLayout();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const [entry] = entries;
      if (!entry) return;

      syncFooterLayout();
      const nextHeight = entry.contentRect.height;
      const previousHeight = formHeightRef.current;
      formHeightRef.current = nextHeight;
      const roundedNextHeight = Math.ceil(nextHeight);
      if (roundedNextHeight > 0) {
        setPlaceholderHeight((current) =>
          current === roundedNextHeight ? current : roundedNextHeight,
        );
      }
      if (previousHeight > 0 && Math.abs(nextHeight - previousHeight) < 0.5) return;
      if (!isTranscriptAtEnd()) return;
      window.requestAnimationFrame(() => scrollTranscriptToEnd(false));
    });

    observer.observe(composerForm);
    return () => {
      observer.disconnect();
      if (footerLayoutSyncRef.current === syncFooterLayout) {
        footerLayoutSyncRef.current = null;
      }
    };
  }, [
    activeThreadId,
    composerFormRef,
    footerHasWideActions,
    inactive,
    isTranscriptAtEnd,
    scrollTranscriptToEnd,
  ]);

  useLayoutEffect(() => {
    footerLayoutSyncRef.current?.();
  }, [footerTier]);

  const resetFooterLayout = useCallback(() => {
    footerDemotionWidthsRef.current = [];
    footerTierRef.current = 0;
    setFooterTier(0);
    footerLayoutSyncRef.current?.();
  }, []);

  return {
    footerTier,
    isFooterCompact,
    placeholderHeight,
    resetFooterLayout,
  };
}

export function useComposerStackedChromeMeasurement() {
  const [height, setHeight] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const measure = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) {
      setHeight(0);
      return;
    }

    const updateHeight = () => {
      setHeight(Math.ceil(element.getBoundingClientRect().height));
    };
    updateHeight();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  return { height, measure };
}
