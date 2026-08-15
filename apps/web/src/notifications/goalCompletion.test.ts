import { ProjectId, ThreadId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import type { Thread } from "../types";
import {
  buildGoalCompletionCopy,
  collectCompletedGoalCandidates,
  completedGoalNotificationKey,
  hasActivePersistentGoal,
} from "./goalCompletion";
import { collectCompletedThreadCandidates } from "./taskCompletion.logic";

function thread(patch: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-goal"),
    projectId: ProjectId.makeUnsafe("project-goal"),
    title: "Release",
    goalAchievements: [],
    ...patch,
  } as Thread;
}

describe("goal completion notifications", () => {
  it("emits one candidate only when achievement history advances", () => {
    const achievement = {
      goal: "Ship the complete feature",
      achievedAt: "2026-08-15T00:00:00.000Z",
      elapsedMs: 1_000,
      turnId: null,
    };
    const candidates = collectCompletedGoalCandidates(
      [thread()],
      [thread({ goalAchievements: [achievement] })],
    );
    expect(candidates).toHaveLength(1);
    expect(buildGoalCompletionCopy(candidates[0]!)).toEqual({
      title: "Release",
      body: "Goal completed: Ship the complete feature",
    });
    expect(completedGoalNotificationKey(candidates[0]!)).toContain(
      "thread-goal:2026-08-15T00:00:00.000Z",
    );
    expect(
      collectCompletedGoalCandidates(
        [thread({ goalAchievements: [achievement] })],
        [thread({ goalAchievements: [achievement] })],
      ),
    ).toEqual([]);
  });

  it("identifies only unpaused active goals", () => {
    expect(hasActivePersistentGoal(thread({ goal: "Ship" }))).toBe(true);
    expect(hasActivePersistentGoal(thread({ goal: "Ship", goalPausedAt: "paused" }))).toBe(false);
    expect(hasActivePersistentGoal(thread({ goal: "" }))).toBe(false);
  });

  it("suppresses intermediate turn notifications until the goal settles", () => {
    const previous = thread({
      goal: "Finish the whole objective",
      goalPausedAt: null,
      session: {
        provider: "codex",
        status: "running",
        orchestrationStatus: "running",
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
      },
      latestTurn: {
        turnId: "turn-goal" as never,
        state: "running",
        requestedAt: "2026-08-15T00:00:00.000Z",
        startedAt: "2026-08-15T00:00:00.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const next = thread({
      ...previous,
      session: { ...previous.session!, status: "ready", orchestrationStatus: "ready" },
      latestTurn: {
        ...previous.latestTurn!,
        state: "completed",
        completedAt: "2026-08-15T00:00:05.000Z",
      },
    });
    expect(collectCompletedThreadCandidates([previous], [next])).toEqual([]);
  });
});
