import type { OrchestrationEvent, OrchestrationReadModel } from "@agent-group/contracts";
import { Effect } from "effect";

import { ThreadConversationRolledBackPayload, ThreadRevertedPayload } from "../Schemas.ts";
import {
  checkpointStatusToLatestTurnState,
  decodeForEvent,
  MAX_THREAD_CHECKPOINTS,
  MAX_THREAD_MESSAGES,
  type ProjectorEffect,
  updateThread,
} from "./common.ts";
import {
  retainThreadActivitiesAfterRevert,
  retainThreadMessagesAfterRevert,
  retainThreadProposedPlansAfterRevert,
  rollbackThreadMessagesFromMessage,
} from "./rollbackRetention.ts";

export type RollbackEvent = Extract<
  OrchestrationEvent,
  { type: "thread.reverted" | "thread.conversation-rolled-back" }
>;

export function projectRollbackEvent(
  nextBase: OrchestrationReadModel,
  event: RollbackEvent,
): ProjectorEffect {
  switch (event.type) {
    case "thread.reverted":
      return decodeForEvent(ThreadRevertedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const checkpoints = thread.checkpoints
            .filter((entry) => entry.checkpointTurnCount <= payload.turnCount)
            .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
            .slice(-MAX_THREAD_CHECKPOINTS);
          const retainedTurnIds = new Set(checkpoints.map((checkpoint) => checkpoint.turnId));
          const messages = retainThreadMessagesAfterRevert(
            thread.messages,
            retainedTurnIds,
            payload.turnCount,
          ).slice(-MAX_THREAD_MESSAGES);
          const proposedPlans = retainThreadProposedPlansAfterRevert(
            thread.proposedPlans,
            retainedTurnIds,
          ).slice(-200);
          const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);

          const latestCheckpoint = checkpoints.at(-1) ?? null;
          const latestTurn =
            latestCheckpoint === null
              ? null
              : {
                  turnId: latestCheckpoint.turnId,
                  state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                  requestedAt: latestCheckpoint.completedAt,
                  startedAt: latestCheckpoint.completedAt,
                  completedAt: latestCheckpoint.completedAt,
                  assistantMessageId: latestCheckpoint.assistantMessageId,
                };

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              checkpoints,
              messages,
              proposedPlans,
              activities,
              latestTurn,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "thread.conversation-rolled-back":
      return decodeForEvent(
        ThreadConversationRolledBackPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          if (payload.numTurns === 0) {
            return nextBase;
          }
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const rollback = rollbackThreadMessagesFromMessage(thread.messages, payload.messageId);
          if (rollback.messages === thread.messages) {
            return nextBase;
          }

          const checkpoints = thread.checkpoints
            .filter((checkpoint) => !rollback.removedTurnIds.has(checkpoint.turnId))
            .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
            .slice(-MAX_THREAD_CHECKPOINTS);
          const proposedPlans = thread.proposedPlans
            .filter((plan) => plan.turnId === null || !rollback.removedTurnIds.has(plan.turnId))
            .slice(-200);
          const activities = thread.activities.filter(
            (activity) => activity.turnId === null || !rollback.removedTurnIds.has(activity.turnId),
          );
          const latestCheckpoint = checkpoints.at(-1) ?? null;

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              checkpoints,
              messages: rollback.messages.slice(-MAX_THREAD_MESSAGES),
              proposedPlans,
              activities,
              latestTurn:
                latestCheckpoint === null
                  ? null
                  : {
                      turnId: latestCheckpoint.turnId,
                      state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                      requestedAt: latestCheckpoint.completedAt,
                      startedAt: latestCheckpoint.completedAt,
                      completedAt: latestCheckpoint.completedAt,
                      assistantMessageId: latestCheckpoint.assistantMessageId,
                    },
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );
  }
}
