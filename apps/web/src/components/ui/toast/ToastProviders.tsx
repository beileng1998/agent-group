import { Toast } from "@base-ui/react/toast";

import {
  COMPACT_NOTIFICATION_SURFACE_CLASS_NAME,
  EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME,
} from "~/components/ui/notificationSurface";
import { cn } from "~/lib/utils";
import { ToastSurface } from "./ToastSurface";
import { Toasts } from "./ToastViewport";
import { anchoredToastManager, toastManager } from "./toastManagers";
import { shouldUseCompactToast } from "./toastPresentation";
import type { ThreadToastData, ToastProviderProps } from "./toastTypes";
import {
  shouldRenderForActiveThread,
  useVisibleThreadIdsFromRoute,
} from "./useVisibleToastThreads";

export function ToastProvider({ children, position = "top-center", ...props }: ToastProviderProps) {
  return (
    <Toast.Provider toastManager={toastManager} {...props}>
      {children}
      <Toasts position={position} />
    </Toast.Provider>
  );
}

export function AnchoredToastProvider({ children, ...props }: Toast.Provider.Props) {
  return (
    <Toast.Provider toastManager={anchoredToastManager} {...props}>
      {children}
      <AnchoredToasts />
    </Toast.Provider>
  );
}

function AnchoredToasts() {
  const { toasts } = Toast.useToastManager<ThreadToastData>();
  const visibleThreadIds = useVisibleThreadIdsFromRoute();

  return (
    <Toast.Portal data-slot="toast-portal-anchored">
      <Toast.Viewport className="outline-none" data-slot="toast-viewport-anchored">
        {toasts
          .filter((toast) => shouldRenderForActiveThread(toast.data, visibleThreadIds))
          .map((toast) => {
            const tooltipStyle = toast.data?.tooltipStyle ?? false;
            const positionerProps = toast.positionerProps;
            const compact = !tooltipStyle && shouldUseCompactToast(toast);

            if (!positionerProps?.anchor) {
              return null;
            }

            return (
              <Toast.Positioner
                className="z-50 max-w-[min(--spacing(64),var(--available-width))]"
                data-slot="toast-positioner"
                key={toast.id}
                sideOffset={positionerProps.sideOffset ?? 4}
                toast={toast}
              >
                <Toast.Root
                  className={cn(
                    "relative text-balance transition-[scale,opacity] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0",
                    tooltipStyle
                      ? "rounded-lg border bg-popover text-popover-foreground text-xs shadow-md/5 [-webkit-app-region:no-drag] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
                      : compact
                        ? COMPACT_NOTIFICATION_SURFACE_CLASS_NAME
                        : EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME,
                  )}
                  data-slot="toast-popup"
                  toast={toast}
                >
                  {tooltipStyle ? (
                    <Toast.Content className="pointer-events-auto px-2 py-1">
                      <Toast.Title data-slot="toast-title" />
                    </Toast.Content>
                  ) : (
                    <ToastSurface
                      compact={compact}
                      hideCollapsedContent={false}
                      onDismiss={() => anchoredToastManager.close(toast.id)}
                      toast={toast}
                    />
                  )}
                </Toast.Root>
              </Toast.Positioner>
            );
          })}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
