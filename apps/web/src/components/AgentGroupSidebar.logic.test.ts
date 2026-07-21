import type { ModelSlug, ProjectId, ThreadId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import type { Project, SidebarThreadSummary } from "~/types";
import { resolveNewAgentGroupSessionDefaults } from "./AgentGroupSidebar.logic";

describe("resolveNewAgentGroupSessionDefaults", () => {
  const project = {
    defaultModelSelection: { provider: "codex", model: "gpt-5" as ModelSlug },
  } satisfies Pick<Project, "defaultModelSelection">;

  it("uses the group default for a new root session", () => {
    expect(resolveNewAgentGroupSessionDefaults(project, null)).toMatchObject({
      title: "New session",
      modelSelection: project.defaultModelSelection,
      interactionMode: "default",
      envMode: "local",
      parentThreadId: null,
    });
  });

  it("falls back to the Agent Groups default", () => {
    const globalDefault = {
      provider: "claudeAgent" as const,
      model: "claude-sonnet" as ModelSlug,
    };
    expect(
      resolveNewAgentGroupSessionDefaults({ defaultModelSelection: null }, null, globalDefault)
        .modelSelection,
    ).toEqual(globalDefault);
  });

  it("inherits the parent session agent and modes for a child", () => {
    const parent = {
      id: "parent" as ThreadId,
      projectId: "group" as ProjectId,
      modelSelection: { provider: "pi", model: "pi/sonnet" as ModelSlug },
      interactionMode: "plan",
      envMode: "worktree",
    } as SidebarThreadSummary;

    expect(resolveNewAgentGroupSessionDefaults(project, parent)).toMatchObject({
      title: "New child session",
      modelSelection: parent.modelSelection,
      interactionMode: "plan",
      envMode: "local",
      parentThreadId: parent.id,
    });
  });
});
