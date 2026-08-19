import { TurnId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { EMPTY_GOAL_ACHIEVEMENTS_BY_TURN_ID, indexGoalAchievements } from "./GoalAchievementBadge";

describe("goal achievement transcript index", () => {
  it("anchors the latest achievement to its terminal turn", () => {
    const turnId = TurnId.makeUnsafe("turn-goal");
    const first = {
      goal: "First wording",
      achievedAt: "2026-08-15T00:00:00.000Z",
      elapsedMs: 1_000,
      turnId,
    };
    const latest = { ...first, goal: "Final wording", achievedAt: "2026-08-15T00:00:01.000Z" };
    const index = indexGoalAchievements([
      first,
      { ...first, goal: "Legacy", turnId: null },
      latest,
    ]);

    expect(index.get(turnId)).toEqual(latest);
    expect(indexGoalAchievements([])).toBe(EMPTY_GOAL_ACHIEVEMENTS_BY_TURN_ID);
  });
});
