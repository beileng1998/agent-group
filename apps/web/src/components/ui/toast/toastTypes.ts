import type { Toast } from "@base-ui/react/toast";
import type { ThreadId } from "@agent-group/contracts";
import type { ComponentProps } from "react";

import type { Button } from "~/components/ui/button";

export type ThreadToastData = {
  allowCrossThreadVisibility?: boolean;
  copyText?: string;
  onClose?: () => void;
  secondaryActionProps?: ComponentProps<typeof Button>;
  threadId?: ThreadId | null;
  tooltipStyle?: boolean;
  dismissAfterVisibleMs?: number;
  archiveUndo?: {
    onUndo: () => boolean | Promise<boolean>;
    onViewArchived: () => void | Promise<void>;
  };
};

export type ToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface ToastProviderProps extends Toast.Provider.Props {
  position?: ToastPosition;
}
