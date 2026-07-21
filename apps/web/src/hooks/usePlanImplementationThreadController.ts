// FILE: usePlanImplementationThreadController.ts
// Purpose: Create and start a new thread from an accepted plan.
// Layer: Web plan controller

import {
  type AssistantDeliveryMode,
  type ModelSelection,
  type ProviderStartOptions,
  type RuntimeMode,
  type ThreadId,
} from "@agent-group/contracts";
import type { AssociatedWorktreeMetadata } from "@agent-group/shared/threadWorkspace";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, type MutableRefObject } from "react";

import { formatOutgoingComposerPrompt } from "../lib/composerSend";
import { reconcileDeletedThreadFromClient } from "../lib/deletedThreadClientReconciliation";
import { buildPlanImplementationPrompt, buildPlanImplementationThreadTitle } from "../proposedPlan";
import { buildSourceProposedPlanReference } from "../session-logic";
import { useStore } from "../store";
import { truncateTitle } from "../truncateTitle";
import type { Project, ProposedPlan, Thread } from "../types";
import { toastManager } from "../components/ui/toast";
import { newCommandId, newMessageId, newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";

interface PlanImplementationThreadInput {
  readonly activeThread: Thread | undefined;
  readonly activeProject: Project | undefined;
  readonly proposedPlan: ProposedPlan | null;
  readonly associatedWorktree: AssociatedWorktreeMetadata;
  readonly isServerThread: boolean;
  readonly isSendBusy: boolean;
  readonly isConnecting: boolean;
  readonly sendInFlightRef: MutableRefObject<boolean>;
  readonly modelSelection: ModelSelection;
  readonly selectedPromptEffort: string | null;
  readonly providerOptions: ProviderStartOptions | undefined;
  readonly assistantDeliveryMode: AssistantDeliveryMode;
  readonly runtimeMode: RuntimeMode;
  readonly beginLocalDispatch: () => void;
  readonly resetLocalDispatch: () => void;
  readonly rememberCustomBinaryPath: (input: {
    threadId: ThreadId;
    provider: ModelSelection["provider"];
    providerOptions: ProviderStartOptions | undefined;
  }) => void;
  readonly openPlanSidebarOnNextThread: () => void;
}

export function usePlanImplementationThreadController(input: PlanImplementationThreadInput) {
  const navigate = useNavigate();
  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);

  return useCallback(async () => {
    const api = readNativeApi();
    if (
      !api ||
      !input.activeThread ||
      !input.activeProject ||
      !input.proposedPlan ||
      !input.isServerThread ||
      input.isSendBusy ||
      input.isConnecting ||
      input.sendInFlightRef.current
    ) {
      return;
    }

    const createdAt = new Date().toISOString();
    const nextThreadId = newThreadId();
    const implementationPrompt = buildPlanImplementationPrompt(input.proposedPlan.planMarkdown);
    const outgoingImplementationPrompt = formatOutgoingComposerPrompt({
      provider: input.modelSelection.provider,
      model: input.modelSelection.model,
      effort: input.selectedPromptEffort,
      text: implementationPrompt,
    });
    const nextThreadTitle = truncateTitle(
      buildPlanImplementationThreadTitle(input.proposedPlan.planMarkdown),
    );
    const sourceProposedPlan = buildSourceProposedPlanReference({
      threadId: input.activeThread.id,
      proposedPlan: input.proposedPlan,
    });

    input.sendInFlightRef.current = true;
    input.beginLocalDispatch();
    const finish = () => {
      input.sendInFlightRef.current = false;
      input.resetLocalDispatch();
    };

    await api.orchestration
      .dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId: nextThreadId,
        projectId: input.activeProject.id,
        title: nextThreadTitle,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: "default",
        envMode:
          input.activeThread.envMode ?? (input.activeThread.worktreePath ? "worktree" : "local"),
        branch: input.activeThread.branch,
        worktreePath: input.activeThread.worktreePath,
        lastKnownPr: input.activeThread.lastKnownPr ?? null,
        associatedWorktreePath: input.associatedWorktree.associatedWorktreePath,
        associatedWorktreeBranch: input.associatedWorktree.associatedWorktreeBranch,
        associatedWorktreeRef: input.associatedWorktree.associatedWorktreeRef,
        createdAt,
      })
      .then(() => {
        input.rememberCustomBinaryPath({
          threadId: nextThreadId,
          provider: input.modelSelection.provider,
          providerOptions: input.providerOptions,
        });
        return api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingImplementationPrompt,
            attachments: [],
          },
          modelSelection: input.modelSelection,
          ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
          assistantDeliveryMode: input.assistantDeliveryMode,
          dispatchMode: "queue",
          runtimeMode: input.runtimeMode,
          interactionMode: "default",
          ...(sourceProposedPlan ? { sourceProposedPlan } : {}),
          createdAt,
        });
      })
      .then(() => api.orchestration.getShellSnapshot())
      .then((snapshot) => {
        syncServerShellSnapshot(snapshot);
        input.openPlanSidebarOnNextThread();
        return navigate({
          to: "/$threadId",
          params: { threadId: nextThreadId },
        });
      })
      .catch(async (error) => {
        const deletedOnServer = await api.orchestration
          .dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: nextThreadId,
          })
          .then(() => true)
          .catch(() => false);
        if (deletedOnServer) {
          void reconcileDeletedThreadFromClient({
            threadId: nextThreadId,
            removeDeletedThreadFromClientState:
              useStore.getState().removeDeletedThreadFromClientState,
          });
        }
        toastManager.add({
          type: "error",
          title: "Could not start implementation thread",
          description:
            error instanceof Error
              ? error.message
              : "An error occurred while creating the new thread.",
        });
      })
      .then(finish, finish);
  }, [input, navigate, syncServerShellSnapshot]);
}
