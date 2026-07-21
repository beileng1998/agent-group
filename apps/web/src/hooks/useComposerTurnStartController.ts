// FILE: useComposerTurnStartController.ts
// Purpose: Orchestrate destination, presentation, execution, and settlement for a routed send.
// Layer: Web composer turn controller

import {
  type NativeApi,
  type OrchestrationShellSnapshot,
  type ProviderKind,
  type ProviderStartOptions,
  type RuntimeMode,
  type ThreadId,
} from "@agent-group/contracts";
import { useCallback, type MutableRefObject } from "react";

import type { ComposerDraftStoreState } from "../composerDraftStore";
import { waitForSetupScriptTerminalActivity } from "../components/chat/chatViewSetupAutomation";
import { prepareComposerSendDestination } from "../lib/composerSendDestination";
import { executePreparedComposerTurn } from "../lib/executePreparedComposerTurn";
import { settleComposerTurnExecution } from "../lib/settleComposerTurnExecution";
import { useStore } from "../store";
import type { Thread } from "../types";
import type { ComposerSendRoutingResult } from "./useComposerSendRoutingController";
import type { useComposerSendPresentationController } from "./useComposerSendPresentationController";

type ReadyRouting = Extract<ComposerSendRoutingResult, { kind: "ready" }>;
type ExecuteInput = Parameters<typeof executePreparedComposerTurn>[0];
type SettleInput = Parameters<typeof settleComposerTurnExecution>[0];
type PresentComposerSend = ReturnType<typeof useComposerSendPresentationController>;

type DispatchStep = "create-worktree" | "prepare-thread" | "run-setup-action" | "start-session";

export function useComposerTurnStartController(input: {
  destination: {
    activeRootBranch: string | null;
    chatWorkspaceRoot: string | null;
    isContainerLandingProject: boolean;
    isHomeChatContainer: boolean;
    isStudioContainer: boolean;
    selectedWorkspaceRoot: string | null;
    syncServerShellSnapshot: (snapshot: OrchestrationShellSnapshot) => void;
    clearProjectDraftThreadId: ComposerDraftStoreState["clearProjectDraftThreadId"];
    setDraftThreadContext: ComposerDraftStoreState["setDraftThreadContext"];
    setStoreThreadError: (threadId: ThreadId, error: string | null) => void;
  };
  thread: {
    isServerThread: boolean;
    isLocalDraftThread: boolean;
    hasNativeUserMessages: boolean;
    notes: string;
  };
  presentComposerSend: PresentComposerSend;
  sendInFlightRef: MutableRefObject<boolean>;
  beginLocalDispatch: (state?: {
    worktreeSetupStepId: DispatchStep;
    setupScriptName: string | null;
  }) => void;
  failLocalDispatchWorktreeSetup: () => void;
  resetLocalDispatch: () => void;
  scheduleFailedWorktreeSetupDispatchReset: () => void;
  createWorktree: ExecuteInput["createWorktree"];
  setStoreThreadWorkspace: (
    threadId: ThreadId,
    workspace: Parameters<ExecuteInput["onServerWorkspaceReady"]>[0],
  ) => void;
  dispatchThreadNotes: ExecuteInput["dispatchThreadNotes"];
  runProjectScript: ExecuteInput["runProjectScript"];
  persistThreadSettings: (request: {
    threadId: ThreadId;
    createdAt: string;
    modelSelection: ReadyRouting["admission"]["snapshot"]["modelSelection"];
    runtimeMode: RuntimeMode;
    interactionMode: ReadyRouting["admission"]["snapshot"]["interactionMode"];
  }) => Promise<unknown>;
  rememberProviderDispatch: (request: {
    threadId: ThreadId;
    provider: ProviderKind;
    providerOptions: ProviderStartOptions | undefined;
  }) => void;
  assistantDeliveryMode: ExecuteInput["turn"]["assistantDeliveryMode"];
  beginNonCodexSteerGate: () => void;
  openPlanSidebar: () => void;
  clearRestoredSource: (threadId: ThreadId, value: null) => void;
  restore: Omit<
    SettleInput["restore"],
    "threadId" | "messageId" | "sourceProposedPlan" | "snapshot"
  >;
  setThreadError: SettleInput["setThreadError"];
}) {
  return useCallback(
    async (request: {
      api: NativeApi;
      activeThread: Thread;
      routing: ReadyRouting;
      dispatchMode: "queue" | "steer";
    }): Promise<boolean> => {
      const admission = request.routing.admission;
      const snapshot = admission.snapshot;
      const threadId = request.activeThread.id;
      const destination = await prepareComposerSendDestination({
        api: request.api,
        activeProject: request.routing.activeProject,
        activeThread: request.activeThread,
        activeRootBranch: input.destination.activeRootBranch,
        chatWorkspaceRoot: input.destination.chatWorkspaceRoot,
        content: {
          trimmedPrompt: snapshot.trimmedPrompt,
          images: snapshot.images,
          files: snapshot.files,
          assistantSelections: snapshot.assistantSelections,
          terminalContexts: snapshot.terminalContexts,
          fileComments: snapshot.fileComments,
          pastedTexts: snapshot.pastedTexts,
        },
        createdAt: new Date(),
        initialEnvMode: snapshot.envMode,
        isContainerLandingProject: input.destination.isContainerLandingProject,
        isFirstMessage: !input.thread.isServerThread || !input.thread.hasNativeUserMessages,
        isHomeChatContainer: input.destination.isHomeChatContainer,
        isStudioContainer: input.destination.isStudioContainer,
        projects: useStore.getState().projects,
        selectedWorkspaceRoot: input.destination.selectedWorkspaceRoot,
      });
      if (destination.kind === "blocked") {
        input.destination.setStoreThreadError(threadId, destination.error);
        return false;
      }

      const target = destination.target;
      if (target.shellSnapshotToSync) {
        input.destination.syncServerShellSnapshot(target.shellSnapshotToSync);
      }
      if (target.shouldReassociateDraft) {
        input.destination.clearProjectDraftThreadId(target.targetProjectId);
        input.destination.setDraftThreadContext(threadId, {
          projectId: target.targetProjectId,
          envMode: "local",
          worktreePath: null,
          branch: null,
        });
      }
      const setupScriptName = target.setupScriptForWorktree?.name ?? null;
      input.sendInFlightRef.current = true;
      input.beginLocalDispatch(
        target.baseBranchForWorktree
          ? { worktreeSetupStepId: "create-worktree", setupScriptName }
          : undefined,
      );

      const presented = input.presentComposerSend({
        outgoing: {
          prompt: snapshot.prompt,
          images: snapshot.images,
          files: snapshot.files,
          assistantSelections: snapshot.assistantSelections,
          fileComments: snapshot.fileComments,
          terminalContexts: snapshot.terminalContexts,
          pastedTexts: snapshot.pastedTexts,
          selectedSkills: snapshot.skills,
          selectedMentions: snapshot.mentions,
          provider: snapshot.selectedProvider,
          model: snapshot.selectedModel,
          effort: snapshot.selectedPromptEffort,
        },
        dispatchMode: request.dispatchMode,
        expiredTerminalContextCount: snapshot.expiredTerminalContextCount,
        isLiveComposerSend: snapshot.queuedTurn === null,
        isLivePlanFollowUpSubmission: admission.isLivePlanFollowUpSubmission,
        interactionMode: snapshot.interactionMode,
      });

      let createdServerThreadForLocalDraft = false;
      let turnStartSucceeded = false;
      let executionFailure: { error: unknown } | null = null;
      try {
        await executePreparedComposerTurn({
          api: request.api,
          thread: {
            id: threadId,
            isServerThread: input.thread.isServerThread,
            isLocalDraftThread: input.thread.isLocalDraftThread,
            activeCreatedAt: request.activeThread.createdAt,
            activeLastKnownPr: request.activeThread.lastKnownPr,
            notes: input.thread.notes,
            title: destination.title,
            targetProjectId: target.targetProjectId,
            targetProjectKind: target.targetProjectKind,
            targetProjectCwd: target.targetProjectCwd,
            targetProjectDefaultModelSelection: target.targetProjectDefaultModelSelection,
            envMode: target.nextThreadEnvMode,
            initialBranch: target.nextThreadBranch,
            initialWorktreePath: target.nextThreadWorktreePath,
            baseBranchForWorktree: target.baseBranchForWorktree,
            setupScriptForWorktree: target.setupScriptForWorktree,
          },
          turn: {
            messageId: presented.messageId,
            messageText: presented.text,
            attachments: presented.attachmentsPromise,
            mentionedSkills: presented.mentionedSkills,
            mentionedMentions: presented.mentionedMentions,
            modelSelection: snapshot.modelSelection,
            selectedModel: snapshot.selectedModel,
            providerOptions: snapshot.providerOptions,
            assistantDeliveryMode: input.assistantDeliveryMode,
            dispatchMode: request.dispatchMode,
            runtimeMode: snapshot.runtimeMode,
            interactionMode: snapshot.interactionMode,
            sourceProposedPlan: admission.sourceProposedPlan,
            createdAt: presented.messageCreatedAt,
          },
          createWorktree: input.createWorktree,
          onPreparingThread: () =>
            input.beginLocalDispatch({
              worktreeSetupStepId: "prepare-thread",
              setupScriptName,
            }),
          onServerWorkspaceReady: (workspace) => input.setStoreThreadWorkspace(threadId, workspace),
          dispatchThreadNotes: input.dispatchThreadNotes,
          onDraftPromotion: (created) => {
            createdServerThreadForLocalDraft = created;
          },
          onSetupScriptRunning: (name) =>
            input.beginLocalDispatch({
              worktreeSetupStepId: "run-setup-action",
              setupScriptName: name,
            }),
          runProjectScript: input.runProjectScript,
          waitForTerminalActivity: waitForSetupScriptTerminalActivity,
          persistSettings: input.thread.isServerThread
            ? () =>
                input.persistThreadSettings({
                  threadId,
                  createdAt: presented.messageCreatedAt,
                  modelSelection: snapshot.modelSelection,
                  runtimeMode: snapshot.runtimeMode,
                  interactionMode: snapshot.interactionMode,
                })
            : null,
          onStartingSession: () =>
            input.beginLocalDispatch(
              target.baseBranchForWorktree
                ? { worktreeSetupStepId: "start-session", setupScriptName }
                : undefined,
            ),
          rememberProviderDispatch: () =>
            input.rememberProviderDispatch({
              threadId,
              provider: snapshot.modelSelection.provider,
              providerOptions: snapshot.providerOptions,
            }),
        });
        turnStartSucceeded = true;
        if (request.dispatchMode === "steer" && snapshot.modelSelection.provider !== "codex") {
          input.beginNonCodexSteerGate();
        }
        if (admission.sourceProposedPlan) input.openPlanSidebar();
        if (snapshot.queuedTurn === null) input.clearRestoredSource(threadId, null);
      } catch (error) {
        executionFailure = { error };
      }

      return settleComposerTurnExecution({
        api: request.api,
        threadId,
        failure: executionFailure,
        turnStartSucceeded,
        createdServerThreadForLocalDraft,
        shouldRestoreComposer: snapshot.queuedTurn === null,
        restore: {
          ...input.restore,
          threadId,
          messageId: presented.messageId,
          sourceProposedPlan: admission.sourceProposedPlan,
          snapshot: {
            prompt: snapshot.prompt,
            images: presented.images,
            files: presented.files,
            assistantSelections: presented.assistantSelections,
            fileComments: presented.fileComments,
            terminalContexts: presented.terminalContexts,
            pastedTexts: presented.pastedTexts,
            skills: presented.skills,
            mentions: presented.mentions,
          },
        },
        hasWorktreeSetup: Boolean(target.baseBranchForWorktree),
        failWorktreeSetup: input.failLocalDispatchWorktreeSetup,
        releaseSend: () => {
          input.sendInFlightRef.current = false;
        },
        resetLocalDispatch: input.resetLocalDispatch,
        scheduleFailedWorktreeSetupDispatchReset: input.scheduleFailedWorktreeSetupDispatchReset,
        setThreadError: input.setThreadError,
      });
    },
    [input],
  );
}
