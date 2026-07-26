import { CommandId, ProjectId, ThreadId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { executionAdapterAdmissionForCommand } from "./executionAdapterCommandAdmission";

const threadId = ThreadId.makeUnsafe("thread-admission");
const projectId = ProjectId.makeUnsafe("project-admission");
const commandId = CommandId.makeUnsafe("command-admission");

describe("executionAdapterAdmissionForCommand", () => {
  it.each([
    { envMode: "local" as const },
    { branch: "feature" },
    { worktreePath: "/workspace/next" },
    { associatedWorktreePath: "/workspace/associated" },
    { associatedWorktreeBranch: "associated" },
    { associatedWorktreeRef: "refs/heads/associated" },
    { parentThreadId: ThreadId.makeUnsafe("thread-parent") },
  ])("fences runtime-affecting Thread metadata: %o", (patch) => {
    expect(
      executionAdapterAdmissionForCommand({
        type: "thread.meta.update",
        commandId,
        threadId,
        ...patch,
      }),
    ).toMatchObject({ kind: "structured-operation", threadId });
  });

  it("allows display-only Thread metadata while terminal-owned", () => {
    expect(
      executionAdapterAdmissionForCommand({
        type: "thread.meta.update",
        commandId,
        threadId,
        title: "Renamed",
        isPinned: true,
      }),
    ).toBeNull();
  });

  it("fences canonical Project root changes but allows non-runtime metadata", () => {
    expect(
      executionAdapterAdmissionForCommand({
        type: "project.meta.update",
        commandId,
        projectId,
        workspaceRoot: "/workspace/next",
      }),
    ).toMatchObject({ kind: "project-structured-operation", projectId });
    expect(
      executionAdapterAdmissionForCommand({
        type: "project.meta.update",
        commandId,
        projectId,
        kind: "project",
      }),
    ).toBeNull();
    expect(
      executionAdapterAdmissionForCommand({
        type: "project.meta.update",
        commandId,
        projectId,
        title: "Renamed",
        isPinned: true,
      }),
    ).toBeNull();
  });

  it("places Thread creation behind the shared Project runtime gate", () => {
    expect(
      executionAdapterAdmissionForCommand({
        type: "thread.create",
        commandId,
        threadId,
        projectId,
        title: "Thread",
        modelSelection: { provider: "codex", model: "gpt-5" },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: "2026-07-26T00:00:00.000Z",
      }),
    ).toMatchObject({ kind: "project-gated-operation", projectId });
  });

  it("leaves interaction mode as next-turn metadata", () => {
    expect(
      executionAdapterAdmissionForCommand({
        type: "thread.interaction-mode.set",
        commandId,
        threadId,
        interactionMode: "default",
        createdAt: "2026-07-26T00:00:00.000Z",
      }),
    ).toBeNull();
  });
});
