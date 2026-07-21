// FILE: useSidebarMultiSelectOwner.ts
// Purpose: Own native context-menu actions for the current sidebar thread selection.
// Layer: Web sidebar controller

import { ThreadId } from "@agent-group/contracts";
import { pluralize } from "@agent-group/shared/text";
import { useCallback } from "react";
import { reconcileDeletedThreadsFromClient } from "../lib/deletedThreadClientReconciliation";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { useThreadSelectionStore } from "../threadSelectionStore";

interface UseSidebarMultiSelectOwnerInput {
  readonly confirmThreadArchive: boolean;
  readonly confirmThreadDelete: boolean;
  readonly clearDismissedThreadStatus: (threadId: ThreadId) => void;
  readonly markThreadUnread: (threadId: ThreadId) => void;
  readonly archiveThread: (threadId: ThreadId) => Promise<boolean>;
  readonly deleteThread: (
    threadId: ThreadId,
    options?: {
      deletedThreadIds?: ReadonlySet<ThreadId>;
      reconcileDeletedThread?: boolean;
    },
  ) => Promise<void>;
}

export function useSidebarMultiSelectOwner({
  confirmThreadArchive,
  confirmThreadDelete,
  clearDismissedThreadStatus,
  markThreadUnread,
  archiveThread,
  deleteThread,
}: UseSidebarMultiSelectOwnerInput) {
  const selectedThreadIds = useThreadSelectionStore((state) => state.selectedThreadIds);
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const removeFromSelection = useThreadSelectionStore((state) => state.removeFromSelection);

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const ids = [...selectedThreadIds];
      if (ids.length === 0) return;
      const count = ids.length;
      const clicked = await api.contextMenu.show(
        [
          { id: "mark-unread", label: `Mark unread (${count})` },
          { id: "archive", label: `Archive (${count})` },
          { id: "delete", label: `Delete (${count})`, destructive: true },
        ],
        position,
      );
      if (clicked === "mark-unread") {
        for (const id of ids) {
          clearDismissedThreadStatus(id);
          markThreadUnread(id);
        }
        clearSelection();
        return;
      }
      if (clicked === "archive") {
        if (confirmThreadArchive) {
          const confirmed = await api.dialogs.confirm(
            [
              `Archive ${count} ${pluralize(count, "thread")}?`,
              "Archived threads are hidden from the sidebar but can be restored later.",
            ].join("\n"),
          );
          if (!confirmed) return;
        }
        for (const id of ids) await archiveThread(id);
        removeFromSelection(ids);
        return;
      }
      if (clicked !== "delete") return;
      if (confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete ${count} ${pluralize(count, "thread")}?`,
            "This permanently clears conversation history for these threads.",
          ].join("\n"),
        );
        if (!confirmed) return;
      }
      const deletedIds = new Set<ThreadId>(ids);
      const successfullyDeletedIds: ThreadId[] = [];
      try {
        for (const id of ids) {
          await deleteThread(id, {
            deletedThreadIds: deletedIds,
            reconcileDeletedThread: false,
          });
          successfullyDeletedIds.push(id);
        }
      } finally {
        if (successfullyDeletedIds.length > 0) {
          void reconcileDeletedThreadsFromClient({
            threadIds: successfullyDeletedIds,
            removeDeletedThreadFromClientState:
              useStore.getState().removeDeletedThreadFromClientState,
          });
        }
      }
      removeFromSelection(ids);
    },
    [
      archiveThread,
      clearDismissedThreadStatus,
      clearSelection,
      confirmThreadArchive,
      confirmThreadDelete,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
      selectedThreadIds,
    ],
  );

  return { handleMultiSelectContextMenu };
}
