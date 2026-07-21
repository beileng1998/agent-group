// FILE: useQueuedComposerController.ts
// Purpose: Own queued composer steering, editing, and idle auto-dispatch.
// Layer: Web composer controller

import { type ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import {
  type QueuedComposerChatTurn,
  type QueuedComposerPlanFollowUp,
  type QueuedComposerTurn,
} from "../composerDraftStore";
import type { SessionPhase } from "../types";

type DispatchMode = "queue" | "steer";

interface QueuedComposerControllerInput {
  readonly threadId: ThreadId;
  readonly queuedTurns: readonly QueuedComposerTurn[];
  readonly phase: SessionPhase;
  readonly nonCodexSteerGateActive: boolean;
  readonly hasLiveTurn: boolean;
  readonly isSendBusy: boolean;
  readonly isConnecting: boolean;
  readonly hasPendingApproval: boolean;
  readonly hasPendingProgress: boolean;
  readonly pendingUserInputCount: number;
  readonly sendInFlightRef: MutableRefObject<boolean>;
  readonly isSendPreflightInFlight: () => boolean;
  readonly dispatchChat: (
    event: undefined,
    dispatchMode: DispatchMode,
    queuedTurn: QueuedComposerChatTurn,
  ) => Promise<boolean>;
  readonly dispatchPlanFollowUp: (input: {
    text: string;
    interactionMode: "default" | "plan";
    dispatchMode: DispatchMode;
    queuedTurn: QueuedComposerPlanFollowUp;
  }) => Promise<boolean>;
  readonly insertQueuedTurn: (threadId: ThreadId, turn: QueuedComposerTurn, index: number) => void;
  readonly removeQueuedTurn: (threadId: ThreadId, turnId: string) => void;
  readonly restoreQueuedTurn: (turn: QueuedComposerTurn) => void;
}

export function useQueuedComposerController(input: QueuedComposerControllerInput) {
  const queuedTurnsRef = useRef(input.queuedTurns);
  queuedTurnsRef.current = input.queuedTurns;
  const dispatchChatRef = useRef(input.dispatchChat);
  dispatchChatRef.current = input.dispatchChat;
  const dispatchPlanFollowUpRef = useRef(input.dispatchPlanFollowUp);
  dispatchPlanFollowUpRef.current = input.dispatchPlanFollowUp;
  const autoDispatchingRef = useRef(false);
  const [autoDispatchTick, setAutoDispatchTick] = useState(0);

  const dispatchQueuedTurn = useCallback(
    (queuedTurn: QueuedComposerTurn, dispatchMode: DispatchMode): Promise<boolean> => {
      if (queuedTurn.kind === "chat") {
        return dispatchChatRef.current(undefined, dispatchMode, queuedTurn);
      }
      return dispatchPlanFollowUpRef.current({
        text: queuedTurn.text,
        interactionMode: queuedTurn.interactionMode,
        dispatchMode,
        queuedTurn,
      });
    },
    [],
  );

  const removeQueuedTurn = useCallback(
    (queuedTurnId: string) => {
      input.removeQueuedTurn(input.threadId, queuedTurnId);
    },
    [input.removeQueuedTurn, input.threadId],
  );

  const steerQueuedTurn = useCallback(
    async (queuedTurn: QueuedComposerTurn) => {
      const previousQueue = queuedTurnsRef.current;
      const queuedIndex = previousQueue.findIndex((entry) => entry.id === queuedTurn.id);
      if (queuedIndex < 0) return;

      input.removeQueuedTurn(input.threadId, queuedTurn.id);
      const succeeded = await dispatchQueuedTurn(queuedTurn, "steer");
      if (!succeeded) {
        input.insertQueuedTurn(input.threadId, queuedTurn, queuedIndex);
      }
    },
    [dispatchQueuedTurn, input.insertQueuedTurn, input.removeQueuedTurn, input.threadId],
  );

  const editQueuedTurn = useCallback(
    (queuedTurn: QueuedComposerTurn) => {
      removeQueuedTurn(queuedTurn.id);
      input.restoreQueuedTurn(queuedTurn);
    },
    [input.restoreQueuedTurn, removeQueuedTurn],
  );

  useEffect(() => {
    autoDispatchingRef.current = false;
  }, [input.threadId]);

  useEffect(() => {
    if (
      input.hasLiveTurn ||
      input.phase === "disconnected" ||
      input.isSendBusy ||
      input.isConnecting ||
      input.nonCodexSteerGateActive ||
      input.hasPendingApproval ||
      input.hasPendingProgress ||
      input.pendingUserInputCount > 0 ||
      input.queuedTurns.length === 0
    ) {
      return;
    }
    if (
      autoDispatchingRef.current ||
      input.sendInFlightRef.current ||
      input.isSendPreflightInFlight()
    ) {
      const timer = window.setTimeout(() => setAutoDispatchTick((tick) => tick + 1), 250);
      return () => window.clearTimeout(timer);
    }
    const nextQueuedTurn = input.queuedTurns[0];
    if (!nextQueuedTurn) return;

    autoDispatchingRef.current = true;
    void (async () => {
      const succeeded = await dispatchQueuedTurn(nextQueuedTurn, "queue");
      if (succeeded) {
        input.removeQueuedTurn(input.threadId, nextQueuedTurn.id);
      }
      autoDispatchingRef.current = false;
    })();
  }, [
    autoDispatchTick,
    dispatchQueuedTurn,
    input.hasLiveTurn,
    input.hasPendingApproval,
    input.hasPendingProgress,
    input.isConnecting,
    input.isSendBusy,
    input.isSendPreflightInFlight,
    input.nonCodexSteerGateActive,
    input.pendingUserInputCount,
    input.phase,
    input.queuedTurns,
    input.removeQueuedTurn,
    input.sendInFlightRef,
    input.threadId,
  ]);

  return {
    editQueuedTurn,
    removeQueuedTurn,
    steerQueuedTurn,
  };
}
