import {
  ApprovalRequestId,
  EventId,
  type OrchestrationThreadActivity,
} from "@agent-group/contracts";
import { deriveThreadSummaryState } from "@agent-group/shared/threadSummary";
import { Effect, Option } from "effect";

import { ProjectionPendingApprovalRepository } from "../../../persistence/Services/ProjectionPendingApprovals.ts";
import { ProjectionThreadActivityRepository } from "../../../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadMessageRepository } from "../../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlanRepository } from "../../../persistence/Services/ProjectionThreadProposedPlans.ts";
import {
  type ProjectionThread,
  ProjectionThreadRepository,
} from "../../../persistence/Services/ProjectionThreads.ts";
import { shouldRefreshThreadShellSummary } from "../../threadShellEvents.ts";
import type { ProjectorDefinition } from "./projectorDefinitions.ts";

function extractActivityRequestId(payload: unknown): ApprovalRequestId | null {
  if (typeof payload !== "object" || payload === null) return null;
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? ApprovalRequestId.makeUnsafe(requestId) : null;
}

export const makeThreadShellSummaryProjection = Effect.gen(function* () {
  const threadRepository = yield* ProjectionThreadRepository;
  const messageRepository = yield* ProjectionThreadMessageRepository;
  const activityRepository = yield* ProjectionThreadActivityRepository;
  const proposedPlanRepository = yield* ProjectionThreadProposedPlanRepository;
  const pendingApprovalRepository = yield* ProjectionPendingApprovalRepository;

  const refresh = Effect.fn(function* (input: {
    readonly thread: ProjectionThread;
    readonly summaryUserInputResponseRequestId?: string;
    readonly summaryUserInputResponseCreatedAt?: string;
  }) {
    const [latestUserMessageAt, activities, proposedPlans, pendingApprovals] = yield* Effect.all([
      messageRepository.getLatestUserMessageAt({ threadId: input.thread.threadId }),
      activityRepository.listSummaryByThreadId({ threadId: input.thread.threadId }),
      proposedPlanRepository.listSummaryByThreadId({ threadId: input.thread.threadId }),
      pendingApprovalRepository.listByThreadId({ threadId: input.thread.threadId }),
    ]);
    const summary = deriveThreadSummaryState({
      messages:
        latestUserMessageAt === null
          ? []
          : [{ role: "user" as const, createdAt: latestUserMessageAt }],
      activities: [
        ...activities.map((activity) => ({
          id: activity.activityId,
          kind: activity.kind,
          payload: activity.payload as OrchestrationThreadActivity["payload"],
          sequence: activity.sequence,
          createdAt: activity.createdAt,
        })),
        ...(input.summaryUserInputResponseRequestId
          ? [
              {
                id: EventId.makeUnsafe(
                  `synthetic-user-input-resolved:${input.summaryUserInputResponseRequestId}:${input.summaryUserInputResponseCreatedAt ?? input.thread.updatedAt}`,
                ),
                kind: "user-input.resolved" as const,
                payload: { requestId: input.summaryUserInputResponseRequestId },
                createdAt: input.summaryUserInputResponseCreatedAt ?? input.thread.updatedAt,
              },
            ]
          : []),
      ],
      proposedPlans: proposedPlans.map((plan) => ({
        id: plan.planId,
        turnId: plan.turnId,
        updatedAt: plan.updatedAt,
        implementedAt: plan.implementedAt,
      })),
      latestTurn: input.thread.latestTurnId ? { turnId: input.thread.latestTurnId } : null,
    });
    const requestedApprovalIds = new Set(
      activities
        .filter((activity) => activity.kind === "approval.requested")
        .map((activity) => extractActivityRequestId(activity.payload))
        .filter((requestId): requestId is ApprovalRequestId => requestId !== null),
    );
    const pendingApprovalCount = pendingApprovals.filter(
      (approval) => approval.status === "pending" && requestedApprovalIds.has(approval.requestId),
    ).length;
    return {
      ...input.thread,
      latestUserMessageAt: summary.latestUserMessageAt,
      pendingApprovalCount,
      pendingUserInputCount: summary.pendingUserInputCount,
      hasActionableProposedPlan: summary.hasActionableProposedPlan ? 1 : 0,
    } satisfies ProjectionThread;
  });

  const apply: ProjectorDefinition["apply"] = (event) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.message-sent":
        case "thread.proposed-plan-upserted":
        case "thread.activity-appended":
        case "thread.approval-response-requested":
        case "thread.user-input-response-requested":
        case "thread.reverted":
        case "thread.conversation-rolled-back": {
          if (!shouldRefreshThreadShellSummary(event)) return;
          const existingRow = yield* threadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return;
          const nextRow = yield* refresh({
            thread: {
              ...existingRow.value,
              updatedAt: event.occurredAt,
              latestTurnId:
                event.type === "thread.reverted" || event.type === "thread.conversation-rolled-back"
                  ? null
                  : existingRow.value.latestTurnId,
            },
            ...(event.type === "thread.user-input-response-requested"
              ? {
                  summaryUserInputResponseRequestId: event.payload.requestId,
                  summaryUserInputResponseCreatedAt: event.payload.createdAt,
                }
              : {}),
          });
          yield* threadRepository.upsert(nextRow);
          return;
        }
        case "thread.session-set": {
          const existingRow = yield* threadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return;
          yield* threadRepository.upsert(
            yield* refresh({
              thread: {
                ...existingRow.value,
                latestTurnId: event.payload.session.activeTurnId,
                updatedAt: event.occurredAt,
              },
            }),
          );
          return;
        }
        case "thread.turn-diff-completed": {
          const existingRow = yield* threadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return;
          yield* threadRepository.upsert(
            yield* refresh({
              thread: {
                ...existingRow.value,
                latestTurnId: event.payload.preserveLatestTurn
                  ? existingRow.value.latestTurnId
                  : event.payload.turnId,
                updatedAt: event.occurredAt,
              },
            }),
          );
          return;
        }
        default:
          return;
      }
    });

  return apply;
});
