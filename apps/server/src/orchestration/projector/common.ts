import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationSession,
  OrchestrationThread,
  ThreadId,
} from "@agent-group/contracts";
import { Effect, Schema } from "effect";

import { toProjectorDecodeError, type OrchestrationProjectorDecodeError } from "../Errors.ts";

type ThreadPatch = Partial<Omit<OrchestrationThread, "id" | "projectId">>;

export const MAX_THREAD_MESSAGES = 2_000;
export const MAX_THREAD_ACTIVITIES = 500;
export const MAX_THREAD_CHECKPOINTS = 500;

export type ProjectorEffect = Effect.Effect<
  OrchestrationReadModel,
  OrchestrationProjectorDecodeError
>;

export function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") return "error" as const;
  if (status === "missing") return "interrupted" as const;
  return "completed" as const;
}

export function isProviderDiffPlaceholderRef(checkpointRef: string | null | undefined): boolean {
  return checkpointRef?.startsWith("provider-diff:") === true;
}

export function isTerminalLatestTurn(
  latestTurn: OrchestrationThread["latestTurn"] | null | undefined,
): boolean {
  if (!latestTurn?.completedAt) {
    return false;
  }
  return latestTurn.state === "completed" || latestTurn.state === "error";
}

// Turn lifecycle must settle with the session: once a session leaves "running",
// no provider event will ever mark the turn complete on its own, so a running
// latestTurn is settled here. Checkpoint diff events only enrich terminal state.
export function settleLatestTurnForSessionStatus(
  latestTurn: OrchestrationThread["latestTurn"],
  session: Pick<OrchestrationSession, "status" | "activeTurnId" | "updatedAt">,
): OrchestrationThread["latestTurn"] {
  if (latestTurn?.state !== "running") {
    return latestTurn;
  }
  const settledState =
    session.status === "error"
      ? ("error" as const)
      : session.status === "interrupted" || session.status === "stopped"
        ? ("interrupted" as const)
        : session.status === "ready"
          ? ("completed" as const)
          : null;
  if (settledState === null) {
    return latestTurn;
  }
  if (session.activeTurnId !== null && settledState !== "error") {
    return latestTurn;
  }
  return {
    ...latestTurn,
    state: settledState,
    completedAt: latestTurn.completedAt ?? session.updatedAt,
  };
}

export function updateThread(
  threads: ReadonlyArray<OrchestrationThread>,
  threadId: ThreadId,
  patch: ThreadPatch,
): OrchestrationThread[] {
  return threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread));
}

export function decodeForEvent<A>(
  schema: Schema.Schema<A>,
  value: unknown,
  eventType: OrchestrationEvent["type"],
  field: string,
): Effect.Effect<A, OrchestrationProjectorDecodeError> {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema as any)(value),
    catch: (error) => toProjectorDecodeError(`${eventType}:${field}`)(error as Schema.SchemaError),
  });
}

function compareThreadActivities(
  left: OrchestrationThread["activities"][number],
  right: OrchestrationThread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function upsertThreadActivity(
  activities: ReadonlyArray<OrchestrationThread["activities"][number]>,
  activity: OrchestrationThread["activities"][number],
): ReadonlyArray<OrchestrationThread["activities"][number]> {
  const existingIndex = activities.findIndex((entry) => entry.id === activity.id);
  if (existingIndex >= 0 && compareThreadActivities(activities[existingIndex]!, activity) === 0) {
    const next = [...activities];
    next[existingIndex] = activity;
    return next.slice(-MAX_THREAD_ACTIVITIES);
  }

  const withoutExisting =
    existingIndex < 0
      ? activities
      : [...activities.slice(0, existingIndex), ...activities.slice(existingIndex + 1)];
  const last = withoutExisting.at(-1);
  if (!last || compareThreadActivities(last, activity) <= 0) {
    return [...withoutExisting, activity].slice(-MAX_THREAD_ACTIVITIES);
  }

  let low = 0;
  let high = withoutExisting.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareThreadActivities(withoutExisting[middle]!, activity) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return [...withoutExisting.slice(0, low), activity, ...withoutExisting.slice(low)].slice(
    -MAX_THREAD_ACTIVITIES,
  );
}
