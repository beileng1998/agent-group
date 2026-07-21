// FILE: MessageTrail.tsx
// Purpose: Left-gutter message rail with macOS-Dock-style magnification. The tick
//   nearest the pointer grows longest (Gaussian falloff on its neighbours) and a
//   side tooltip shows that one focused message. Built on Agent Group's existing scroll
//   engine: `activeStore` carries the current + visible viewport highlights and
//   `onSelect` jumps (shadcn's scrollToMessage). The hot path writes tick width /
//   opacity straight to the DOM inside one coalesced rAF — no React state per move
//   — so it stays smooth and never re-renders the heavy timeline.
// Layer: Chat transcript shell (presentation)
// Depends on: pure magnification math in messageTrail.logic.ts (unit-tested).

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { cn } from "~/lib/utils";
import { DISCLOSURE_CONTENT_MOTION_CLASS } from "~/lib/disclosureMotion";
import { APP_TOOLTIP_SURFACE_CLASS_NAME } from "./composerPickerStyles";
import { MARKER_SWATCH_CLASS } from "./markerColors";
import {
  clampNumber,
  computeTrailGeometry,
  type ActiveTrailStore,
  type MessageTrailItem,
} from "./messageTrail.logic";
import {
  MIN_PANE_WIDTH_PX,
  RAIL_MAX_HEIGHT_RATIO,
  RAIL_WIDTH_PX,
  TICK_ANCHOR_OPACITY,
  TICK_BASE_W,
  TICK_LEFT_PAD_PX,
  TICK_REST_OPACITY,
  TICK_SAVED_OPACITY,
  TICK_SPACING_PX,
  TICK_VISIBLE_OPACITY,
  TOOLTIP_OFFSET_X_PX,
  getMessageTrailTickHeight,
} from "./message-trail/messageTrailViewValues";
import { useMessageTrailInteraction } from "./message-trail/useMessageTrailInteraction";

interface MessageTrailProps {
  items: readonly MessageTrailItem[];
  /** Stable holder for current + visible highlights; only this component re-renders on change. */
  activeStore: ActiveTrailStore;
  onSelect: (item: MessageTrailItem) => void;
}

function getTrailItemAriaLabel(item: MessageTrailItem): string {
  const preview = item.preview.slice(0, 60);
  if (item.kind === "turn") {
    return `Message ${item.ordinal}: ${preview}`;
  }
  return `${item.kind === "pin" ? "Pinned message" : "Highlight"}: ${preview}`;
}

export function MessageTrail({ items, activeStore, onSelect }: MessageTrailProps) {
  const tooltipId = useId();

  const [hasGutter, setHasGutter] = useState(false);
  const [rovingIndex, setRovingIndex] = useState(0);

  // Reading-position highlights — fed by the timeline via a stable store so only
  // this rail re-renders when they change.
  const trailSnapshot = useSyncExternalStore(
    activeStore.subscribe,
    activeStore.get,
    activeStore.get,
  );
  const anchorIndex = useMemo(
    () =>
      items.findIndex((item) => item.kind === "turn" && item.messageId === trailSnapshot.currentId),
    [items, trailSnapshot.currentId],
  );
  const visibleIndexes = useMemo(() => {
    if (trailSnapshot.visibleIds.length === 0) {
      return [];
    }
    const visibleIds = new Set(trailSnapshot.visibleIds);
    const indexes: number[] = [];
    items.forEach((item, index) => {
      if (item.kind === "turn" && visibleIds.has(item.messageId)) {
        indexes.push(index);
      }
    });
    return indexes;
  }, [items, trailSnapshot.visibleIds]);
  const visibleIndexSet = useMemo(() => new Set(visibleIndexes), [visibleIndexes]);

  const visible = hasGutter && items.length > 1;

  // Tick layout depends only on the message count (fixed spacing, natural content
  // height) — never on the measured viewport — so the capped/scrolling viewport
  // can't feed its height back into the layout (no ResizeObserver loop).
  const geometry = useMemo(
    () => computeTrailGeometry({ count: items.length, spacingPx: TICK_SPACING_PX }),
    [items.length],
  );

  const {
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
  } = useMessageTrailInteraction({
    items,
    anchorIndex,
    visibleIndexes,
    visible,
    geometry,
    onSelect,
  });

  // --- Gutter visibility: rail only shows when the pane is wide enough --------
  // Width-only ResizeObserver; the tick layout is count-driven (see `geometry`),
  // so observing size never feeds back into the layout.
  useEffect(() => {
    const root = rootRef.current;
    const pane = root?.parentElement;
    if (!pane || typeof ResizeObserver === "undefined") {
      return;
    }
    let pendingRaf: number | null = null;
    const measure = () => {
      pendingRaf = null;
      setHasGutter(pane.clientWidth >= MIN_PANE_WIDTH_PX);
    };
    const schedule = () => {
      if (pendingRaf === null) {
        pendingRaf = requestAnimationFrame(measure);
      }
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(pane);
    return () => {
      if (pendingRaf !== null) {
        cancelAnimationFrame(pendingRaf);
      }
      observer.disconnect();
    };
  }, []);

  // --- Keyboard: one tab stop (roving), arrows move, Enter jumps -------------
  const focusTick = useCallback((index: number) => {
    setRovingIndex(index);
    tickRefs.current[index]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const count = items.length;
      if (count === 0) {
        return;
      }
      const current = clampNumber(rovingIndex, 0, count - 1);
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusTick(Math.min(count - 1, current + 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          focusTick(Math.max(0, current - 1));
          break;
        case "Home":
          event.preventDefault();
          focusTick(0);
          break;
        case "End":
          event.preventDefault();
          focusTick(count - 1);
          break;
        case "Enter":
        case " ": {
          event.preventDefault();
          selectIndex(current);
          break;
        }
        case "Escape":
          tickRefs.current[current]?.blur();
          break;
        default:
          break;
      }
    },
    [focusTick, items.length, rovingIndex, selectIndex],
  );

  const tabStop = clampNumber(rovingIndex, 0, Math.max(0, items.length - 1));

  return (
    <nav
      ref={rootRef}
      aria-label="Message navigation"
      aria-hidden={!visible}
      onKeyDown={handleKeyDown}
      onBlur={handleRailBlur}
      className={cn(
        "absolute inset-y-0 left-0 z-20 hidden flex-col justify-center sm:flex",
        DISCLOSURE_CONTENT_MOTION_CLASS,
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      style={{ width: RAIL_WIDTH_PX }}
    >
      {/* Capped, centered, scrollable viewport. `scroll-fade-y` masks the top/bottom
          edges only while there is overflow to scroll (auto-off when it all fits). */}
      <div
        ref={viewportRef}
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onScroll={handleScroll}
        onClick={handleClick}
        className={cn(
          "scroll-fade-y relative w-full overflow-y-auto overscroll-contain [contain:layout] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          visible ? "pointer-events-auto" : "pointer-events-none",
        )}
        style={{ maxHeight: `${RAIL_MAX_HEIGHT_RATIO * 100}%` }}
      >
        <div ref={trackRef} className="relative w-full" style={{ height: geometry?.contentHeight }}>
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                tickRefs.current[index] = el;
              }}
              type="button"
              tabIndex={visible && index === tabStop ? 0 : -1}
              aria-label={getTrailItemAriaLabel(item)}
              aria-describedby={tooltipId}
              aria-current={index === anchorIndex ? "location" : undefined}
              onFocus={() => handleTickFocus(index)}
              data-message-trail-kind={item.kind}
              className={cn(
                "absolute rounded-full transition-[width,opacity] duration-[90ms] ease-out outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-border)] motion-reduce:transition-none",
                item.kind === "turn"
                  ? "bg-[var(--color-text-foreground)]"
                  : item.kind === "pin"
                    ? "bg-[var(--color-text-accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-text-accent)_12%,transparent)]"
                    : MARKER_SWATCH_CLASS[item.marker.color],
              )}
              style={{
                left: TICK_LEFT_PAD_PX,
                height: getMessageTrailTickHeight(item.kind),
                width: TICK_BASE_W,
                opacity:
                  index === anchorIndex
                    ? TICK_ANCHOR_OPACITY
                    : visibleIndexSet.has(index)
                      ? TICK_VISIBLE_OPACITY
                      : item.kind === "turn"
                        ? TICK_REST_OPACITY
                        : TICK_SAVED_OPACITY,
                willChange: "width, opacity",
              }}
            />
          ))}
        </div>
      </div>
      <div
        ref={tooltipRef}
        role="tooltip"
        id={tooltipId}
        className={cn(
          APP_TOOLTIP_SURFACE_CLASS_NAME,
          "pointer-events-none invisible absolute z-30 w-64 -translate-y-1/2 rounded-xl p-2",
        )}
        style={{ left: RAIL_WIDTH_PX + TOOLTIP_OFFSET_X_PX, top: 0 }}
      >
        <div
          ref={tooltipEyebrowRef}
          className="mb-1 text-[10px] leading-none font-semibold tracking-[0.12em] text-[var(--color-text-accent)] uppercase"
        />
        {/* The sent message: dark, max two lines (matches the projects/threads card title). */}
        <div
          ref={tooltipMessageRef}
          className="line-clamp-2 text-xs leading-snug font-medium text-foreground"
        />
        {/* The turn's first reply: muted gray, max three lines. */}
        <div
          ref={tooltipResponseRef}
          className="mt-1 line-clamp-3 text-xs leading-snug text-muted-foreground"
        />
      </div>
    </nav>
  );
}
