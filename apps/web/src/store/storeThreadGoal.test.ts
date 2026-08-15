import { CommandId, EventId, ProjectId, ThreadId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import type { Thread } from "../types";
import { reduceProjectThreadMetaEvent } from "./storeProjectThreadMetaEvents";
import type { AppState } from "./storeState";

function thread(): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-goal"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-goal"),
    title: "Goal",
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-08-15T00:00:00.000Z",
    latestTurn: null,
    envMode: "local",
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  };
}

describe("thread goal store projection", () => {
  it("applies every goal field from a live metadata event", () => {
    const current = thread();
    const state = {
      projects: [],
      threads: [current],
      sidebarThreadSummaryById: {},
      threadsHydrated: true,
    } satisfies AppState;
    const achievement = {
      goal: "Previous objective",
      achievedAt: "2026-08-15T00:00:00.000Z",
      elapsedMs: 2_000,
      turnId: null,
    };
    const next = reduceProjectThreadMetaEvent(state, {
      type: "thread.meta-updated",
      sequence: 1,
      eventId: EventId.makeUnsafe("event-goal"),
      aggregateKind: "thread",
      aggregateId: current.id,
      occurredAt: "2026-08-15T00:00:02.000Z",
      commandId: CommandId.makeUnsafe("command-goal"),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe("command-goal"),
      metadata: {},
      payload: {
        threadId: current.id,
        goal: "Ship the feature",
        goalStartedAt: "2026-08-15T00:00:01.000Z",
        goalPausedAt: null,
        goalAchievements: [achievement],
        updatedAt: "2026-08-15T00:00:02.000Z",
      },
    });

    expect(next?.threads[0]).toMatchObject({
      goal: "Ship the feature",
      goalStartedAt: "2026-08-15T00:00:01.000Z",
      goalPausedAt: null,
      goalAchievements: [achievement],
    });
  });
});
