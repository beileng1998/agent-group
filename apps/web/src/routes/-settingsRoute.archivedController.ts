import type { ThreadId } from "@agent-group/contracts";
import { useCallback, useMemo } from "react";

import { toastManager } from "../components/ui/toast";
import { deleteArchivedThreadFromClient } from "../lib/archivedThreadDelete";
import { unarchiveThreadFromClient } from "../lib/threadArchive";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import type { ThreadShell } from "../types";

export function useArchivedThreadsSettingsController(input: {
  threadShells: ReadonlyArray<ThreadShell>;
}) {
  const removeDeletedThreadFromClientState = useStore(
    (store) => store.removeDeletedThreadFromClientState,
  );
  const archivedThreads = useMemo(
    () => input.threadShells.filter((thread) => thread.archivedAt != null),
    [input.threadShells],
  );

  const unarchiveThread = useCallback(async (threadId: ThreadId) => {
    const api = readNativeApi();
    if (!api) return;
    try {
      await unarchiveThreadFromClient(api.orchestration, threadId);
      toastManager.add({
        type: "success",
        title: "Thread restored",
        description: "The thread has been moved back to the sidebar.",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not restore thread",
        description: error instanceof Error ? error.message : "Unable to restore the thread.",
      });
    }
  }, []);

  const deleteArchivedThread = useCallback(
    async (threadId: ThreadId, threadTitle: string) => {
      const api = readNativeApi();
      if (!api) return;
      const confirmed = await api.dialogs.confirm(
        `Permanently delete "${threadTitle}"?\n\nThis will remove the thread and its conversation history forever.`,
      );
      if (!confirmed) return;

      try {
        await deleteArchivedThreadFromClient({
          api: api.orchestration,
          threadId,
          removeDeletedThreadFromClientState,
        });
        toastManager.add({
          type: "success",
          title: "Thread deleted",
          description: "The archived thread has been permanently removed.",
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not delete thread",
          description: error instanceof Error ? error.message : "Unable to delete the thread.",
        });
      }
    },
    [removeDeletedThreadFromClientState],
  );

  const openContextMenu = useCallback(
    async (threadId: ThreadId, threadTitle: string, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "restore", label: "Restore" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );
      if (clicked === "restore") {
        await unarchiveThread(threadId);
      } else if (clicked === "delete") {
        await deleteArchivedThread(threadId, threadTitle);
      }
    },
    [deleteArchivedThread, unarchiveThread],
  );

  return { archivedThreads, unarchiveThread, deleteArchivedThread, openContextMenu };
}
