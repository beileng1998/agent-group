import { Effect } from "effect";

import { ProjectionThreadActivityRepository } from "../../../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadProposedPlanRepository } from "../../../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionTurnRepository } from "../../../persistence/Services/ProjectionTurns.ts";
import type { ProjectorDefinition } from "./projectorDefinitions.ts";
import {
  retainProjectionActivitiesAfterConversationRollback,
  retainProjectionActivitiesAfterRevert,
  retainProjectionProposedPlansAfterConversationRollback,
  retainProjectionProposedPlansAfterRevert,
} from "./rollbackRetention.ts";

export const makeThreadPlanActivityProjections = Effect.gen(function* () {
  const planRepository = yield* ProjectionThreadProposedPlanRepository;
  const activityRepository = yield* ProjectionThreadActivityRepository;
  const turnRepository = yield* ProjectionTurnRepository;

  const threadProposedPlans: ProjectorDefinition["apply"] = (event) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.proposed-plan-upserted":
          yield* planRepository.upsert({
            planId: event.payload.proposedPlan.id,
            threadId: event.payload.threadId,
            turnId: event.payload.proposedPlan.turnId,
            planMarkdown: event.payload.proposedPlan.planMarkdown,
            implementedAt: event.payload.proposedPlan.implementedAt,
            implementationThreadId: event.payload.proposedPlan.implementationThreadId,
            createdAt: event.payload.proposedPlan.createdAt,
            updatedAt: event.payload.proposedPlan.updatedAt,
          });
          return;
        case "thread.reverted": {
          const existingRows = yield* planRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) return;
          const existingTurns = yield* turnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionProposedPlansAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) return;
          yield* planRepository.deleteByThreadId({ threadId: event.payload.threadId });
          yield* Effect.forEach(keptRows, planRepository.upsert, { concurrency: 1 }).pipe(
            Effect.asVoid,
          );
          return;
        }
        case "thread.conversation-rolled-back": {
          const existingRows = yield* planRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) return;
          const keptRows = retainProjectionProposedPlansAfterConversationRollback(
            existingRows,
            new Set(event.payload.removedTurnIds ?? []),
          );
          if (keptRows.length === existingRows.length) return;
          yield* planRepository.deleteByThreadId({ threadId: event.payload.threadId });
          yield* Effect.forEach(keptRows, planRepository.upsert, { concurrency: 1 }).pipe(
            Effect.asVoid,
          );
          return;
        }
        default:
          return;
      }
    });

  const threadActivities: ProjectorDefinition["apply"] = (event) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.activity-appended":
          yield* activityRepository.upsert({
            activityId: event.payload.activity.id,
            threadId: event.payload.threadId,
            turnId: event.payload.activity.turnId,
            tone: event.payload.activity.tone,
            kind: event.payload.activity.kind,
            summary: event.payload.activity.summary,
            payload: event.payload.activity.payload,
            sequence: event.sequence,
            createdAt: event.payload.activity.createdAt,
          });
          return;
        case "thread.reverted": {
          const existingRows = yield* activityRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) return;
          const existingTurns = yield* turnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionActivitiesAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) return;
          yield* activityRepository.deleteByThreadId({ threadId: event.payload.threadId });
          yield* Effect.forEach(keptRows, activityRepository.upsert, { concurrency: 1 }).pipe(
            Effect.asVoid,
          );
          return;
        }
        case "thread.conversation-rolled-back": {
          const existingRows = yield* activityRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) return;
          const keptRows = retainProjectionActivitiesAfterConversationRollback(
            existingRows,
            new Set(event.payload.removedTurnIds ?? []),
          );
          if (keptRows.length === existingRows.length) return;
          yield* activityRepository.deleteByThreadId({ threadId: event.payload.threadId });
          yield* Effect.forEach(keptRows, activityRepository.upsert, { concurrency: 1 }).pipe(
            Effect.asVoid,
          );
          return;
        }
        default:
          return;
      }
    });

  return { threadProposedPlans, threadActivities };
});
