import type { OrchestrationCommand, OrchestrationThread } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { resolveThreadGoalPatch } from "./threadGoalPolicy";

const startedAt = "2026-08-15T01:00:00.000Z";
const pausedAt = "2026-08-15T01:00:10.000Z";
const resumedAt = "2026-08-15T01:01:00.000Z";

function command(patch: Record<string, unknown>) {
  return { type: "thread.meta.update", ...patch } as Extract<
    OrchestrationCommand,
    { type: "thread.meta.update" }
  >;
}

function thread(patch: Partial<OrchestrationThread> = {}) {
  return { goal: "", goalStartedAt: null, goalPausedAt: null, ...patch } as OrchestrationThread;
}

describe("thread goal policy", () => {
  it("starts a new goal but keeps the clock when its wording changes", () => {
    expect(resolveThreadGoalPatch(command({ goal: "Ship it" }), thread(), startedAt)).toEqual({
      goal: "Ship it",
      goalStartedAt: startedAt,
      goalPausedAt: null,
    });
    expect(
      resolveThreadGoalPatch(
        command({ goal: "Ship it safely" }),
        thread({ goal: "Ship it", goalStartedAt: startedAt }),
        pausedAt,
      ),
    ).toEqual({ goal: "Ship it safely" });
  });

  it("freezes elapsed time while paused and excludes it after resume", () => {
    const active = thread({ goal: "Ship it", goalStartedAt: startedAt });
    expect(resolveThreadGoalPatch(command({ goalPaused: true }), active, pausedAt)).toEqual({
      goalPausedAt: pausedAt,
    });
    expect(
      resolveThreadGoalPatch(
        command({ goalPaused: false }),
        thread({ ...active, goalPausedAt: pausedAt }),
        resumedAt,
      ),
    ).toEqual({
      goalStartedAt: "2026-08-15T01:00:50.000Z",
      goalPausedAt: null,
    });
  });

  it("records completion separately from clearing a goal", () => {
    const achieved = resolveThreadGoalPatch(
      command({ goalAchieved: true }),
      thread({ goal: "Ship it", goalStartedAt: startedAt, goalPausedAt: pausedAt }),
      resumedAt,
    );
    expect(achieved.goal).toBe("");
    expect(achieved.goalAchievements?.[0]).toMatchObject({
      goal: "Ship it",
      achievedAt: resumedAt,
      elapsedMs: 10_000,
      turnId: null,
    });
    expect(resolveThreadGoalPatch(command({ goal: "" }), thread({ goal: "Ship it" }), resumedAt))
      .toEqual({ goal: "", goalStartedAt: null, goalPausedAt: null });
  });
});
