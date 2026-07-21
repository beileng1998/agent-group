// FILE: storeThreadHistoryEvents.ts
// Purpose: Reduce Turn diffs, history rollback, and archive state events.
// Layer: Web state event reducers

import type { OrchestrationEvent } from "@agent-group/contracts";
import {
  MAX_THREAD_MESSAGES,
  type AppState,
  type ApplyOrchestrationEventOptions,
} from "./storeState";
import {
  applyThreadUpdate,
  applyTurnDiffSummaryToThread,
  checkpointStatusToLatestTurnState,
  retainThreadActivitiesAfterRevert,
  retainThreadMessagesAfterRevert,
  retainThreadProposedPlansAfterRevert,
  rollbackThreadMessagesFromMessage,
} from "./storeTurnMutation";

export function reduceThreadHistoryEvent(
  state: AppState,
  event: OrchestrationEvent,
  options?: ApplyOrchestrationEventOptions,
): AppState | undefined {
  switch (event.type) {
    case "thread.turn-diff-completed":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) =>
          applyTurnDiffSummaryToThread(thread, {
            turnId: event.payload.turnId,
            completedAt: event.payload.completedAt,
            status: event.payload.status,
            files: event.payload.files.map((file) => ({
              path: file.path,
              ...(file.kind !== undefined ? { kind: file.kind } : {}),
              ...(file.additions !== undefined ? { additions: file.additions } : {}),
              ...(file.deletions !== undefined ? { deletions: file.deletions } : {}),
            })),
            checkpointRef: event.payload.checkpointRef,
            assistantMessageId: event.payload.assistantMessageId ?? undefined,
            checkpointTurnCount: event.payload.checkpointTurnCount,
          }),
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    case "thread.reverted":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const turnDiffSummaries = thread.turnDiffSummaries
            .filter(
              (entry) =>
                entry.checkpointTurnCount !== undefined &&
                entry.checkpointTurnCount <= event.payload.turnCount,
            )
            .toSorted(
              (left, right) =>
                (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
                (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER),
            );
          const retainedTurnIds = new Set(turnDiffSummaries.map((entry) => entry.turnId));
          const messages = retainThreadMessagesAfterRevert(
            thread.messages,
            retainedTurnIds,
            event.payload.turnCount,
          ).slice(-MAX_THREAD_MESSAGES);
          const proposedPlans = retainThreadProposedPlansAfterRevert(
            thread.proposedPlans,
            retainedTurnIds,
          );
          const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);
          const latestCheckpoint = turnDiffSummaries.at(-1) ?? null;

          return {
            ...thread,
            turnDiffSummaries,
            messages,
            proposedPlans,
            activities,
            pendingSourceProposedPlan: undefined,
            latestTurn:
              latestCheckpoint === null
                ? null
                : {
                    turnId: latestCheckpoint.turnId,
                    state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                    requestedAt: latestCheckpoint.completedAt,
                    startedAt: latestCheckpoint.completedAt,
                    completedAt: latestCheckpoint.completedAt,
                    assistantMessageId: latestCheckpoint.assistantMessageId ?? null,
                  },
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

    case "thread.conversation-rolled-back":
      if (event.payload.numTurns === 0) {
        return state;
      }
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const rollback = rollbackThreadMessagesFromMessage(
            thread.messages,
            event.payload.messageId,
          );
          const removedTurnIds = new Set([
            ...rollback.removedTurnIds,
            ...(event.payload.removedTurnIds ?? []),
          ]);
          if (rollback.messages.length === thread.messages.length && removedTurnIds.size === 0) {
            return thread;
          }

          const turnDiffSummaries = thread.turnDiffSummaries
            .filter((entry) => !removedTurnIds.has(entry.turnId))
            .toSorted(
              (left, right) =>
                (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
                (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER),
            );
          const proposedPlans = thread.proposedPlans.filter(
            (plan) => plan.turnId === null || !removedTurnIds.has(plan.turnId),
          );
          const activities = thread.activities.filter(
            (activity) => activity.turnId === null || !removedTurnIds.has(activity.turnId),
          );
          const latestCheckpoint = turnDiffSummaries.at(-1) ?? null;

          return {
            ...thread,
            turnDiffSummaries,
            messages: rollback.messages.slice(-MAX_THREAD_MESSAGES),
            proposedPlans,
            activities,
            pendingSourceProposedPlan: undefined,
            latestTurn:
              latestCheckpoint === null
                ? null
                : {
                    turnId: latestCheckpoint.turnId,
                    state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                    requestedAt: latestCheckpoint.completedAt,
                    startedAt: latestCheckpoint.completedAt,
                    completedAt: latestCheckpoint.completedAt,
                    assistantMessageId: latestCheckpoint.assistantMessageId ?? null,
                  },
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

    case "thread.archived":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => ({
          ...thread,
          archivedAt: event.payload.archivedAt ?? event.occurredAt,
          updatedAt: event.payload.updatedAt ?? event.occurredAt,
        }),
        {
          ...options,
          updateSidebarSummary: true,
        },
      );

    case "thread.unarchived":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => ({
          ...thread,
          archivedAt: null,
          updatedAt: event.payload.updatedAt ?? event.occurredAt,
        }),
        {
          ...options,
          updateSidebarSummary: true,
        },
      );
    default:
      return undefined;
  }
}
