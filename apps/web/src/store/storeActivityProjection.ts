// FILE: storeActivityProjection.ts
// Purpose: Normalize, deduplicate, cap, and enrich orchestration activity rows.
// Layer: Web state activity projection

import type { OrchestrationThreadActivity } from "@agent-group/contracts";
import { isStalePendingRequestFailureDetail } from "../lib/pendingInteraction";
import type { Thread } from "../types";
import { arraysShallowEqual, deepEqualJson } from "./storeEquality";
import {
  MAX_THREAD_ACTIVITIES,
  PENDING_INTERACTION_REQUEST_KINDS,
  type ReadModelThread,
} from "./storeState";

export function normalizeActivities(
  incoming: ReadModelThread["activities"],
  previous: Thread["activities"] | undefined,
): Thread["activities"] {
  const previousActivities = previous ? dedupeActivitiesById(previous) : undefined;
  const incomingActivities = dedupeActivitiesById(incoming);
  const previousById = new Map(
    previousActivities?.map((activity) => [activity.id, activity] as const),
  );
  const nextActivities = incomingActivities.map((activity) => {
    const existing = previousById.get(activity.id);
    if (existing) {
      const preferred = preferRicherActivity(existing, activity);
      if (preferred === existing || activitiesEqual(existing, preferred)) return existing;
      return preferred;
    }
    return activity;
  });
  const cappedActivities = capThreadActivities(nextActivities);
  return arraysShallowEqual(previous, cappedActivities) ? previous : cappedActivities;
}

export function withOrchestrationEventSequence(
  activity: OrchestrationThreadActivity,
  sequence: number,
): OrchestrationThreadActivity {
  return { ...activity, sequence };
}

export function capThreadActivities<TActivity extends Thread["activities"][number]>(
  activities: readonly TActivity[],
): TActivity[] {
  if (activities.length <= MAX_THREAD_ACTIVITIES) return activities as TActivity[];
  const retainedIds = new Set(
    activities.slice(-MAX_THREAD_ACTIVITIES).map((activity) => activity.id),
  );
  const pendingRequestIds = pendingInteractionRequestIds(activities);
  for (const activity of activities) {
    const requestId = activityRequestId(activity);
    if (
      requestId !== null &&
      pendingRequestIds.has(requestId) &&
      PENDING_INTERACTION_REQUEST_KINDS.has(activity.kind)
    ) {
      retainedIds.add(activity.id);
    }
  }
  return activities.filter((activity) => retainedIds.has(activity.id));
}

function activityRequestId(activity: Thread["activities"][number]): string | null {
  const requestId = asActivityRecord(activity.payload)?.requestId;
  return typeof requestId === "string" && requestId.trim().length > 0 ? requestId : null;
}

function pendingInteractionRequestIds(
  activities: readonly Thread["activities"][number][],
): Set<string> {
  const pendingRequestIds = new Set<string>();
  for (const activity of activities) {
    const requestId = activityRequestId(activity);
    if (requestId === null) continue;
    if (activity.kind === "approval.requested" || activity.kind === "user-input.requested") {
      pendingRequestIds.add(requestId);
      continue;
    }
    if (activity.kind === "approval.resolved" || activity.kind === "user-input.resolved") {
      pendingRequestIds.delete(requestId);
      continue;
    }
    if (
      (activity.kind === "provider.approval.respond.failed" ||
        activity.kind === "provider.user-input.respond.failed") &&
      isStalePendingRequestFailureDetail(asActivityRecord(activity.payload)?.detail)
    ) {
      pendingRequestIds.delete(requestId);
    }
  }
  return pendingRequestIds;
}

export function dedupeActivitiesById<TActivity extends Thread["activities"][number]>(
  activities: ReadonlyArray<TActivity>,
): TActivity[] {
  const indexById = new Map<string, number>();
  const result: TActivity[] = [];
  for (const activity of activities) {
    const existingIndex = indexById.get(activity.id);
    if (existingIndex === undefined) {
      indexById.set(activity.id, result.length);
      result.push(activity);
      continue;
    }
    result[existingIndex] = preferRicherActivity(result[existingIndex]!, activity);
  }
  return arraysShallowEqual(activities, result) ? (activities as TActivity[]) : result;
}

function preferRicherActivity<TActivity extends Thread["activities"][number]>(
  previous: TActivity,
  incoming: TActivity,
): TActivity {
  if (activitiesEqual(previous, incoming)) return previous;
  return activityPayloadDetailScore(incoming) < activityPayloadDetailScore(previous)
    ? previous
    : incoming;
}

function activitiesEqual(
  left: Thread["activities"][number],
  right: Thread["activities"][number],
): boolean {
  return (
    left.kind === right.kind &&
    left.tone === right.tone &&
    left.summary === right.summary &&
    deepEqualJson(left.payload, right.payload) &&
    left.turnId === right.turnId &&
    left.sequence === right.sequence &&
    left.createdAt === right.createdAt
  );
}

function activityPayloadDetailScore(activity: Thread["activities"][number]): number {
  const payload = asActivityRecord(activity.payload);
  const data = asActivityRecord(payload?.data);
  const item = asActivityRecord(data?.item);
  const commandActions = item?.commandActions ?? data?.commandActions ?? payload?.commandActions;
  let score = 0;
  if (payload?.itemType) score += 4;
  if (payload?.title) score += 1;
  if (payload?.detail) score += 2;
  if (data) score += 2;
  if (item) score += 4;
  if (normalizeActivityCommandValue(item?.command ?? data?.command ?? payload?.command)) score += 8;
  if (Array.isArray(commandActions) && commandActions.length > 0) score += 8;
  return score;
}

function asActivityRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeActivityCommandValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!Array.isArray(value)) return null;
  const parts = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return parts.length > 0 ? parts.join(" ") : null;
}

export function isNonFatalThreadErrorMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return message
    .trim()
    .toLowerCase()
    .includes("write_stdin failed: stdin is closed for this session");
}

export function normalizeThreadErrorMessage(message: string | null | undefined): string | null {
  return message && !isNonFatalThreadErrorMessage(message) ? message : null;
}
