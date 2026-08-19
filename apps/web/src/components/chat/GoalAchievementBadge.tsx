// FILE: GoalAchievementBadge.tsx
// Purpose: Render and index durable goal-completion markers in the transcript.
// Layer: Web chat timeline presentation

import type { ThreadGoalAchievement, TurnId } from "@agent-group/contracts";

import { formatClockDuration } from "../../session-logic";
import { CircleCheckIcon } from "~/lib/icons";
import { MESSAGE_ACTION_ICON_CLASS_NAME } from "./MessageActionButton";

export const EMPTY_GOAL_ACHIEVEMENTS: readonly ThreadGoalAchievement[] = [];
export const EMPTY_GOAL_ACHIEVEMENTS_BY_TURN_ID: ReadonlyMap<TurnId, ThreadGoalAchievement> =
  new Map();

export function indexGoalAchievements(
  achievements: readonly ThreadGoalAchievement[],
): ReadonlyMap<TurnId, ThreadGoalAchievement> {
  if (achievements.length === 0) return EMPTY_GOAL_ACHIEVEMENTS_BY_TURN_ID;
  const byTurnId = new Map<TurnId, ThreadGoalAchievement>();
  for (const achievement of achievements) {
    if (achievement.turnId !== null) byTurnId.set(achievement.turnId, achievement);
  }
  return byTurnId;
}

export function GoalAchievementBadge({ achievement }: { achievement: ThreadGoalAchievement }) {
  return (
    <>
      <div aria-hidden className="h-3 w-px shrink-0 bg-border" />
      <p className="flex min-w-0 items-center gap-1.5 tabular-nums" title={achievement.goal}>
        <CircleCheckIcon className={MESSAGE_ACTION_ICON_CLASS_NAME} />
        <span className="truncate">
          {achievement.elapsedMs !== null
            ? `Goal achieved in ${formatClockDuration(achievement.elapsedMs)}`
            : "Goal achieved"}
        </span>
      </p>
    </>
  );
}
