// FILE: executionAdapterCommandAdmission.ts
// Purpose: Classify orchestration commands that belong to structured runtime.
// Layer: Orchestration command admission

import type { OrchestrationCommand, ProjectId, ThreadId } from "@agent-group/contracts";

export type ExecutionAdapterCommandAdmission =
  | {
      readonly kind: "terminal-operation";
      readonly threadId: ThreadId;
      readonly revision: number;
      readonly generation: string;
    }
  | {
      readonly kind: "turn-start";
      readonly threadId: ThreadId;
      readonly claimId: string;
    }
  | {
      readonly kind: "structured-operation";
      readonly threadId: ThreadId;
      readonly claimId: string;
    }
  | {
      readonly kind: "project-structured-operation";
      readonly projectId: ProjectId;
      readonly claimId: string;
    }
  | {
      readonly kind: "project-gated-operation";
      readonly projectId: ProjectId;
    };

function changesThreadRuntimeMetadata(
  command: Extract<OrchestrationCommand, { type: "thread.meta.update" }>,
): boolean {
  return (
    command.modelSelection !== undefined ||
    command.envMode !== undefined ||
    command.branch !== undefined ||
    command.worktreePath !== undefined ||
    command.associatedWorktreePath !== undefined ||
    command.associatedWorktreeBranch !== undefined ||
    command.associatedWorktreeRef !== undefined ||
    command.parentThreadId !== undefined
  );
}

export function executionAdapterAdmissionForCommand(
  command: OrchestrationCommand,
): ExecutionAdapterCommandAdmission | null {
  if ("terminalRuntimeFence" in command && command.terminalRuntimeFence !== undefined) {
    return {
      kind: "terminal-operation",
      threadId: command.threadId,
      revision: command.terminalRuntimeFence.revision,
      generation: command.terminalRuntimeFence.generation,
    };
  }
  const claim = (
    threadId: ThreadId,
    kind: "turn-start" | "structured-operation",
  ): Extract<ExecutionAdapterCommandAdmission, { kind: "turn-start" | "structured-operation" }> =>
    kind === "turn-start"
      ? { kind: "turn-start", threadId, claimId: `command:${command.commandId}` }
      : { kind: "structured-operation", threadId, claimId: `command:${command.commandId}` };
  switch (command.type) {
    case "project.meta.update":
      return command.workspaceRoot !== undefined
        ? {
            kind: "project-structured-operation",
            projectId: command.projectId,
            claimId: `command:${command.commandId}`,
          }
        : null;
    case "thread.create":
      return {
        kind: "project-gated-operation",
        projectId: command.projectId,
      };
    case "thread.turn.start":
    case "thread.turn.dispatch-queued":
      return claim(command.threadId, "turn-start");
    case "thread.session.set":
      // Session-stop completion is a cross-adapter lifecycle projection. It
      // runs only after the owning provider/terminal teardown succeeds and is
      // not part of either runtime's operational command surface.
      return command.session.status === "stopped"
        ? null
        : claim(command.threadId, "structured-operation");
    case "thread.turn.interrupt":
    case "thread.approval.respond":
    case "thread.user-input.respond":
    case "thread.checkpoint.revert":
    case "thread.conversation.rollback":
    case "thread.message.edit-and-resend":
    case "thread.runtime-mode.set":
    case "thread.messages.import":
    case "thread.message.assistant.delta":
    case "thread.message.assistant.complete":
    case "thread.terminal-message.observe":
    case "thread.proposed-plan.upsert":
    case "thread.turn.diff.complete":
    case "thread.revert.complete":
    case "thread.conversation.rollback.complete":
      return claim(command.threadId, "structured-operation");
    case "thread.meta.update":
      return changesThreadRuntimeMetadata(command)
        ? claim(command.threadId, "structured-operation")
        : null;
    default:
      return null;
  }
}
