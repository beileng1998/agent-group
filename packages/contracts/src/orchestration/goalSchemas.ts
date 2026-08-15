import { Schema } from "effect";

import { IsoDateTime, TurnId } from "../baseSchemas";

export const THREAD_GOAL_MAX_CHARS = 4_096;
export const THREAD_GOAL_ACHIEVEMENTS_MAX_COUNT = 20;

export const ThreadGoal = Schema.String.check(Schema.isMaxLength(THREAD_GOAL_MAX_CHARS));
export type ThreadGoal = typeof ThreadGoal.Type;

export const ThreadGoalStartBehavior = Schema.Literals(["start-if-idle", "defer"]);
export type ThreadGoalStartBehavior = typeof ThreadGoalStartBehavior.Type;

export const ThreadGoalContinuationTrigger = Schema.Literals([
  "goal-updated",
  "interaction-mode-updated",
  "turn-completed",
  "startup-recovery",
]);
export type ThreadGoalContinuationTrigger = typeof ThreadGoalContinuationTrigger.Type;

export const ThreadGoalTimingFields = {
  goalStartedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  goalPausedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
} as const;

export const ThreadGoalAchievement = Schema.Struct({
  goal: ThreadGoal,
  achievedAt: IsoDateTime,
  elapsedMs: Schema.NullOr(Schema.Number),
  turnId: Schema.NullOr(TurnId),
});
export type ThreadGoalAchievement = typeof ThreadGoalAchievement.Type;

export const ThreadGoalAchievements = Schema.Array(ThreadGoalAchievement).check(
  Schema.isMaxLength(THREAD_GOAL_ACHIEVEMENTS_MAX_COUNT),
);
export type ThreadGoalAchievements = typeof ThreadGoalAchievements.Type;
