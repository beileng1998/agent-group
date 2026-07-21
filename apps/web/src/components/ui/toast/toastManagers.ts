import { Toast } from "@base-ui/react/toast";

import type { ThreadToastData } from "./toastTypes";

export const toastManager = Toast.createToastManager<ThreadToastData>();
export const anchoredToastManager = Toast.createToastManager<ThreadToastData>();

export type ToastId = ReturnType<typeof toastManager.add>;

export const threadToastVisibleTimeoutRemainingMs = new Map<ToastId, number>();
