// FILE: useLocalDispatchController.ts
// Purpose: Own optimistic local dispatch and worktree setup presentation state.
// Layer: Web turn controller

import { useCallback, useEffect, useRef, useState } from "react";

import {
  failWorktreeSetupSnapshot,
  hasServerAcknowledgedLocalDispatch,
  resolveNextLocalDispatchSnapshot,
  WORKTREE_SETUP_ERROR_HOLD_MS,
  worktreeSetupHasError,
  type LocalDispatchSnapshot,
  type WorktreeSetupDispatchOptions,
} from "../components/ChatView.logic";
import type { derivePhase } from "../session-logic";
import type { Thread } from "../types";

export function useLocalDispatchController(input: {
  activeThread: Thread | undefined;
  phase: ReturnType<typeof derivePhase>;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
}) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null);
  const failedWorktreeSetupDispatchStartedAtRef = useRef<string | null>(null);
  const serverAcknowledged = hasServerAcknowledgedLocalDispatch({
    localDispatch,
    phase: input.phase,
    latestTurn: input.activeThread?.latestTurn ?? null,
    session: input.activeThread?.session ?? null,
    hasPendingApproval: input.hasPendingApproval,
    hasPendingUserInput: input.hasPendingUserInput,
    threadError: input.activeThread?.error,
  });
  const activeWorktreeSetup = localDispatch?.worktreeSetup ?? null;
  const worktreeSetupFailed = worktreeSetupHasError(activeWorktreeSetup);

  const begin = useCallback(
    (options?: WorktreeSetupDispatchOptions) => {
      setLocalDispatch((current) => {
        const next = resolveNextLocalDispatchSnapshot(
          options
            ? { current, activeThread: input.activeThread, options }
            : { current, activeThread: input.activeThread },
        );
        if (next !== current) failedWorktreeSetupDispatchStartedAtRef.current = null;
        return next;
      });
    },
    [input.activeThread],
  );
  const failWorktreeSetup = useCallback(() => {
    setLocalDispatch((current) => {
      if (!current?.worktreeSetup) return current;
      const failed = failWorktreeSetupSnapshot(current.worktreeSetup);
      failedWorktreeSetupDispatchStartedAtRef.current = current.startedAt;
      return failed === current.worktreeSetup ? current : { ...current, worktreeSetup: failed };
    });
  }, []);
  const reset = useCallback(() => {
    failedWorktreeSetupDispatchStartedAtRef.current = null;
    setLocalDispatch(null);
  }, []);
  const scheduleFailedWorktreeSetupReset = useCallback(() => {
    const failedDispatchStartedAt = failedWorktreeSetupDispatchStartedAtRef.current;
    window.setTimeout(() => {
      setLocalDispatch((current) => {
        if (
          !failedDispatchStartedAt ||
          !current ||
          current.startedAt !== failedDispatchStartedAt ||
          !worktreeSetupHasError(current.worktreeSetup)
        ) {
          return current;
        }
        failedWorktreeSetupDispatchStartedAtRef.current = null;
        return null;
      });
    }, WORKTREE_SETUP_ERROR_HOLD_MS);
  }, []);

  useEffect(() => {
    if (!serverAcknowledged) return;
    if (worktreeSetupFailed) {
      const failedDispatchStartedAt = localDispatch?.startedAt;
      if (!failedDispatchStartedAt) return;
      const holdTimeout = window.setTimeout(() => {
        setLocalDispatch((current) => {
          if (
            !current ||
            current.startedAt !== failedDispatchStartedAt ||
            !worktreeSetupHasError(current.worktreeSetup)
          ) {
            return current;
          }
          failedWorktreeSetupDispatchStartedAtRef.current = null;
          return null;
        });
      }, WORKTREE_SETUP_ERROR_HOLD_MS);
      return () => window.clearTimeout(holdTimeout);
    }
    reset();
  }, [localDispatch?.startedAt, reset, serverAcknowledged, worktreeSetupFailed]);

  return {
    activeWorktreeSetup,
    begin,
    failWorktreeSetup,
    isPreparingWorktree: activeWorktreeSetup !== null,
    isSendBusy: localDispatch !== null && !serverAcknowledged,
    reset,
    scheduleFailedWorktreeSetupReset,
  };
}
