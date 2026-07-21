// FILE: useComposerSlashThreadActions.ts
// Purpose: Owns fork, sidechat, and native review thread creation flows.
// Layer: Web composer application logic

import { TEMPORARY_SIDECHAT_PLACEHOLDER_TITLE } from "@agent-group/shared/agentGroupSessions";
import { deriveAssociatedWorktreeMetadata } from "@agent-group/shared/threadWorkspace";
import { useCallback, useEffect } from "react";
import { toastManager } from "../../components/ui/toast";
import {
  buildSlashReviewComposerPrompt,
  type ForkSlashCommandTarget,
} from "../../composerSlashCommands";
import { useComposerDraftStore } from "../../composerDraftStore";
import { requestComposerFocus } from "../../composerFocusRequestStore";
import { createAssistantSelectionAttachment } from "../../lib/assistantSelections";
import { buildSidechatInitialMessage } from "../../lib/sidechatCreation";
import {
  registerSidechatCreator,
  type SidechatCreatorOptions,
} from "../../lib/sidechatCreatorRegistry";
import { buildThreadHandoffImportedMessages } from "../../lib/threadHandoff";
import { resolveForkThreadEnvironment } from "../../lib/threadEnvironment";
import { newCommandId, newMessageId, newThreadId } from "../../lib/utils";
import { readNativeApi } from "../../nativeApi";
import { useRightDockStore } from "../../rightDockStore";
import type { ComposerSlashCommandsInput } from "./types";

type Input = Pick<
  ComposerSlashCommandsInput,
  | "activeProject"
  | "activeRootBranch"
  | "activeThread"
  | "editorActions"
  | "interactionMode"
  | "isServerThread"
  | "navigateToThread"
  | "runtimeMode"
  | "selectedModelSelection"
  | "selectedProvider"
  | "syncServerShellSnapshot"
  | "threadId"
> & { canCreateSidechat: boolean };

export function useComposerSlashThreadActions(input: Input) {
  const createForkThreadFromSlashCommand = useCallback(
    async (options?: { target?: ForkSlashCommandTarget }) => {
      const api = readNativeApi();
      if (!api || !input.activeProject || !input.activeThread || !input.isServerThread) {
        toastManager.add({
          type: "warning",
          title: "Fork is unavailable",
          description: "Only existing server-backed threads can be forked right now.",
        });
        return true;
      }

      const nextThreadId = newThreadId();
      const createdAt = new Date().toISOString();
      const resolvedTarget = resolveForkThreadEnvironment({
        target: options?.target ?? "local",
        activeRootBranch: input.activeRootBranch,
        sourceThread: input.activeThread,
      });
      await api.orchestration.dispatchCommand({
        type: "thread.fork.create",
        commandId: newCommandId(),
        threadId: nextThreadId,
        sourceThreadId: input.activeThread.id,
        projectId: input.activeProject.id,
        title: input.activeThread.title,
        modelSelection: input.selectedModelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        envMode: resolvedTarget.envMode,
        branch: resolvedTarget.branch,
        worktreePath: resolvedTarget.worktreePath,
        associatedWorktreePath: resolvedTarget.associatedWorktreePath,
        associatedWorktreeBranch: resolvedTarget.associatedWorktreeBranch,
        associatedWorktreeRef: resolvedTarget.associatedWorktreeRef,
        importedMessages: [...buildThreadHandoffImportedMessages(input.activeThread)],
        createdAt,
      });
      input.syncServerShellSnapshot(await api.orchestration.getShellSnapshot());
      await input.navigateToThread(nextThreadId);
      return true;
    },
    [
      input.activeProject,
      input.activeRootBranch,
      input.activeThread,
      input.interactionMode,
      input.isServerThread,
      input.navigateToThread,
      input.runtimeMode,
      input.selectedModelSelection,
      input.syncServerShellSnapshot,
    ],
  );

  const createSidechatFromSlashCommand = useCallback(
    async (options?: SidechatCreatorOptions) => {
      const api = readNativeApi();
      if (!api || !input.activeProject || !input.activeThread || !input.canCreateSidechat) {
        toastManager.add({
          type: "warning",
          title: "Side is unavailable",
          description: "Open a server-backed main thread before starting Side.",
        });
        return true;
      }

      const nextThreadId = newThreadId();
      const initialPrompt = options?.initialPrompt?.trim() ?? "";
      const selection = options?.selection
        ? createAssistantSelectionAttachment(options.selection)
        : null;
      if (options?.selection && !selection) {
        throw new Error("The selected text cannot be added to Side.");
      }
      const initialMessage = buildSidechatInitialMessage({
        prompt: initialPrompt,
        ...(selection ? { selection } : {}),
      });
      await api.orchestration.dispatchCommand({
        type: "thread.fork.create",
        commandId: newCommandId(),
        threadId: nextThreadId,
        sourceThreadId: input.activeThread.id,
        sidechatSourceThreadId: input.activeThread.id,
        projectId: input.activeProject.id,
        title: TEMPORARY_SIDECHAT_PLACEHOLDER_TITLE,
        modelSelection: input.selectedModelSelection,
        runtimeMode: "approval-required",
        interactionMode: "default",
        envMode:
          input.activeThread.envMode ?? (input.activeThread.worktreePath ? "worktree" : "local"),
        branch: input.activeThread.branch,
        worktreePath: input.activeThread.worktreePath,
        associatedWorktreePath: input.activeThread.associatedWorktreePath ?? null,
        associatedWorktreeBranch: input.activeThread.associatedWorktreeBranch ?? null,
        associatedWorktreeRef: input.activeThread.associatedWorktreeRef ?? null,
        importedMessages: [...buildThreadHandoffImportedMessages(input.activeThread)],
        createdAt: new Date().toISOString(),
      });

      const snapshot = await api.orchestration.getShellSnapshot().catch(() => null);
      if (snapshot) input.syncServerShellSnapshot(snapshot);
      if (selection && !initialMessage) {
        useComposerDraftStore.getState().addAssistantSelection(nextThreadId, selection);
      }
      useRightDockStore.getState().openPane(input.activeThread.id, {
        kind: "sidechat",
        threadId: nextThreadId,
      });
      requestComposerFocus(nextThreadId);

      if (initialMessage) {
        try {
          await api.orchestration.dispatchCommand({
            type: "thread.turn.start",
            commandId: newCommandId(),
            threadId: nextThreadId,
            message: {
              messageId: newMessageId(),
              role: "user",
              text: initialMessage.text,
              attachments: initialMessage.attachments,
            },
            modelSelection: input.selectedModelSelection,
            runtimeMode: "approval-required",
            interactionMode: "default",
            createdAt: new Date().toISOString(),
          });
        } catch (error) {
          const drafts = useComposerDraftStore.getState();
          drafts.setPrompt(nextThreadId, initialPrompt);
          if (selection) drafts.addAssistantSelection(nextThreadId, selection);
          throw error;
        }
      }
      return true;
    },
    [
      input.activeProject,
      input.activeThread,
      input.canCreateSidechat,
      input.isServerThread,
      input.selectedModelSelection,
      input.syncServerShellSnapshot,
    ],
  );

  useEffect(() => {
    if (!input.canCreateSidechat) return;
    return registerSidechatCreator(input.threadId, createSidechatFromSlashCommand);
  }, [input.canCreateSidechat, createSidechatFromSlashCommand, input.threadId]);

  const runCodexReviewStart = useCallback(
    async (target: "changes" | "base-branch") => {
      const api = readNativeApi();
      if (!api || !input.activeThread || !input.activeProject) {
        toastManager.add({
          type: "warning",
          title: "Review is unavailable",
          description: "Open a project thread before starting a native review.",
        });
        return false;
      }
      if (target === "base-branch" && !input.activeRootBranch) {
        toastManager.add({
          type: "warning",
          title: "Base branch unavailable",
          description: "Select or detect a base branch before starting this review.",
        });
        return false;
      }

      const nextThreadId = newThreadId();
      const createdAt = new Date().toISOString();
      const associatedWorktree = deriveAssociatedWorktreeMetadata({
        branch: input.activeThread.branch,
        worktreePath: input.activeThread.worktreePath,
        associatedWorktreePath: input.activeThread.associatedWorktreePath ?? null,
        associatedWorktreeBranch: input.activeThread.associatedWorktreeBranch ?? null,
        associatedWorktreeRef: input.activeThread.associatedWorktreeRef ?? null,
      });
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.create",
          commandId: newCommandId(),
          threadId: nextThreadId,
          projectId: input.activeProject.id,
          title: `${input.activeThread.title} Review`,
          modelSelection: input.selectedModelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: "default",
          envMode:
            input.activeThread.envMode ?? (input.activeThread.worktreePath ? "worktree" : "local"),
          branch: input.activeThread.branch,
          worktreePath: input.activeThread.worktreePath,
          lastKnownPr: input.activeThread.lastKnownPr ?? null,
          ...associatedWorktree,
          createdAt,
        });
        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text:
              target === "base-branch" && input.activeRootBranch
                ? `Review against base branch ${input.activeRootBranch}`
                : "Review current changes",
            attachments: [],
          },
          modelSelection: input.selectedModelSelection,
          reviewTarget:
            target === "base-branch"
              ? { type: "baseBranch", branch: input.activeRootBranch! }
              : { type: "uncommittedChanges" },
          dispatchMode: "queue",
          runtimeMode: input.runtimeMode,
          interactionMode: "default",
          createdAt,
        });
        input.syncServerShellSnapshot(await api.orchestration.getShellSnapshot());
        await input.navigateToThread(nextThreadId);
        return true;
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not start review",
          description:
            error instanceof Error ? error.message : "An error occurred while starting review.",
        });
        return false;
      }
    },
    [
      input.activeProject,
      input.activeRootBranch,
      input.activeThread,
      input.navigateToThread,
      input.runtimeMode,
      input.selectedModelSelection,
      input.syncServerShellSnapshot,
    ],
  );

  const handleReviewTargetSelection = useCallback(
    async (target: "changes" | "base-branch") => {
      if (input.selectedProvider === "codex") {
        await runCodexReviewStart(target);
      } else {
        input.editorActions.setComposerPromptValue(
          buildSlashReviewComposerPrompt(target === "base-branch" ? "base" : ""),
        );
      }
      input.editorActions.scheduleComposerFocus();
    },
    [input.editorActions, input.selectedProvider, runCodexReviewStart],
  );

  const handleForkTargetSelection = useCallback(
    async (target: ForkSlashCommandTarget) => {
      try {
        await createForkThreadFromSlashCommand({ target });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not fork thread",
          description:
            error instanceof Error
              ? error.message
              : "An error occurred while creating the forked thread.",
        });
      }
    },
    [createForkThreadFromSlashCommand],
  );

  return {
    createForkThreadFromSlashCommand,
    createSidechatFromSlashCommand,
    handleForkTargetSelection,
    handleReviewTargetSelection,
    runCodexReviewStart,
  };
}
