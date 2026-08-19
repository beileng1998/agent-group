import {
  THREAD_GOAL_ACHIEVEMENTS_MAX_COUNT,
  type OrchestrationCommand,
  type OrchestrationThread,
  type ThreadGoalAchievement,
} from "@agent-group/contracts";

type GoalCommand = Extract<OrchestrationCommand, { type: "thread.meta.update" }>;

export interface ThreadGoalPatch {
  readonly goal?: string;
  readonly goalStartedAt?: string | null;
  readonly goalPausedAt?: string | null;
  readonly goalAchievements?: readonly ThreadGoalAchievement[];
}

export function resolveThreadGoalPatch(
  command: GoalCommand,
  thread: OrchestrationThread,
  occurredAt: string,
): ThreadGoalPatch {
  const activeGoal = (thread.goal ?? "").trim();
  if (command.goalAchieved === true) {
    if (!activeGoal) return {};
    const startedMs = Date.parse(thread.goalStartedAt ?? "");
    const pausedMs = Date.parse(thread.goalPausedAt ?? "");
    const completedMs = Date.parse(occurredAt);
    const endMs = Number.isFinite(pausedMs) ? pausedMs : completedMs;
    const achievement: ThreadGoalAchievement = {
      goal: activeGoal,
      achievedAt: occurredAt,
      elapsedMs:
        Number.isFinite(startedMs) && Number.isFinite(endMs)
          ? Math.max(0, endMs - startedMs)
          : null,
      turnId: thread.latestTurn?.turnId ?? null,
    };
    return {
      goal: "",
      goalStartedAt: null,
      goalPausedAt: null,
      goalAchievements: [...(thread.goalAchievements ?? []), achievement].slice(
        -THREAD_GOAL_ACHIEVEMENTS_MAX_COUNT,
      ),
    };
  }

  if (command.goal !== undefined) {
    if (!command.goal.trim()) {
      return { goal: command.goal, goalStartedAt: null, goalPausedAt: null };
    }
    return activeGoal
      ? { goal: command.goal }
      : { goal: command.goal, goalStartedAt: occurredAt, goalPausedAt: null };
  }

  if (command.goalPaused === undefined || !activeGoal) return {};
  const pausedAt = thread.goalPausedAt ?? null;
  if (command.goalPaused) return pausedAt === null ? { goalPausedAt: occurredAt } : {};
  if (pausedAt === null) return {};

  const startedMs = Date.parse(thread.goalStartedAt ?? "");
  const pausedMs = Date.parse(pausedAt);
  const resumedMs = Date.parse(occurredAt);
  const goalStartedAt =
    Number.isFinite(startedMs) && Number.isFinite(pausedMs) && Number.isFinite(resumedMs)
      ? new Date(resumedMs - Math.max(0, pausedMs - startedMs)).toISOString()
      : occurredAt;
  return { goalStartedAt, goalPausedAt: null };
}
