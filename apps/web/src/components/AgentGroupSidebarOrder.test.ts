import { describe, expect, it } from "vitest";

import { orderAgentGroupSessions, reorderAgentGroupSessionIds } from "./AgentGroupSidebarOrder";

const session = (id: string, createdAt: string, isPinned = false) => ({
  id,
  createdAt,
  isPinned,
});

describe("Agent Group sidebar session ordering", () => {
  it("keeps pinned sessions above remembered manual order", () => {
    const sessions = [
      session("a", "2026-01-01T00:00:00.000Z"),
      session("b", "2026-01-02T00:00:00.000Z"),
      session("c", "2026-01-03T00:00:00.000Z", true),
    ];

    expect(orderAgentGroupSessions(sessions, ["a", "b", "c"]).map(({ id }) => id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("places a new session first within its pin partition", () => {
    const sessions = [
      session("old", "2026-01-01T00:00:00.000Z"),
      session("new", "2026-01-02T00:00:00.000Z"),
    ];

    expect(orderAgentGroupSessions(sessions, ["old"]).map(({ id }) => id)).toEqual(["new", "old"]);
  });

  it("moves a dragged id to the target index", () => {
    expect(reorderAgentGroupSessionIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(reorderAgentGroupSessionIds(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  });
});
