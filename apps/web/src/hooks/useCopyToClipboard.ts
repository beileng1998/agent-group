import * as React from "react";

import { toastManager } from "../components/ui/toast";
import { useCopyToClipboard } from "./useCopyToClipboardCore";

export { copyTextToClipboard, useCopyToClipboard } from "./useCopyToClipboardCore";

/**
 * Copy a filesystem path and surface the shared success/error toast. Single source
 * of truth for the "Path copied" affordance used by the sidebar and the kanban board.
 */
export function useCopyPathToClipboard(): (path: string) => void {
  const { copyToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: (ctx) =>
      toastManager.add({ type: "success", title: "Path copied", description: ctx.path }),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Failed to copy path",
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
  });
  return React.useCallback((path: string) => copyToClipboard(path, { path }), [copyToClipboard]);
}

/** Copy a thread id and surface the shared "Thread ID copied" toast. */
export function useCopyThreadIdToClipboard(): (threadId: string) => void {
  const { copyToClipboard } = useCopyToClipboard<{ threadId: string }>({
    onCopy: (ctx) =>
      toastManager.add({ type: "success", title: "Thread ID copied", description: ctx.threadId }),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Failed to copy thread ID",
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
  });
  return React.useCallback(
    (threadId: string) => copyToClipboard(threadId, { threadId }),
    [copyToClipboard],
  );
}
