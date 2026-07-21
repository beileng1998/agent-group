import { Toast } from "@base-ui/react/toast";
import { useEffect, type CSSProperties } from "react";

import {
  buildVisibleToastLayout,
  shouldHideCollapsedToastContent,
} from "~/components/ui/toast.logic";
import { cn } from "~/lib/utils";
import { ArchiveUndoToastSurface, ToastSurface } from "./ToastSurface";
import { ThreadToastVisibleAutoDismiss } from "./ThreadToastVisibleAutoDismiss";
import {
  ARCHIVE_UNDO_TOAST_SURFACE_CLASS_NAME,
  isArchiveUndoToast,
  shouldUseCompactToast,
  toastRootClassName,
} from "./toastPresentation";
import { threadToastVisibleTimeoutRemainingMs, toastManager } from "./toastManagers";
import type { ThreadToastData, ToastPosition } from "./toastTypes";
import {
  shouldRenderForActiveThread,
  useVisibleThreadIdsFromRoute,
} from "./useVisibleToastThreads";

export function Toasts({ position = "top-center" }: { position: ToastPosition }) {
  const { toasts } = Toast.useToastManager<ThreadToastData>();
  const visibleThreadIds = useVisibleThreadIdsFromRoute();
  const isTop = position.startsWith("top");
  const visibleToasts = toasts
    .filter((toast) => shouldRenderForActiveThread(toast.data, visibleThreadIds))
    .toSorted((left, right) => {
      const leftEnding = left.transitionStatus === "ending";
      const rightEnding = right.transitionStatus === "ending";
      if (leftEnding === rightEnding) return 0;
      return leftEnding ? 1 : -1;
    });
  const visibleToastLayout = buildVisibleToastLayout(visibleToasts);

  useEffect(() => {
    const activeToastIds = new Set(toasts.map((toast) => toast.id));
    for (const toastId of threadToastVisibleTimeoutRemainingMs.keys()) {
      if (!activeToastIds.has(toastId)) {
        threadToastVisibleTimeoutRemainingMs.delete(toastId);
      }
    }
  }, [toasts]);

  return (
    <Toast.Portal data-slot="toast-portal">
      <Toast.Viewport
        className={cn(
          "fixed z-[200] mx-auto flex w-[calc(100%-var(--toast-inset)*2)] max-w-sm [--toast-inset:--spacing(4)] sm:[--toast-inset:--spacing(8)]",
          // Vertical positioning
          "data-[position=top-center]:top-4",
          "data-[position=top-left]:top-[calc(var(--toast-inset)+46px)]",
          "data-[position=top-right]:top-[calc(var(--toast-inset)+46px)]",
          "data-[position*=bottom]:bottom-(--toast-inset)",
          // Horizontal positioning
          "data-[position*=left]:left-(--toast-inset)",
          "data-[position*=right]:right-(--toast-inset)",
          "data-[position*=center]:-translate-x-1/2 data-[position*=center]:left-1/2",
        )}
        data-position={position}
        data-slot="toast-viewport"
        style={
          {
            "--toast-frontmost-height": `${visibleToastLayout.frontmostHeight}px`,
          } as CSSProperties
        }
      >
        {visibleToastLayout.items.map(({ toast, visibleIndex, offsetY }) => {
          const hideCollapsedContent = shouldHideCollapsedToastContent(
            visibleIndex,
            visibleToastLayout.items.length,
          );
          const compact = shouldUseCompactToast(toast);
          const archiveUndoToast = isArchiveUndoToast(toast);

          return (
            <Toast.Root
              className={cn(
                "absolute z-[calc(9999-var(--toast-index))] h-(--toast-calc-height) select-none [transition:transform_.5s_cubic-bezier(.22,1,.36,1),opacity_.5s,height_.15s]",
                archiveUndoToast
                  ? cn(
                      ARCHIVE_UNDO_TOAST_SURFACE_CLASS_NAME,
                      position.includes("center") ? "mx-auto" : "",
                    )
                  : toastRootClassName(position, compact),
                // Base positioning using data-position
                "data-[position*=right]:right-0 data-[position*=right]:left-auto",
                "data-[position*=left]:right-auto data-[position*=left]:left-0",
                "data-[position*=center]:right-0 data-[position*=center]:left-0",
                "data-[position*=top]:top-0 data-[position*=top]:bottom-auto data-[position*=top]:origin-top",
                "data-[position*=bottom]:top-auto data-[position*=bottom]:bottom-0 data-[position*=bottom]:origin-bottom",
                // Gap fill for hover
                "after:absolute after:left-0 after:h-[calc(var(--toast-gap)+1px)] after:w-full",
                "data-[position*=top]:after:top-full",
                "data-[position*=bottom]:after:bottom-full",
                // Define some variables
                // Base UI exposes a shared front-most height for the collapsed stack.
                // If that shared measurement is briefly stale, long content can render
                // outside the card until hover expands the toast and swaps to its own height.
                "[--toast-calc-height:max(var(--toast-frontmost-height,var(--toast-height)),var(--toast-height))] [--toast-gap:--spacing(3)] [--toast-peek:--spacing(3)] [--toast-scale:calc(max(0,1-(var(--toast-index)*.1)))] [--toast-shrink:calc(1-var(--toast-scale))]",
                // Top-center uses a flat banner stack without peek/shrink offsets.
                "data-[position=top-center]:[--toast-peek:0px] data-[position=top-center]:[--toast-scale:1] data-[position=top-center]:[--toast-shrink:0]",
                "data-[position=top-center]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--toast-swipe-movement-y))]",
                "data-[position=top-center]:data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-offset-y)+var(--toast-swipe-movement-y)))]",
                // Define offset-y variable
                "data-[position*=top]:[--toast-calc-offset-y:calc(var(--toast-offset-y)+var(--toast-index)*var(--toast-gap)+var(--toast-swipe-movement-y))]",
                "data-[position*=bottom]:[--toast-calc-offset-y:calc(var(--toast-offset-y)*-1+var(--toast-index)*var(--toast-gap)*-1+var(--toast-swipe-movement-y))]",
                // Default state transform
                "data-[position*=top]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--toast-peek))+(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))]",
                "data-[position*=bottom]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--toast-peek))-(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))]",
                // Limited state
                "data-limited:opacity-0",
                // Expanded state
                "data-expanded:h-(--toast-height)",
                "data-position:data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--toast-calc-offset-y))]",
                // Starting and ending animations
                "data-[position*=top]:data-starting-style:transform-[translateY(calc(-100%-var(--toast-inset)))]",
                "data-[position=top-center]:data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]",
                "data-[position*=bottom]:data-starting-style:transform-[translateY(calc(100%+var(--toast-inset)))]",
                "data-[position*=top]:data-[position*=right]:data-starting-style:transform-[translateX(calc(100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                "data-ending-style:opacity-0",
                // Ending animations (direction-aware)
                "data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateY(calc(100%+var(--toast-inset)))]",
                "data-[position*=top]:data-[position*=right]:data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateX(calc(100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                "data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                "data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                "data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]",
                "data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]",
                // Ending animations (expanded)
                "data-expanded:data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                "data-expanded:data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                "data-expanded:data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]",
                "data-expanded:data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]",
                // Closed/limited toasts stay mounted briefly for animation; they must
                // never sit as invisible hit targets above a fresh interactive toast.
                "data-ending-style:pointer-events-none data-limited:pointer-events-none",
              )}
              data-position={position}
              key={toast.id}
              style={
                {
                  "--toast-index": visibleIndex,
                  "--toast-offset-y": `${offsetY}px`,
                } as CSSProperties
              }
              swipeDirection={
                position.includes("center")
                  ? [isTop ? "up" : "down"]
                  : position.includes("left")
                    ? ["left", isTop ? "up" : "down"]
                    : ["right", isTop ? "up" : "down"]
              }
              toast={toast}
            >
              {archiveUndoToast && toast.data?.archiveUndo ? (
                <ArchiveUndoToastSurface
                  archiveUndo={toast.data.archiveUndo}
                  toastId={toast.id}
                  dismissAfterVisibleMs={toast.data.dismissAfterVisibleMs}
                  hideCollapsedContent={hideCollapsedContent}
                  onDismiss={() => toastManager.close(toast.id)}
                />
              ) : (
                <>
                  <ThreadToastVisibleAutoDismiss
                    dismissAfterVisibleMs={toast.data?.dismissAfterVisibleMs}
                    toastId={toast.id}
                  />
                  <ToastSurface
                    compact={compact}
                    hideCollapsedContent={hideCollapsedContent}
                    onDismiss={() => toastManager.close(toast.id)}
                    toast={toast}
                  />
                </>
              )}
            </Toast.Root>
          );
        })}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
