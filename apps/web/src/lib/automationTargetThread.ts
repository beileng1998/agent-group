// FILE: automationTargetThread.ts
// Purpose: Promote a local draft only when a heartbeat automation is actually submitted.
// Layer: Web automation orchestration

import {
  type ModelSelection,
  type NativeApi,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@agent-group/contracts";
import {
  buildPromptThreadTitleFallback,
  GENERIC_CHAT_THREAD_TITLE,
} from "@agent-group/shared/chatThreads";

import { dispatchThreadNotes } from "../pinnedMessages";
import {
  mergeProjectInstructionsIntoThreadNotes,
  useProjectInstructionsStore,
} from "../projectInstructionsStore";
import type { Project, Thread } from "../types";
import type { AutomationFormState } from "../routes/-automations.shared";
import { toastManager } from "../components/ui/toast";
import { promoteThreadCreate } from "./threadCreatePromotion";
import { newCommandId } from "./utils";

interface AssociatedWorktreeMetadata {
  readonly associatedWorktreePath: string | null;
  readonly associatedWorktreeBranch: string | null;
  readonly associatedWorktreeRef: string | null;
}

async function ensureAutomationTargetThread(input: {
  api: NativeApi | undefined;
  activeProject: Project | null;
  activeThread: Thread | null;
  associatedWorktree: AssociatedWorktreeMetadata;
  isServerThread: boolean;
  threadNotes: string;
  titleSeed: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
}): Promise<ThreadId | null> {
  if (!input.api || !input.activeProject || !input.activeThread) {
    toastManager.add({
      type: "warning",
      title: "Chat required",
      description: "Open a chat before creating a chat-bound automation.",
    });
    return null;
  }
  if (input.isServerThread) {
    return input.activeThread.id;
  }

  const title = buildPromptThreadTitleFallback(input.titleSeed || GENERIC_CHAT_THREAD_TITLE);
  try {
    const result = await promoteThreadCreate(
      {
        type: "thread.create",
        commandId: newCommandId(),
        threadId: input.activeThread.id,
        projectId: input.activeProject.id,
        title,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        envMode:
          input.activeThread.envMode ?? (input.activeThread.worktreePath ? "worktree" : "local"),
        branch: input.activeThread.branch ?? null,
        worktreePath: input.activeThread.worktreePath ?? null,
        associatedWorktreePath: input.associatedWorktree.associatedWorktreePath,
        associatedWorktreeBranch: input.associatedWorktree.associatedWorktreeBranch,
        associatedWorktreeRef: input.associatedWorktree.associatedWorktreeRef,
        lastKnownPr: input.activeThread.lastKnownPr ?? null,
        createdAt: input.activeThread.createdAt,
      },
      input.api,
      { force: true },
    );
    if (result === "unavailable") {
      toastManager.add({
        type: "error",
        title: "Could not create chat",
        description: "Agent Group could not promote this draft before saving the automation.",
      });
      return null;
    }

    const instructions =
      useProjectInstructionsStore.getState().instructionsByProjectId[input.activeProject.id] ?? "";
    const inheritedNotes = mergeProjectInstructionsIntoThreadNotes({
      threadNotes: input.threadNotes,
      projectInstructions: instructions,
    });
    if (inheritedNotes !== input.threadNotes && inheritedNotes.trim().length > 0) {
      void dispatchThreadNotes(input.activeThread.id, inheritedNotes).catch(() => undefined);
    }
    return input.activeThread.id;
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Could not create chat",
      description:
        error instanceof Error
          ? error.message
          : "Agent Group could not promote this draft before saving the automation.",
    });
    return null;
  }
}

export async function prepareAutomationFormForCreate(input: {
  form: AutomationFormState;
  api: NativeApi | undefined;
  activeProject: Project | null;
  activeThread: Thread | null;
  associatedWorktree: AssociatedWorktreeMetadata;
  isServerThread: boolean;
  threadNotes: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
}): Promise<{
  readonly form: AutomationFormState;
  readonly activityThreadId: ThreadId | null;
} | null> {
  const activityThreadId = input.isServerThread ? (input.activeThread?.id ?? null) : null;
  if (input.form.mode !== "heartbeat" || !input.activeThread) {
    return { form: input.form, activityThreadId };
  }
  if (input.isServerThread || input.form.targetThreadId !== input.activeThread.id) {
    return { form: input.form, activityThreadId };
  }

  const targetThreadId = await ensureAutomationTargetThread({
    api: input.api,
    activeProject: input.activeProject,
    activeThread: input.activeThread,
    associatedWorktree: input.associatedWorktree,
    isServerThread: input.isServerThread,
    threadNotes: input.threadNotes,
    titleSeed: input.form.prompt || input.form.name,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
  });
  return targetThreadId
    ? {
        form: { ...input.form, targetThreadId },
        activityThreadId: targetThreadId,
      }
    : null;
}
