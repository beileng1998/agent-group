import type { ModelSlug, ProjectId, ThreadId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import type { SidebarThreadSummary } from "~/types";

import { resolveAgentGroupSessionStatusTarget } from "./AgentGroupSessionStatus";

function session(id: string, overrides: Partial<SidebarThreadSummary> = {}): SidebarThreadSummary {
  return {
    id: id as ThreadId,
    projectId: "group" as ProjectId,
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

describe("resolveAgentGroupSessionStatusTarget", () => {
  it("surfaces the highest-priority child status when a parent is collapsed", () => {
    const parent = session("parent");
    const working = session("working", { hasLiveTailWork: true });
    const error = session("broken", {
      session: {
        provider: "codex",
        status: "error",
        createdAt: "2026-07-18T09:00:00.000Z",
        updatedAt: "2026-07-18T09:05:00.000Z",
        orchestrationStatus: "idle",
      } as SidebarThreadSummary["session"],
    });
    const childrenByParent = new Map([[parent.id, [working, error]]]);

    expect(
      resolveAgentGroupSessionStatusTarget({
        childrenByParent,
        includeDescendants: true,
        thread: parent,
      }),
    ).toMatchObject({ threadId: error.id, status: { kind: "error" } });
  });

  it("does not leak an expanded child's status onto its parent", () => {
    const parent = session("parent");
    const child = session("child", { hasLiveTailWork: true });

    expect(
      resolveAgentGroupSessionStatusTarget({
        childrenByParent: new Map([[parent.id, [child]]]),
        includeDescendants: false,
        thread: parent,
      }),
    ).toBeNull();
  });
});
