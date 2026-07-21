import {
  useCallback,
  useEffect,
  useRef,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampTooltipTop,
  computeFocusedIndex,
  computeGaussianWeights,
  computeRestStyles,
  computeSigma,
  computeTickStyles,
  type MessageTrailItem,
  type TickStyle,
  type TrailGeometry,
} from "../messageTrail.logic";
import {
  TICK_ANCHOR_OPACITY,
  TICK_BASE_W,
  TICK_FOCUS_OPACITY,
  TICK_MAX_W,
  TICK_REST_OPACITY,
  TICK_SAVED_OPACITY,
  TICK_VISIBLE_OPACITY,
  TOOLTIP_ESTIMATED_H_PX,
  getMessageTrailTickHeight,
} from "./messageTrailViewValues";

interface UseMessageTrailInteractionInput {
  items: readonly MessageTrailItem[];
  anchorIndex: number;
  visibleIndexes: readonly number[];
  visible: boolean;
  geometry: TrailGeometry | null;
  onSelect: (item: MessageTrailItem) => void;
}

function getTooltipEyebrow(item: MessageTrailItem): string {
  if (item.kind === "pin") {
    return "Pinned message";
  }
  if (item.kind === "highlight") {
    return `Highlight · ${item.marker.color}`;
  }
  return "";
}

export function useMessageTrailInteraction({
  items,
  anchorIndex,
  visibleIndexes,
  visible,
  geometry,
  onSelect,
}: UseMessageTrailInteractionInput) {
  const rootRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipEyebrowRef = useRef<HTMLDivElement | null>(null);
  const tooltipMessageRef = useRef<HTMLDivElement | null>(null);
  const tooltipResponseRef = useRef<HTMLDivElement | null>(null);
  const tickRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const latestPointerClientYRef = useRef<number | null>(null);
  const focusOverrideIndexRef = useRef<number | null>(null);
  const geometryRef = useRef<TrailGeometry | null>(geometry);
  geometryRef.current = geometry;
  const viewportTopRef = useRef(0);
  const tooltipIndexRef = useRef(-1);
  const reducedMotionRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const anchorIndexRef = useRef(anchorIndex);
  anchorIndexRef.current = anchorIndex;
  const visibleIndexesRef = useRef(visibleIndexes);
  visibleIndexesRef.current = visibleIndexes;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  if (tickRefs.current.length !== items.length) {
    tickRefs.current = Array.from<HTMLButtonElement | null>({ length: items.length }).fill(null);
  }

  const writeStyles = useCallback((styles: readonly TickStyle[]) => {
    const refs = tickRefs.current;
    for (let i = 0; i < styles.length; i += 1) {
      const el = refs[i];
      if (!el) {
        continue;
      }
      el.style.width = `${styles[i]!.width}px`;
      el.style.opacity = `${styles[i]!.opacity}`;
    }
  }, []);

  const hideTooltip = useCallback(() => {
    tooltipIndexRef.current = -1;
    const tip = tooltipRef.current;
    if (tip) {
      tip.style.visibility = "hidden";
    }
  }, []);

  const showTooltip = useCallback((index: number, trailGeometry: TrailGeometry) => {
    const tip = tooltipRef.current;
    const item = itemsRef.current[index];
    if (!tip || !item) {
      return;
    }
    if (tooltipIndexRef.current !== index) {
      tooltipIndexRef.current = index;
      const eyebrowEl = tooltipEyebrowRef.current;
      const messageEl = tooltipMessageRef.current;
      const responseEl = tooltipResponseRef.current;
      if (eyebrowEl) {
        const eyebrow = getTooltipEyebrow(item);
        eyebrowEl.textContent = eyebrow;
        eyebrowEl.style.display = eyebrow ? "" : "none";
      }
      if (messageEl) {
        messageEl.textContent = item.preview;
      }
      if (responseEl) {
        responseEl.textContent = item.responsePreview;
        responseEl.style.display = item.responsePreview ? "" : "none";
      }
    }
    const viewport = viewportRef.current;
    const viewportHeight = viewport?.clientHeight ?? 0;
    const tooltipHeight = tip.offsetHeight || TOOLTIP_ESTIMATED_H_PX;
    const centerY = trailGeometry.centerYs[index] ?? viewportHeight / 2;
    const visibleY = centerY - (viewport?.scrollTop ?? 0);
    const offsetTop = viewport?.offsetTop ?? 0;
    tip.style.top = `${offsetTop + clampTooltipTop(visibleY, tooltipHeight, viewportHeight)}px`;
    tip.style.visibility = "visible";
  }, []);

  const applyVisualFloors = useCallback((styles: TickStyle[]) => {
    itemsRef.current.forEach((item, index) => {
      const style = styles[index];
      if (item.kind !== "turn" && style) {
        style.opacity = Math.max(style.opacity, TICK_SAVED_OPACITY);
      }
    });
    const anchorIndexValue = anchorIndexRef.current;
    for (const index of visibleIndexesRef.current) {
      const style = styles[index];
      if (style) {
        style.opacity = Math.max(style.opacity, TICK_VISIBLE_OPACITY);
      }
    }
    const anchorStyle = anchorIndexValue >= 0 ? styles[anchorIndexValue] : undefined;
    if (anchorStyle) {
      anchorStyle.opacity = Math.max(anchorStyle.opacity, TICK_ANCHOR_OPACITY);
    }
  }, []);

  const applyRest = useCallback(() => {
    const styles = computeRestStyles(
      itemsRef.current.length,
      anchorIndexRef.current,
      TICK_BASE_W,
      TICK_REST_OPACITY,
      TICK_ANCHOR_OPACITY,
    );
    applyVisualFloors(styles);
    writeStyles(styles);
    hideTooltip();
  }, [applyVisualFloors, hideTooltip, writeStyles]);

  const layoutTicks = useCallback(() => {
    const geometryValue = geometryRef.current;
    if (!geometryValue) {
      return;
    }
    const refs = tickRefs.current;
    for (let i = 0; i < refs.length; i += 1) {
      const el = refs[i];
      if (!el) {
        continue;
      }
      const centerY = geometryValue.centerYs[i] ?? 0;
      const tickHeight = getMessageTrailTickHeight(itemsRef.current[i]?.kind ?? "turn");
      el.style.top = `${centerY - tickHeight / 2}px`;
    }
    if (latestPointerClientYRef.current === null && focusOverrideIndexRef.current === null) {
      applyRest();
    }
  }, [applyRest]);

  const renderFrame = useCallback(() => {
    rafIdRef.current = null;
    const currentGeometry = geometryRef.current;
    if (!currentGeometry || !visibleRef.current) {
      return;
    }
    const count = itemsRef.current.length;
    if (count === 0) {
      return;
    }
    let activeY: number | null = null;
    const rawPointerY = latestPointerClientYRef.current;
    if (rawPointerY !== null) {
      activeY = rawPointerY + (viewportRef.current?.scrollTop ?? 0);
    } else if (focusOverrideIndexRef.current !== null) {
      activeY = currentGeometry.centerYs[focusOverrideIndexRef.current] ?? null;
    }
    if (activeY === null) {
      applyRest();
      return;
    }
    const anchor = anchorIndexRef.current;
    const focusedIndex = computeFocusedIndex(activeY, currentGeometry);
    let styles: TickStyle[];
    if (currentGeometry.spacing === 0 || reducedMotionRef.current) {
      styles = computeRestStyles(
        count,
        anchor,
        TICK_BASE_W,
        TICK_REST_OPACITY,
        TICK_ANCHOR_OPACITY,
      );
      const focusedStyle = styles[focusedIndex];
      if (focusedStyle) {
        focusedStyle.width = TICK_MAX_W;
      }
    } else {
      const sigma = computeSigma(currentGeometry.spacing);
      const weights = computeGaussianWeights(currentGeometry.centerYs, activeY, sigma);
      styles = computeTickStyles(
        weights,
        anchor,
        TICK_BASE_W,
        TICK_MAX_W,
        TICK_REST_OPACITY,
        TICK_ANCHOR_OPACITY,
      );
    }
    applyVisualFloors(styles);
    const focusedStyle = styles[focusedIndex];
    if (focusedStyle) {
      focusedStyle.opacity = TICK_FOCUS_OPACITY;
    }
    writeStyles(styles);
    showTooltip(focusedIndex, currentGeometry);
  }, [applyVisualFloors, applyRest, showTooltip, writeStyles]);

  const scheduleFrame = useCallback(() => {
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(renderFrame);
    }
  }, [renderFrame]);

  const cancelFrame = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    layoutTicks();
  }, [geometry, layoutTicks]);

  useEffect(() => {
    if (latestPointerClientYRef.current === null && focusOverrideIndexRef.current === null) {
      applyRest();
    }
  }, [anchorIndex, applyRest, visibleIndexes]);

  useEffect(() => {
    reducedMotionRef.current =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
  }, []);

  useEffect(() => {
    if (!visible) {
      cancelFrame();
      latestPointerClientYRef.current = null;
      focusOverrideIndexRef.current = null;
      hideTooltip();
    }
  }, [visible, cancelFrame, hideTooltip]);

  useEffect(() => cancelFrame, [cancelFrame]);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch" || !visibleRef.current) {
        return;
      }
      latestPointerClientYRef.current = event.clientY - viewportTopRef.current;
      scheduleFrame();
    },
    [scheduleFrame],
  );

  const handlePointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch" || !visibleRef.current) {
        return;
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        viewportTopRef.current = rect.top;
      }
      latestPointerClientYRef.current = event.clientY - viewportTopRef.current;
      scheduleFrame();
    },
    [scheduleFrame],
  );

  const handlePointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch") {
        return;
      }
      latestPointerClientYRef.current = null;
      cancelFrame();
      if (focusOverrideIndexRef.current !== null) {
        scheduleFrame();
      } else {
        applyRest();
      }
    },
    [applyRest, cancelFrame, scheduleFrame],
  );

  const handleScroll = useCallback(() => {
    if (latestPointerClientYRef.current !== null || focusOverrideIndexRef.current !== null) {
      scheduleFrame();
    }
  }, [scheduleFrame]);

  const selectIndex = useCallback((index: number) => {
    const item = itemsRef.current[index];
    if (item) {
      onSelectRef.current(item);
    }
  }, []);

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const geometryValue = geometryRef.current;
      const viewport = viewportRef.current;
      if (!geometryValue || !viewport) {
        return;
      }
      const contentY = event.clientY - viewport.getBoundingClientRect().top + viewport.scrollTop;
      selectIndex(computeFocusedIndex(contentY, geometryValue));
    },
    [selectIndex],
  );

  const handleTickFocus = useCallback(
    (index: number) => {
      focusOverrideIndexRef.current = index;
      const currentGeometry = geometryRef.current;
      if (currentGeometry) {
        showTooltip(index, currentGeometry);
      }
      scheduleFrame();
    },
    [scheduleFrame, showTooltip],
  );

  const handleRailBlur = useCallback(
    (event: ReactFocusEvent<HTMLElement>) => {
      const root = rootRef.current;
      if (root && event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) {
        return;
      }
      focusOverrideIndexRef.current = null;
      if (latestPointerClientYRef.current === null) {
        applyRest();
      }
    },
    [applyRest],
  );

  return {
    rootRef,
    viewportRef,
    trackRef,
    tooltipRef,
    tooltipEyebrowRef,
    tooltipMessageRef,
    tooltipResponseRef,
    tickRefs,
    handlePointerEnter,
    handlePointerMove,
    handlePointerLeave,
    handleScroll,
    handleClick,
    handleTickFocus,
    handleRailBlur,
    selectIndex,
  };
}
