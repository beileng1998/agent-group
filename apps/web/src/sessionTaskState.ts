import type {
  OrchestrationLatestTurn,
  OrchestrationThreadActivity,
  TurnId,
} from "@agent-group/contracts";
import { orderedActivities } from "./sessionActivityOrder";
import type { ActiveBackgroundTasksState, ActiveTaskListState } from "./sessionTypes";
import type { ChatMessage, ThreadSession } from "./types";

function toActiveTaskListState(activity: OrchestrationThreadActivity): ActiveTaskListState | null {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const rawTasks = payload?.tasks;
  if (!Array.isArray(rawTasks)) {
    return null;
  }
  const tasks = rawTasks
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      if (typeof record.task !== "string") {
        return null;
      }
      const status =
        record.status === "completed" || record.status === "inProgress" ? record.status : "pending";
      return {
        task: record.task,
        status,
      };
    })
    .filter(
      (
        task,
      ): task is {
        task: string;
        status: "pending" | "inProgress" | "completed";
      } => task !== null,
    );
  if (rawTasks.length > 0 && tasks.length === 0) {
    return null;
  }
  return {
    createdAt: activity.createdAt,
    turnId: activity.turnId,
    ...(payload && "explanation" in payload
      ? { explanation: payload.explanation as string | null }
      : {}),
    tasks,
  };
}

export function deriveActiveTaskListState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): ActiveTaskListState | null {
  const ordered = orderedActivities(activities);
  const allTaskListActivities = ordered.filter(
    (activity) => activity.kind === "turn.tasks.updated",
  );

  const currentTurnTaskList = latestTurnId
    ? (allTaskListActivities
        .filter((activity) => activity.turnId === latestTurnId)
        .map(toActiveTaskListState)
        .findLast((taskList) => taskList !== null) ?? null)
    : null;
  if (currentTurnTaskList) {
    return currentTurnTaskList.tasks.length > 0 ? currentTurnTaskList : null;
  }

  // Task lists describe work state beyond the lifetime of one provider turn. Keep the
  // latest unfinished list visible after completion, abort, reload, and follow-up turns
  // until the provider completes every task or sends an explicit empty snapshot.
  const latestPriorTaskList =
    allTaskListActivities.map(toActiveTaskListState).findLast((taskList) => taskList !== null) ??
    null;
  if (!latestPriorTaskList) {
    return null;
  }

  if (latestPriorTaskList.tasks.length === 0) {
    return null;
  }

  return latestPriorTaskList.tasks.some((task) => task.status !== "completed")
    ? latestPriorTaskList
    : null;
}

// Counts still-running background work for the active turn so compact UI can surface agent activity.
export function deriveActiveBackgroundTasksState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): ActiveBackgroundTasksState | null {
  const ordered = orderedActivities(activities);
  const activeTasks = new Map<string, { taskType?: string | undefined }>();

  for (const activity of ordered) {
    if (
      latestTurnId &&
      activity.turnId &&
      activity.turnId !== latestTurnId &&
      activity.kind !== "task.completed"
    ) {
      continue;
    }

    if (
      activity.kind !== "task.started" &&
      activity.kind !== "task.progress" &&
      activity.kind !== "task.completed"
    ) {
      continue;
    }

    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const taskId = payload && typeof payload.taskId === "string" ? payload.taskId : null;
    if (!taskId) {
      continue;
    }

    if (activity.kind === "task.completed") {
      activeTasks.delete(taskId);
      continue;
    }

    const previous = activeTasks.get(taskId);
    const taskType = payload && typeof payload.taskType === "string" ? payload.taskType : undefined;
    activeTasks.set(taskId, {
      taskType: taskType ?? previous?.taskType,
    });
  }

  const activeCount = [...activeTasks.values()].filter((task) => task.taskType !== "plan").length;
  return activeCount > 0 ? { activeCount } : null;
}

// Keeps the UI "working" while the provider still has visible assistant text or
// background-task updates to finish for the latest turn.
export function hasLiveTurnTailWork(input: {
  latestTurn: Pick<OrchestrationLatestTurn, "turnId" | "completedAt"> | null;
  messages: ReadonlyArray<Pick<ChatMessage, "role" | "streaming" | "turnId">>;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  session?: Pick<ThreadSession, "orchestrationStatus"> | null;
}): boolean {
  const latestTurnId = input.latestTurn?.turnId;
  if (!latestTurnId) {
    return false;
  }

  const hasStreamingAssistantText = input.messages.some(
    (message) =>
      message.role === "assistant" && message.turnId === latestTurnId && message.streaming,
  );
  if (hasStreamingAssistantText) {
    // Once the turn is terminal, a stale `streaming` flag should not keep the
    // stop button/timer alive indefinitely.
    return input.latestTurn?.completedAt == null;
  }

  // Some providers can leave task lifecycle bookkeeping behind after the turn
  // has already closed. Once the session is no longer running, those stale
  // task rows should not keep the whole chat in a live state.
  if (input.session?.orchestrationStatus !== "running") {
    return false;
  }

  if (deriveActiveBackgroundTasksState(input.activities, latestTurnId) !== null) {
    return true;
  }

  return false;
}
