// FILE: useThreadCheckpointController.ts
// Purpose: Own thread checkpoint reverts and file-only undo lifecycle.
// Layer: Web thread controller

import { type ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { hasFileUndoSettled, type PendingFileUndo } from "../components/ChatView.dispatch";
import type { Thread } from "../types";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";

export function useThreadCheckpointController(input: {
  activeThread: Thread | null | undefined;
  hasLiveTurn: boolean;
  isConnecting: boolean;
  isSendBusy: boolean;
  setThreadError: (threadId: ThreadId, error: string | null) => void;
}): {
  isRevertingCheckpoint: boolean;
  setIsRevertingCheckpoint: Dispatch<SetStateAction<boolean>>;
  revertToTurnCount: (turnCount: number) => Promise<void>;
  undoTurnFiles: (turnCounts: readonly number[]) => Promise<void>;
} {
  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false);
  const [pendingFileUndo, setPendingFileUndo] = useState<PendingFileUndo | null>(null);

  useEffect(() => {
    if (
      pendingFileUndo &&
      hasFileUndoSettled({ pending: pendingFileUndo, thread: input.activeThread ?? null })
    ) {
      setPendingFileUndo(null);
      setIsRevertingCheckpoint(false);
    }
  }, [input.activeThread, pendingFileUndo]);

  useEffect(() => {
    setIsRevertingCheckpoint(false);
  }, [input.activeThread?.id]);

  const revertToTurnCount = useCallback(
    async (turnCount: number) => {
      const api = readNativeApi();
      const activeThread = input.activeThread;
      if (!api || !activeThread || isRevertingCheckpoint) return;

      if (input.hasLiveTurn || input.isSendBusy || input.isConnecting) {
        input.setThreadError(
          activeThread.id,
          "Interrupt the current turn before reverting checkpoints.",
        );
        return;
      }
      const confirmed = await api.dialogs.confirm(
        [
          `Revert this thread to checkpoint ${turnCount}?`,
          "This will discard newer messages and turn diffs in this thread.",
          "This action cannot be undone.",
        ].join("\n"),
      );
      if (!confirmed) return;

      setIsRevertingCheckpoint(true);
      input.setThreadError(activeThread.id, null);
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.checkpoint.revert",
          commandId: newCommandId(),
          threadId: activeThread.id,
          turnCount,
          scope: "thread",
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        input.setThreadError(
          activeThread.id,
          error instanceof Error ? error.message : "Failed to revert thread state.",
        );
      }
      setIsRevertingCheckpoint(false);
    },
    [input, isRevertingCheckpoint],
  );

  const undoTurnFiles = useCallback(
    async (turnCounts: readonly number[]) => {
      const api = readNativeApi();
      const activeThread = input.activeThread;
      if (!api || !activeThread || isRevertingCheckpoint || turnCounts.length === 0) return;

      if (input.hasLiveTurn || input.isSendBusy || input.isConnecting) {
        input.setThreadError(
          activeThread.id,
          "Interrupt the current turn before undoing file changes.",
        );
        return;
      }
      const confirmed = await api.dialogs.confirm(
        [
          "Undo the latest file changes shown in this card?",
          "Earlier file changes will remain available to undo.",
          "Messages and provider conversation history will be kept.",
          "This action cannot be undone.",
        ].join("\n"),
      );
      if (!confirmed) return;

      setIsRevertingCheckpoint(true);
      input.setThreadError(activeThread.id, null);
      const turnCount = Math.max(...turnCounts);
      setPendingFileUndo({
        threadId: activeThread.id,
        turnCount,
        existingFailureActivityIds: activeThread.activities
          .filter((activity) => activity.kind === "checkpoint.revert.failed")
          .map((activity) => activity.id),
      });
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.checkpoint.revert",
          commandId: newCommandId(),
          threadId: activeThread.id,
          turnCount,
          scope: "files",
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        setPendingFileUndo(null);
        setIsRevertingCheckpoint(false);
        input.setThreadError(
          activeThread.id,
          error instanceof Error ? error.message : "Failed to undo file changes.",
        );
      }
    },
    [input, isRevertingCheckpoint],
  );

  return {
    isRevertingCheckpoint,
    setIsRevertingCheckpoint,
    revertToTurnCount,
    undoTurnFiles,
  };
}
