import type { RefObject } from "react";
import { useEffect } from "react";

// Scroll a deep-linked settings section into view when it becomes active.
// `retriggerKey` lets late-loading content request the same target again.
export function useSettingsTargetScroll(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
  retriggerKey?: unknown,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, ref, retriggerKey]);
}
