import type { ModelSlug, ProjectId, ThreadId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import type { Project, SidebarThreadSummary } from "~/types";

import { buildAgentGroupSessionPaletteModel } from "./AgentGroupSessionPalette.logic";

const groupId = "group" as ProjectId;
const group = {
  id: groupId,
  kind: "project",
  name: "Agent Group",
  remoteName: "",
  folderName: "agent-group",
  localName: null,
  cwd: "/work/agent-group",
  defaultModelSelection: null,
  expanded: true,
  scripts: [],
} satisfies Project;

function session(id: string, overrides: Partial<SidebarThreadSummary> = {}): SidebarThreadSummary {
  return {
    id: id as ThreadId,
    projectId: groupId,
    title: id,
    modelSelection: { provider: "codex", model: "gpt-5" as ModelSlug },
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    session: null,
    createdAt: "2026-07-18T09:00:00.000Z",
    latestTurn: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    hasLiveTailWork: false,
    ...overrides,
  };
}

const runningSession = {
  provider: "codex",
  status: "running",
  createdAt: "2026-07-18T09:00:00.000Z",
  updatedAt: "2026-07-18T09:05:00.000Z",
  orchestrationStatus: "running",
} as SidebarThreadSummary["session"];

describe("buildAgentGroupSessionPaletteModel", () => {
  it("partitions attention, running, and recently visited sessions", () => {
    const approval = session("approval", {
      hasPendingApprovals: true,
      session: runningSession,
    });
    const working = session("working", {
      hasLiveTailWork: true,
      session: runningSession,
    });
    const recent = session("recent", { lastVisitedAt: "2026-07-18T10:00:00.000Z" });
    const older = session("older", { lastVisitedAt: "2026-07-18T09:30:00.000Z" });

    const model = buildAgentGroupSessionPaletteModel({
      groups: [group],
      messagesBySessionId: new Map(),
      query: "",
      sessions: [older, working, recent, approval],
    });

    expect(model.attention.map((item) => item.thread.id)).toEqual([approval.id]);
    expect(model.running.map((item) => item.thread.id)).toEqual([working.id]);
    expect(model.recent.map((item) => item.thread.id)).toEqual([recent.id, older.id]);
  });

  it("shows the group and parent hierarchy for a child session", () => {
    const parent = session("Backend", { title: "Backend" });
    const child = session("API", { title: "API", parentThreadId: parent.id });

    const model = buildAgentGroupSessionPaletteModel({
      groups: [group],
      messagesBySessionId: new Map(),
      query: "",
      sessions: [parent, child],
    });

    expect(model.recent.find((item) => item.thread.id === child.id)?.path).toBe(
      "Agent Group › Backend",
    );
  });

  it("finds a session from message content and keeps a useful snippet", () => {
    const target = session("target", { title: "Frontend polish" });

    const model = buildAgentGroupSessionPaletteModel({
      groups: [group],
      messagesBySessionId: new Map([
        [target.id, [{ text: "Please fix the sidebar keyboard navigation regression." }]],
      ]),
      query: "keyboard navigation",
      sessions: [target],
    });

    expect(model.searchResults).toHaveLength(1);
    expect(model.searchResults[0]).toMatchObject({
      matchKind: "message",
      thread: { id: target.id },
    });
    expect(model.searchResults[0]?.snippet).toContain("keyboard navigation");
  });

  it("finds sessions by their group name", () => {
    const target = session("target", { title: "Unrelated title" });
    const model = buildAgentGroupSessionPaletteModel({
      groups: [group],
      messagesBySessionId: new Map(),
      query: "agent group",
      sessions: [target],
    });

    expect(model.searchResults.map((item) => item.thread.id)).toEqual([target.id]);
  });
});
