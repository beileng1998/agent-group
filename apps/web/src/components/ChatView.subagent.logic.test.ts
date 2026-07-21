import { ThreadId, TurnId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import type { WorkLogEntry } from "../session-logic";
import type { Thread } from "../types";
import { enrichSubagentWorkEntries } from "./ChatView.logic";

const PARENT_THREAD_ID = ThreadId.makeUnsafe("parent-thread");
const PROVIDER_THREAD_ID = "task-tool-1";
const CHILD_THREAD_ID = ThreadId.makeUnsafe(`subagent:${PARENT_THREAD_ID}:${PROVIDER_THREAD_ID}`);

function makeWorkEntry(): WorkLogEntry {
  return {
    id: "work-subagent",
    createdAt: "2026-07-19T00:00:00.000Z",
    label: "Subagent task",
    tone: "tool",
    itemType: "collab_agent_tool_call",
    subagents: [
      {
        threadId: PROVIDER_THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        rawStatus: "in_progress",
      },
    ],
  };
}

function makeChildThread(state: "completed" | "interrupted" | "error"): Thread {
  return {
    id: CHILD_THREAD_ID,
    title: "Architecture reviewer",
    parentThreadId: PARENT_THREAD_ID,
    error: null,
    latestTurn: {
      turnId: TurnId.makeUnsafe("child-turn"),
      state,
      requestedAt: "2026-07-19T00:00:00.000Z",
      startedAt: "2026-07-19T00:00:00.000Z",
      completedAt: "2026-07-19T00:00:01.000Z",
      assistantMessageId: null,
    },
    session: {
      provider: "claudeAgent",
      status: "ready",
      orchestrationStatus: "ready",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:01.000Z",
    },
  } as unknown as Thread;
}

describe("subagent work entry terminal status", () => {
  it.each([
    ["completed", "Completed"],
    ["interrupted", "Stopped"],
    ["error", "Error"],
  ] as const)("shows %s instead of falling back to Idle", (state, expectedLabel) => {
    const [entry] = enrichSubagentWorkEntries(
      [makeWorkEntry()],
      [makeChildThread(state)],
      PARENT_THREAD_ID,
    );

    expect(entry?.subagents?.[0]).toMatchObject({
      resolvedThreadId: CHILD_THREAD_ID,
      statusLabel: expectedLabel,
      isActive: false,
    });
  });
});
