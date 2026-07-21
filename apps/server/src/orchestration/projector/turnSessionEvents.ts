import type { OrchestrationEvent, OrchestrationReadModel } from "@agent-group/contracts";
import { OrchestrationCheckpointSummary, OrchestrationSession } from "@agent-group/contracts";
import { Effect } from "effect";

import {
  ThreadProposedPlanUpsertedPayload,
  ThreadSessionSetPayload,
  ThreadTurnDiffCompletedPayload,
} from "../Schemas.ts";
import {
  checkpointStatusToLatestTurnState,
  decodeForEvent,
  isProviderDiffPlaceholderRef,
  isTerminalLatestTurn,
  MAX_THREAD_CHECKPOINTS,
  type ProjectorEffect,
  settleLatestTurnForSessionStatus,
  updateThread,
} from "./common.ts";

export type TurnSessionEvent = Extract<
  OrchestrationEvent,
  {
    type: "thread.session-set" | "thread.proposed-plan-upserted" | "thread.turn-diff-completed";
  }
>;

export function projectTurnSessionEvent(
  nextBase: OrchestrationReadModel,
  event: TurnSessionEvent,
): ProjectorEffect {
  switch (event.type) {
    case "thread.session-set":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadSessionSetPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const session: OrchestrationSession = yield* decodeForEvent(
          OrchestrationSession,
          payload.session,
          event.type,
          "session",
        );

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            session,
            latestTurn:
              session.status === "running" && session.activeTurnId !== null
                ? thread.latestTurn?.turnId === session.activeTurnId &&
                  isTerminalLatestTurn(thread.latestTurn)
                  ? thread.latestTurn
                  : {
                      turnId: session.activeTurnId,
                      state: "running",
                      requestedAt:
                        thread.latestTurn?.turnId === session.activeTurnId
                          ? thread.latestTurn.requestedAt
                          : session.updatedAt,
                      startedAt:
                        thread.latestTurn?.turnId === session.activeTurnId
                          ? (thread.latestTurn.startedAt ?? session.updatedAt)
                          : session.updatedAt,
                      completedAt: null,
                      assistantMessageId:
                        thread.latestTurn?.turnId === session.activeTurnId
                          ? thread.latestTurn.assistantMessageId
                          : null,
                    }
                : settleLatestTurnForSessionStatus(thread.latestTurn, session),
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.proposed-plan-upserted":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadProposedPlanUpsertedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const proposedPlans = [
          ...thread.proposedPlans.filter((entry) => entry.id !== payload.proposedPlan.id),
          payload.proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-200);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            proposedPlans,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.turn-diff-completed":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadTurnDiffCompletedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const checkpoint = yield* decodeForEvent(
          OrchestrationCheckpointSummary,
          {
            turnId: payload.turnId,
            checkpointTurnCount: payload.checkpointTurnCount,
            checkpointRef: payload.checkpointRef,
            status: payload.status,
            files: payload.files,
            assistantMessageId: payload.assistantMessageId,
            completedAt: payload.completedAt,
          },
          event.type,
          "checkpoint",
        );

        // A later provider placeholder must not clobber a captured checkpoint.
        const existing = thread.checkpoints.find((entry) => entry.turnId === checkpoint.turnId);
        if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
          return nextBase;
        }

        const checkpoints = [
          ...thread.checkpoints.filter((entry) => entry.turnId !== checkpoint.turnId),
          checkpoint,
        ]
          .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
          .slice(-MAX_THREAD_CHECKPOINTS);

        const preservedAssistantMessageId =
          payload.assistantMessageId ??
          (thread.latestTurn?.turnId === payload.turnId
            ? thread.latestTurn.assistantMessageId
            : null);
        const previousLatestCheckpointTurnCount = thread.checkpoints.find(
          (entry) => entry.turnId === thread.latestTurn?.turnId,
        )?.checkpointTurnCount;
        const preservesNewerLatestTurn =
          payload.preserveLatestTurn === true ||
          (previousLatestCheckpointTurnCount !== undefined &&
            previousLatestCheckpointTurnCount > payload.checkpointTurnCount);
        const latestTurn = preservesNewerLatestTurn
          ? thread.latestTurn
          : isProviderDiffPlaceholderRef(payload.checkpointRef) &&
              payload.status === "missing" &&
              thread.latestTurn?.turnId === payload.turnId
            ? thread.latestTurn
            : {
                turnId: payload.turnId,
                state: checkpointStatusToLatestTurnState(payload.status),
                requestedAt:
                  thread.latestTurn?.turnId === payload.turnId
                    ? thread.latestTurn.requestedAt
                    : payload.completedAt,
                startedAt:
                  thread.latestTurn?.turnId === payload.turnId
                    ? (thread.latestTurn.startedAt ?? payload.completedAt)
                    : payload.completedAt,
                completedAt: payload.completedAt,
                assistantMessageId: preservedAssistantMessageId,
              };

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            checkpoints,
            latestTurn,
            updatedAt: event.occurredAt,
          }),
        };
      });
  }
}
