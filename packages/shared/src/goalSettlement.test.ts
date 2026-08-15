import { describe, expect, it } from "vitest";

import {
  GOAL_ACHIEVED_MARKER,
  GOAL_BLOCKED_MARKER,
  goalSettlementFromAssistantText,
  stripGoalSettlementMarker,
} from "./goalSettlement";

describe("goal settlement protocol", () => {
  it("recognizes and strips only exact trailing markers", () => {
    expect(goalSettlementFromAssistantText(`Done\n${GOAL_ACHIEVED_MARKER}  `)).toBe("achieved");
    expect(goalSettlementFromAssistantText(`Wait\n${GOAL_BLOCKED_MARKER}`)).toBe("blocked");
    expect(goalSettlementFromAssistantText(`${GOAL_ACHIEVED_MARKER}\nMore`)).toBeNull();
    expect(stripGoalSettlementMarker(`Done\n${GOAL_ACHIEVED_MARKER}\n`)).toBe("Done");
    expect(stripGoalSettlementMarker("Ordinary answer  ")).toBe("Ordinary answer  ");
  });
});
