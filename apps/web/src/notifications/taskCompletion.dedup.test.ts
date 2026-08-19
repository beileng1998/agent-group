import { ProjectId, ThreadId, TurnId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import type { Thread } from "../types";
import {
  collectCompletedThreadCandidates,
  completedThreadNotificationKey,
  type CompletedThreadCandidate,
} from "./taskCompletion.logic";

const threadId = ThreadId.makeUnsafe("thread-completion-dedup");
const projectId = ProjectId.makeUnsafe("project-completion-dedup");
const turnId = TurnId.makeUnsafe("turn-completion-dedup");

function threadSnapshot(input: {
  readonly state: "running" | "completed" | "interrupted" | "error";
  readonly completedAt: string | null;
  readonly sessionStatus: "running" | "ready";
}): Thread {
  return {
    id: threadId,
    projectId,
    title: "Completion dedup",
    latestTurn: {
      turnId,
      state: input.state,
      requestedAt: "2026-08-15T00:00:00.000Z",
      startedAt: "2026-08-15T00:00:01.000Z",
      completedAt: input.completedAt,
      assistantMessageId: null,
    },
    session: {
      provider: "codex",
      status: input.sessionStatus,
      orchestrationStatus: input.sessionStatus,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: input.completedAt ?? "2026-08-15T00:00:01.000Z",
    },
    messages: [],
  } as unknown as Thread;
}

describe("completion notification deduplication", () => {
  it.each(["interrupted", "error"] as const)(
    "does not report a %s Turn as a successful completion",
    (state) => {
      const previous = threadSnapshot({
        state: "running",
        completedAt: null,
        sessionStatus: "running",
      });
      const next = threadSnapshot({
        state,
        completedAt: "2026-08-15T00:00:05.000Z",
        sessionStatus: "ready",
      });

      expect(collectCompletedThreadCandidates([previous], [next])).toEqual([]);
    },
  );

  it("uses Turn identity instead of mutable completion timestamps", () => {
    const candidate = (completedAt: string): CompletedThreadCandidate => ({
      threadId,
      projectId,
      title: "Completion dedup",
      turnId,
      completedAt,
      assistantSummary: null,
    });

    expect(completedThreadNotificationKey(candidate("2026-08-15T00:00:05.000Z"))).toBe(
      completedThreadNotificationKey(candidate("2026-08-15T00:00:05.250Z")),
    );
  });
});
