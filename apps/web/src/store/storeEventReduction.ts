// FILE: storeEventReduction.ts
// Purpose: Dispatch orchestration events through ordered domain reducers.
// Layer: Web state event ingestion

import type { OrchestrationEvent } from "@agent-group/contracts";
import { normalizeActivities, withOrchestrationEventSequence } from "./storeActivityProjection";
import { reduceProjectThreadMetaEvent } from "./storeProjectThreadMetaEvents";
import { threadActivityUpdatesSummary } from "./storeSidebarProjection";
import type {
  AppState,
  ApplyOrchestrationEventOptions,
  ThreadActivityAppendedEvent,
} from "./storeState";
import { reduceThreadAnnotationEvent } from "./storeThreadAnnotationEvents";
import { reduceThreadHistoryEvent } from "./storeThreadHistoryEvents";
import { reduceThreadInteractionEvent } from "./storeThreadInteractionEvents";
import { reduceThreadLifecycleEvent } from "./storeThreadLifecycleEvents";
import { applyThreadUpdate } from "./storeTurnMutation";

function applyOrchestrationEvent(
  state: AppState,
  event: OrchestrationEvent,
  options?: ApplyOrchestrationEventOptions,
): AppState {
  return (
    reduceProjectThreadMetaEvent(state, event, options) ??
    reduceThreadAnnotationEvent(state, event, options) ??
    reduceThreadLifecycleEvent(state, event, options) ??
    reduceThreadInteractionEvent(state, event, options) ??
    reduceThreadHistoryEvent(state, event, options) ??
    state
  );
}

function applyThreadActivityEventBatch(
  state: AppState,
  events: ReadonlyArray<ThreadActivityAppendedEvent>,
  options: ApplyOrchestrationEventOptions,
): AppState {
  const firstEvent = events[0];
  if (!firstEvent) {
    return state;
  }
  const updatesSummary = events.some(threadActivityUpdatesSummary);
  return applyThreadUpdate(
    state,
    firstEvent.payload.threadId,
    (thread) => {
      let nextActivities = thread.activities;
      let updatedAt = thread.updatedAt ?? thread.createdAt;
      for (const event of events) {
        const sequencedActivity = withOrchestrationEventSequence(
          event.payload.activity,
          event.sequence,
        );
        const normalizedActivities = normalizeActivities(
          [...nextActivities, sequencedActivity],
          nextActivities,
        );
        if (normalizedActivities === nextActivities) {
          continue;
        }
        nextActivities = normalizedActivities;
        if (sequencedActivity.createdAt > updatedAt) {
          updatedAt = sequencedActivity.createdAt;
        }
      }
      if (nextActivities === thread.activities) {
        return thread;
      }
      return {
        ...thread,
        activities: nextActivities,
        updatedAt,
      };
    },
    {
      ...options,
      recomputeSummarySignals: updatesSummary,
      updateSidebarSummary: options.updateSidebarSummary === true || updatesSummary,
    },
  );
}

export function applyOrchestrationEvents(
  state: AppState,
  events: ReadonlyArray<OrchestrationEvent>,
): AppState {
  return applyOrchestrationEventsHotPath(state, events, {
    updateThreadArray: true,
    updateSidebarSummary: false,
  });
}

export function applyOrchestrationEventsHotPath(
  state: AppState,
  events: ReadonlyArray<OrchestrationEvent>,
  options?: ApplyOrchestrationEventOptions,
): AppState {
  const normalizedOptions = {
    updateThreadArray: options?.updateThreadArray ?? true,
    updateSidebarSummary: options?.updateSidebarSummary ?? false,
  };
  let nextState = state;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.type === "thread.activity-appended") {
      const activityEvents = [event];
      while (index + 1 < events.length) {
        const nextEvent = events[index + 1];
        if (
          nextEvent?.type !== "thread.activity-appended" ||
          nextEvent.payload.threadId !== event.payload.threadId
        ) {
          break;
        }
        activityEvents.push(nextEvent);
        index += 1;
      }
      nextState = applyThreadActivityEventBatch(nextState, activityEvents, normalizedOptions);
      continue;
    }
    nextState = applyOrchestrationEvent(nextState, event, normalizedOptions);
  }
  return nextState;
}
