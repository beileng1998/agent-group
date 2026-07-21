// FILE: storeThreadInteractionEvents.ts
// Purpose: Reduce provider interaction, activity, and proposed-plan events.
// Layer: Web state event reducers

import { EventId, type OrchestrationEvent } from "@agent-group/contracts";
import type { Thread } from "../types";
import { normalizeActivities, withOrchestrationEventSequence } from "./storeActivityProjection";
import { arraysShallowEqual } from "./storeEquality";
import {
  resolveThreadSummaryAfterApprovalResponseRequested,
  resolveThreadSummaryAfterUserInputResponseRequested,
  threadActivityUpdatesSummary,
} from "./storeSidebarProjection";
import type { AppState, ApplyOrchestrationEventOptions } from "./storeState";
import { normalizeProposedPlans } from "./storeTurnProjection";
import { applyThreadUpdate } from "./storeTurnMutation";

export function reduceThreadInteractionEvent(
  state: AppState,
  event: OrchestrationEvent,
  options?: ApplyOrchestrationEventOptions,
): AppState | undefined {
  switch (event.type) {
    case "thread.user-input-response-requested":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          // Hide the composer prompt as soon as the response command is accepted;
          // the provider may append its own resolved activity shortly after.
          const syntheticResolvedActivity = {
            id: EventId.makeUnsafe(
              `synthetic-user-input-resolved:${event.payload.requestId}:${event.sequence}`,
            ),
            tone: "info",
            kind: "user-input.resolved",
            summary: "User input submitted",
            payload: {
              requestId: event.payload.requestId,
            },
            turnId: null,
            sequence: event.sequence,
            createdAt: event.payload.createdAt,
          } satisfies Thread["activities"][number];
          const hasResolvedActivity = thread.activities.some(
            (activity) => activity.id === syntheticResolvedActivity.id,
          );
          const activities = hasResolvedActivity
            ? thread.activities
            : [...thread.activities, syntheticResolvedActivity];
          const summary = resolveThreadSummaryAfterUserInputResponseRequested(thread, event);
          return {
            ...thread,
            activities,
            hasPendingUserInput: summary.hasPendingUserInput,
            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > event.payload.createdAt
                ? thread.updatedAt
                : event.payload.createdAt,
          };
        },
        {
          ...options,
          recomputeSummarySignals: false,
          updateSidebarSummary: true,
        },
      );

    case "thread.approval-response-requested":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const summary = resolveThreadSummaryAfterApprovalResponseRequested(thread, event);
          return {
            ...thread,
            hasPendingApprovals: summary.hasPendingApprovals,
            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > event.payload.createdAt
                ? thread.updatedAt
                : event.payload.createdAt,
          };
        },
        {
          ...options,
          recomputeSummarySignals: false,
          updateSidebarSummary: true,
        },
      );

    case "thread.activity-appended":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const sequencedActivity = withOrchestrationEventSequence(
            event.payload.activity,
            event.sequence,
          );
          const nextActivities = normalizeActivities(
            [...thread.activities, sequencedActivity],
            thread.activities,
          );
          if (nextActivities === thread.activities) {
            return thread;
          }
          return {
            ...thread,
            activities: nextActivities,
            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > sequencedActivity.createdAt
                ? thread.updatedAt
                : sequencedActivity.createdAt,
          };
        },
        {
          ...options,
          recomputeSummarySignals: threadActivityUpdatesSummary(event),
          updateSidebarSummary:
            options?.updateSidebarSummary === true || threadActivityUpdatesSummary(event),
        },
      );

    case "thread.proposed-plan-upserted":
      return applyThreadUpdate(
        state,
        event.payload.threadId,
        (thread) => {
          const previousPlanIndex = thread.proposedPlans.findIndex(
            (plan) => plan.id === event.payload.proposedPlan.id,
          );
          const nextPlan = normalizeProposedPlans(
            [event.payload.proposedPlan],
            previousPlanIndex >= 0 ? [thread.proposedPlans[previousPlanIndex]!] : undefined,
          )[0];
          if (!nextPlan) {
            return thread;
          }
          const proposedPlans =
            previousPlanIndex >= 0
              ? thread.proposedPlans.map((plan, index) =>
                  index === previousPlanIndex ? nextPlan : plan,
                )
              : [...thread.proposedPlans, nextPlan];
          if (arraysShallowEqual(thread.proposedPlans, proposedPlans)) {
            return thread;
          }
          return {
            ...thread,
            proposedPlans,
            updatedAt:
              (thread.updatedAt ?? thread.createdAt) > event.payload.proposedPlan.updatedAt
                ? thread.updatedAt
                : event.payload.proposedPlan.updatedAt,
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
