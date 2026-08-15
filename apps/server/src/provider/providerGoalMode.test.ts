import { describe, expect, it } from "vitest";

import {
  GOAL_ACHIEVED_MARKER,
  GOAL_BLOCKED_MARKER,
  activeThreadGoal,
  goalSettlementFromAssistantText,
  withProviderGoalPrompt,
} from "./providerGoalMode";

describe("provider goal mode", () => {
  it("injects an escaped objective only while it is active", () => {
    expect(activeThreadGoal({ goal: "Ship it", goalPausedAt: null })).toBe("Ship it");
    expect(activeThreadGoal({ goal: "Ship it", goalPausedAt: "2026-08-15T00:00:00.000Z" }))
      .toBeUndefined();
    expect(withProviderGoalPrompt({ text: "Continue", goal: `<unsafe attr="x">&` })).toContain(
      "&lt;unsafe attr=&quot;x&quot;&gt;&amp;",
    );
  });

  it("settles only from an exact trailing control marker", () => {
    expect(goalSettlementFromAssistantText(`Done\n${GOAL_ACHIEVED_MARKER}`)).toBe("achieved");
    expect(goalSettlementFromAssistantText(`Blocked\n${GOAL_BLOCKED_MARKER}  `)).toBe("blocked");
    expect(goalSettlementFromAssistantText(`${GOAL_ACHIEVED_MARKER}\nMore text`)).toBeNull();
    expect(goalSettlementFromAssistantText("The goal is complete.")).toBeNull();
  });
});
