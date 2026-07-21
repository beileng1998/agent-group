import type { ToastObject } from "@base-ui/react/toast";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from "~/lib/icons";

import { APP_TOOLTIP_SURFACE_CLASS_NAME } from "~/components/chat/composerPickerStyles";
import {
  COMPACT_NOTIFICATION_SURFACE_CLASS_NAME,
  EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME,
  NOTIFICATION_ICON_CLASS_NAME,
} from "~/components/ui/notificationSurface";
import { cn } from "~/lib/utils";
import type { ThreadToastData, ToastPosition } from "./toastTypes";

export const TOAST_ICONS = {
  error: CircleAlertIcon,
  info: InfoIcon,
  loading: LoaderCircleIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
} as const;

export function shouldUseCompactToast(toast: ToastObject<ThreadToastData>): boolean {
  return !toast.data?.copyText && !toast.actionProps && !toast.data?.secondaryActionProps;
}

export function isArchiveUndoToast(toast: ToastObject<ThreadToastData>): boolean {
  return Boolean(toast.data?.archiveUndo);
}

// Archive undo uses the tooltip chrome from the original design, but keeps the
// toast root no-drag so Electron titlebar hit testing cannot swallow clicks.
export const ARCHIVE_UNDO_TOAST_SURFACE_CLASS_NAME = cn(
  APP_TOOLTIP_SURFACE_CLASS_NAME,
  "absolute w-max max-w-[min(calc(100vw-2rem),28rem)] rounded-2xl [--notification-fg:var(--popover-foreground)] [-webkit-app-region:no-drag]",
);

export const ARCHIVE_UNDO_TOAST_LINK_CLASS_NAME =
  "rounded-sm font-medium text-[var(--info-foreground)] underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--info-foreground)]/35 disabled:pointer-events-none disabled:opacity-55";

export function toastRootClassName(position: ToastPosition, compact: boolean): string {
  return cn(
    compact ? COMPACT_NOTIFICATION_SURFACE_CLASS_NAME : EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME,
    position.includes("center") ? "mx-auto" : compact ? "" : "w-full",
  );
}

export function toastIconClassName(type: ToastObject<ThreadToastData>["type"]): string {
  return cn(NOTIFICATION_ICON_CLASS_NAME, type === "loading" && "animate-spin opacity-90");
}
