import { describe, expect, it } from "vitest";

import type { SidebarThreadSummary } from "~/types";

import {
  resolveCurrentAgentGroupSession,
  sessionIdFromPathname,
} from "./AgentGroupShellNavigation.logic";

function session(id: string, activityAt: string): SidebarThreadSummary {
  return {
    id,
    title: id,
    createdAt: activityAt,
    updatedAt: activityAt,
  } as SidebarThreadSummary;
}

describe("AgentGroupShellNavigation.logic", () => {
  it("recognizes only direct session routes", () => {
    expect(sessionIdFromPathname("/session-1")).toBe("session-1");
    expect(sessionIdFromPathname("/settings")).toBe("settings");
    expect(sessionIdFromPathname("/workspace/project-1")).toBeNull();
  });

  it("prefers the routed session, then the remembered session", () => {
    const sessions = [
      session("session-1", "2026-01-01T00:00:00.000Z"),
      session("session-2", "2026-02-01T00:00:00.000Z"),
    ];

    expect(
      resolveCurrentAgentGroupSession({
        pathname: "/session-1",
        rememberedSessionId: "session-2",
        sessions,
      })?.id,
    ).toBe("session-1");
    expect(
      resolveCurrentAgentGroupSession({
        pathname: "/settings",
        rememberedSessionId: "session-1",
        sessions,
      })?.id,
    ).toBe("session-1");
  });

  it("falls back to the most recently visited available session", () => {
    const older = session("older", "2026-01-01T00:00:00.000Z");
    const newer = session("newer", "2026-02-01T00:00:00.000Z");

    expect(
      resolveCurrentAgentGroupSession({
        pathname: "/settings",
        rememberedSessionId: "deleted",
        sessions: [older, newer],
      })?.id,
    ).toBe("newer");
  });
});
