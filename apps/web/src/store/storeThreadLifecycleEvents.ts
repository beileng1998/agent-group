// FILE: storeThreadLifecycleEvents.ts
// Purpose: Reduce provider session, stop, and Turn-start orchestration events.
// Layer: Web state event reducers

import type { OrchestrationEvent } from "@agent-group/contracts";
import { normalizeModelSelection } from "./storeEquality";
import { normalizeThreadErrorMessage } from "./storeActivityProjection";
import { normalizeThreadSession } from "./storeThreadNormalization";
import type { AppState, ApplyOrchestrationEventOptions } from "./storeState";
import {
  applyThreadUpdate,
  buildLatestTurn,
  reconcileLatestTurnFromSession,
} from "./storeTurnMutation";

export function reduceThreadLifecycleEvent(
  state: AppState,
  event: OrchestrationEvent,
  options?: ApplyOrchestrationEventOptions,
): AppState | undefined {
  switch (event.type) {
    case "thread.session-set":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const session = normalizeThreadSession(event.payload.session, thread.session);
          const error = normalizeThreadErrorMessage(event.payload.session.lastError);
          const latestTurn = reconcileLatestTurnFromSession(thread, event.payload.session, error);
          if (
            session === thread.session &&
            error === thread.error &&
            latestTurn === thread.latestTurn
          ) {
            return thread;
          }
          return {
            ...thread,
            session,
            error,
            latestTurn,
            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > event.occurredAt
                ? thread.updatedAt
                : event.occurredAt,
          };
        },
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    case "thread.turn-interrupt-requested": {
      // Interrupt requests are best-effort and can fail or time out. Keep the
      // latest-turn clock/state live until the provider confirms a terminal event.
      return state;
    }

    case "thread.session-stop-requested":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          if (thread.session === null) {
            return thread;
          }
          const latestTurn =
            thread.latestTurn !== null &&
            thread.latestTurn.state === "running" &&
            thread.latestTurn.completedAt === null
              ? buildLatestTurn({
                  previous: thread.latestTurn,
                  turnId: thread.latestTurn.turnId,
                  state: "interrupted",
                  requestedAt: thread.latestTurn.requestedAt,
                  startedAt: thread.latestTurn.startedAt ?? event.payload.createdAt,
                  completedAt: event.payload.createdAt,
                  assistantMessageId: thread.latestTurn.assistantMessageId,
                })
              : thread.latestTurn;
          return {
            ...thread,
            session: {
              ...thread.session,
              status: "closed",
              orchestrationStatus: "stopped",
              activeTurnId: undefined,
              updatedAt: event.payload.createdAt,
            },
            latestTurn,
            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > event.occurredAt
                ? thread.updatedAt
                : event.occurredAt,
          };
        },
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    case "thread.turn-start-requested":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const modelSelection =
            event.payload.modelSelection !== undefined
              ? normalizeModelSelection(event.payload.modelSelection, thread.modelSelection)
              : thread.modelSelection;
          if (
            modelSelection === thread.modelSelection &&
            thread.runtimeMode === event.payload.runtimeMode &&
            thread.interactionMode === event.payload.interactionMode &&
            thread.pendingSourceProposedPlan === event.payload.sourceProposedPlan &&
            (thread.updatedAt ?? thread.createdAt) >= event.payload.createdAt
          ) {
            return thread;
          }
          return {
            ...thread,
            modelSelection,
            runtimeMode: event.payload.runtimeMode,
            interactionMode: event.payload.interactionMode,
            pendingSourceProposedPlan: event.payload.sourceProposedPlan,
            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > event.payload.createdAt
                ? thread.updatedAt
                : event.payload.createdAt,
          };
        },
        {
          ...options,
          updateSidebarSummary: true,
        },
      );
    default:
      return undefined;
  }
}
