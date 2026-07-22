// FILE: useChatTurnDispatchOwner.ts
// Purpose: Own chat turn admission, dispatch, edit, queue, and plan orchestration.
// Layer: Web chat controller

import { useCallback, useRef, type MutableRefObject } from "react";

import type { ComposerPromptEditorHandle } from "../components/ComposerPromptEditor";
import { type QueuedComposerChatTurn, useComposerDraftStore } from "../composerDraftStore";
import { prepareComposerSendSnapshot } from "../lib/prepareComposerSendSnapshot";
import { randomUUID } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useComposerSendAdmissionController } from "./useComposerSendAdmissionController";
import { useComposerSendPresentationController } from "./useComposerSendPresentationController";
import { useComposerSendRoutingController } from "./useComposerSendRoutingController";
import { useComposerTurnStartController } from "./useComposerTurnStartController";
import { useEditUserMessageController } from "./useEditUserMessageController";
import { usePlanFollowUpSendController } from "./usePlanFollowUpSendController";
import { usePlanImplementationThreadController } from "./usePlanImplementationThreadController";
import { useQueuedComposerController } from "./useQueuedComposerController";

type PlanFollowUpInput = Parameters<typeof usePlanFollowUpSendController>[0];
type AdmissionInput = Parameters<typeof useComposerSendAdmissionController>[0];
type PresentationInput = Parameters<typeof useComposerSendPresentationController>[0];
type RoutingInput = Parameters<typeof useComposerSendRoutingController>[0];
type TurnStartInput = Parameters<typeof useComposerTurnStartController>[0];
type EditInput = Parameters<typeof useEditUserMessageController>[0];
type QueueInput = Parameters<typeof useQueuedComposerController>[0];
type PlanImplementationInput = Parameters<typeof usePlanImplementationThreadController>[0];
type LiveSendState = Parameters<typeof prepareComposerSendSnapshot>[0]["live"];
type DispatchMode = "queue" | "steer";

type ComposerContent = Pick<
  LiveSendState,
  | "images"
  | "files"
  | "assistantSelections"
  | "fileComments"
  | "terminalContexts"
  | "pastedTexts"
  | "envMode"
>;

export interface ChatTurnDispatchOwnerInput {
  readonly thread: {
    readonly routeId: QueueInput["threadId"];
    readonly active: PlanImplementationInput["activeThread"];
    readonly project: PlanImplementationInput["activeProject"];
    readonly associatedWorktree: PlanImplementationInput["associatedWorktree"];
    readonly state: TurnStartInput["thread"];
    readonly destination: TurnStartInput["destination"];
    readonly plan: {
      readonly proposed: PlanImplementationInput["proposedPlan"];
      readonly showFollowUpPrompt: AdmissionInput["showPlanFollowUpPrompt"];
      readonly openForCurrentTurn: PlanFollowUpInput["openPlanSidebar"];
      readonly openOnNextThread: PlanImplementationInput["openPlanSidebarOnNextThread"];
    };
  };
  readonly composer: {
    readonly editorRef: MutableRefObject<ComposerPromptEditorHandle | null>;
    readonly promptRef: PresentationInput["promptRef"];
    readonly content: ComposerContent;
    readonly selectedSkillsRef: MutableRefObject<LiveSendState["skills"]>;
    readonly selectedMentionsRef: MutableRefObject<LiveSendState["mentions"]>;
    readonly isCenteredEmptyLanding: PresentationInput["isCenteredEmptyLanding"];
    readonly environmentPanel: {
      readonly defaultOpen: PresentationInput["environmentPanelDefaultOpen"];
      readonly preferenceOpen: PresentationInput["environmentPanelPreferenceOpen"];
      readonly setPreferenceOpen: PresentationInput["setEnvironmentPanelPreferenceOpen"];
    };
    readonly actions: {
      readonly clearInput: AdmissionInput["clearComposerInput"];
      readonly focus: AdmissionInput["focus"];
      readonly handleStandaloneSlashCommand: AdmissionInput["handleStandaloneSlashCommand"];
      readonly clearPromptHistory: PresentationInput["clearPromptHistory"];
      readonly clearDraftContent: PresentationInput["clearComposerDraftContent"];
      readonly setInteractionMode: PlanFollowUpInput["setInteractionMode"];
      readonly setHighlightedItemId: PresentationInput["setComposerHighlightedItemId"];
      readonly setCursor: PresentationInput["setComposerCursor"];
      readonly setTrigger: PresentationInput["setComposerTrigger"];
    };
    readonly restored: {
      readonly resolveForPrompt: AdmissionInput["resolveRestoredSource"];
      readonly clearSource: TurnStartInput["clearRestoredSource"];
      readonly afterFailure: Omit<TurnStartInput["restore"], "removeOptimisticUserMessage">;
    };
    readonly queue: {
      readonly turns: QueueInput["queuedTurns"];
      readonly enqueue: AdmissionInput["enqueueTurn"];
      readonly insert: QueueInput["insertQueuedTurn"];
      readonly remove: QueueInput["removeQueuedTurn"];
      readonly restore: QueueInput["restoreQueuedTurn"];
    };
  };
  readonly provider: {
    readonly selectedProvider: PlanFollowUpInput["selectedProvider"];
    readonly selectedModel: PlanFollowUpInput["selectedModel"];
    readonly selectedPromptEffort: PlanFollowUpInput["selectedPromptEffort"];
    readonly modelSelection: PlanFollowUpInput["modelSelection"];
    readonly options: PlanFollowUpInput["providerOptions"];
    readonly rememberDispatch: PlanFollowUpInput["rememberCustomBinaryPath"];
  };
  readonly runtime: {
    readonly assistantDeliveryMode: PlanFollowUpInput["assistantDeliveryMode"];
    readonly runtimeMode: PlanFollowUpInput["runtimeMode"];
    readonly interactionMode: EditInput["interactionMode"];
    readonly phase: QueueInput["phase"];
    readonly hasLiveTurn: AdmissionInput["hasLiveTurn"];
    readonly isSendBusy: PlanFollowUpInput["isSendBusy"];
    readonly isConnecting: PlanFollowUpInput["isConnecting"];
    readonly isVoiceTranscribing: boolean;
    readonly isRevertingCheckpoint: EditInput["isRevertingCheckpoint"];
    readonly setHistoryMutationBusy: EditInput["setHistoryMutationBusy"];
    readonly nonCodexSteerGateActive: QueueInput["nonCodexSteerGateActive"];
    readonly beginNonCodexSteerGate: PlanFollowUpInput["beginNonCodexSteerGate"];
    readonly isSendPreflightInFlight: QueueInput["isSendPreflightInFlight"];
    readonly runSendPreflight: RoutingInput["runSendPreflight"];
    readonly pending: {
      readonly hasApproval: QueueInput["hasPendingApproval"];
      readonly hasProgress: QueueInput["hasPendingProgress"];
      readonly userInputCount: QueueInput["pendingUserInputCount"];
      readonly submitFromComposer: (text: string) => boolean | Promise<boolean>;
    };
  };
  readonly localDispatch: {
    readonly sendInFlightRef: TurnStartInput["sendInFlightRef"];
    readonly begin: TurnStartInput["beginLocalDispatch"];
    readonly reset: TurnStartInput["resetLocalDispatch"];
    readonly failWorktreeSetup: TurnStartInput["failLocalDispatchWorktreeSetup"];
    readonly scheduleFailedWorktreeSetupReset: TurnStartInput["scheduleFailedWorktreeSetupDispatchReset"];
    readonly createWorktree: TurnStartInput["createWorktree"];
    readonly runProjectScript: TurnStartInput["runProjectScript"];
  };
  readonly transcript: {
    readonly appendOptimisticUserMessage: PlanFollowUpInput["appendOptimisticUserMessage"];
    readonly removeOptimisticUserMessage: PlanFollowUpInput["removeOptimisticUserMessage"];
    readonly armAutoFollow: PlanFollowUpInput["armTranscriptAutoFollow"];
    readonly setThreadError: PlanFollowUpInput["setThreadError"];
  };
  readonly automation: RoutingInput["automation"];
  readonly persistence: {
    readonly persistThreadSettings: PlanFollowUpInput["persistThreadSettings"];
    readonly setThreadWorkspace: TurnStartInput["setStoreThreadWorkspace"];
    readonly dispatchThreadNotes: TurnStartInput["dispatchThreadNotes"];
  };
}

export function useChatTurnDispatchOwner(input: ChatTurnDispatchOwnerInput) {
  const visualizationFollowUpRef = useRef<(prompt: string) => Promise<boolean>>(async () => false);
  const visualizationFollowUp = useCallback(
    (prompt: string) => visualizationFollowUpRef.current(prompt),
    [],
  );
  const activeThreadId = input.thread.active?.id ?? null;
  const dispatchThreadId = activeThreadId ?? input.thread.routeId;

  const submitPlanFollowUp = usePlanFollowUpSendController({
    activeThreadId,
    proposedPlan: input.thread.plan.proposed,
    isServerThread: input.thread.state.isServerThread,
    isSendBusy: input.runtime.isSendBusy,
    isConnecting: input.runtime.isConnecting,
    sendInFlightRef: input.localDispatch.sendInFlightRef,
    selectedProvider: input.provider.selectedProvider,
    selectedModel: input.provider.selectedModel,
    selectedPromptEffort: input.provider.selectedPromptEffort,
    modelSelection: input.provider.modelSelection,
    providerOptions: input.provider.options,
    assistantDeliveryMode: input.runtime.assistantDeliveryMode,
    runtimeMode: input.runtime.runtimeMode,
    beginLocalDispatch: input.localDispatch.begin,
    resetLocalDispatch: input.localDispatch.reset,
    setThreadError: input.transcript.setThreadError,
    appendOptimisticUserMessage: input.transcript.appendOptimisticUserMessage,
    removeOptimisticUserMessage: input.transcript.removeOptimisticUserMessage,
    armTranscriptAutoFollow: input.transcript.armAutoFollow,
    persistThreadSettings: input.persistence.persistThreadSettings,
    setInteractionMode: input.composer.actions.setInteractionMode,
    rememberCustomBinaryPath: input.provider.rememberDispatch,
    beginNonCodexSteerGate: input.runtime.beginNonCodexSteerGate,
    openPlanSidebar: input.thread.plan.openForCurrentTurn,
  });

  const admitSend = useComposerSendAdmissionController({
    activeThreadId,
    activeProposedPlan: input.thread.plan.proposed,
    showPlanFollowUpPrompt: input.thread.plan.showFollowUpPrompt,
    hasLiveTurn: input.runtime.hasLiveTurn,
    selectedProvider: input.provider.selectedProvider,
    selectedModel: input.provider.selectedModel,
    selectedPromptEffort: input.provider.selectedPromptEffort,
    modelSelection: input.provider.modelSelection,
    providerOptions: input.provider.options,
    runtimeMode: input.runtime.runtimeMode,
    resolveRestoredSource: input.composer.restored.resolveForPrompt,
    clearComposerInput: input.composer.actions.clearInput,
    focus: input.composer.actions.focus,
    enqueueTurn: input.composer.queue.enqueue,
    submitPlanFollowUp,
    handleStandaloneSlashCommand: input.composer.actions.handleStandaloneSlashCommand,
    clearPendingAutomationConversation: input.automation.clearConversation,
  });

  const presentSend = useComposerSendPresentationController({
    threadId: dispatchThreadId,
    isCenteredEmptyLanding: input.composer.isCenteredEmptyLanding,
    environmentPanelDefaultOpen: input.composer.environmentPanel.defaultOpen,
    environmentPanelPreferenceOpen: input.composer.environmentPanel.preferenceOpen,
    setEnvironmentPanelPreferenceOpen: input.composer.environmentPanel.setPreferenceOpen,
    appendOptimisticUserMessage: input.transcript.appendOptimisticUserMessage,
    armTranscriptAutoFollow: input.transcript.armAutoFollow,
    setThreadError: input.transcript.setThreadError,
    clearPromptHistory: input.composer.actions.clearPromptHistory,
    promptRef: input.composer.promptRef,
    clearComposerDraftContent: input.composer.actions.clearDraftContent,
    setComposerInteractionMode: input.composer.actions.setInteractionMode,
    setComposerHighlightedItemId: input.composer.actions.setHighlightedItemId,
    setComposerCursor: input.composer.actions.setCursor,
    setComposerTrigger: input.composer.actions.setTrigger,
    focus: input.composer.actions.focus,
  });

  const routeSend = useComposerSendRoutingController({
    activeProject: input.thread.project,
    threadId: dispatchThreadId,
    hasLiveTurn: input.runtime.hasLiveTurn,
    automation: input.automation,
    runSendPreflight: input.runtime.runSendPreflight,
    clearComposerInput: input.composer.actions.clearInput,
    focus: input.composer.actions.focus,
    enqueueTurn: input.composer.queue.enqueue,
  });

  const startTurn = useComposerTurnStartController({
    destination: input.thread.destination,
    thread: input.thread.state,
    presentComposerSend: presentSend,
    sendInFlightRef: input.localDispatch.sendInFlightRef,
    beginLocalDispatch: input.localDispatch.begin,
    failLocalDispatchWorktreeSetup: input.localDispatch.failWorktreeSetup,
    resetLocalDispatch: input.localDispatch.reset,
    scheduleFailedWorktreeSetupDispatchReset: input.localDispatch.scheduleFailedWorktreeSetupReset,
    createWorktree: input.localDispatch.createWorktree,
    setStoreThreadWorkspace: input.persistence.setThreadWorkspace,
    dispatchThreadNotes: input.persistence.dispatchThreadNotes,
    runProjectScript: input.localDispatch.runProjectScript,
    persistThreadSettings: input.persistence.persistThreadSettings,
    rememberProviderDispatch: input.provider.rememberDispatch,
    assistantDeliveryMode: input.runtime.assistantDeliveryMode,
    beginNonCodexSteerGate: input.runtime.beginNonCodexSteerGate,
    openPlanSidebar: input.thread.plan.openForCurrentTurn,
    clearRestoredSource: input.composer.restored.clearSource,
    restore: {
      ...input.composer.restored.afterFailure,
      removeOptimisticUserMessage: input.transcript.removeOptimisticUserMessage,
    },
    setThreadError: input.transcript.setThreadError,
  });

  const dispatch = async (
    event?: { preventDefault: () => void },
    dispatchMode: DispatchMode = "queue",
    queuedTurn?: QueuedComposerChatTurn,
  ): Promise<boolean> => {
    event?.preventDefault();
    const api = readNativeApi();
    const activeThread = input.thread.active;
    if (
      !api ||
      !activeThread ||
      input.runtime.isSendBusy ||
      input.runtime.isConnecting ||
      input.runtime.isVoiceTranscribing ||
      input.runtime.isSendPreflightInFlight() ||
      input.localDispatch.sendInFlightRef.current
    ) {
      return false;
    }
    if (input.runtime.pending.hasProgress) {
      const liveComposerSnapshot = input.composer.editorRef.current?.readSnapshot() ?? null;
      const livePendingAnswerText = liveComposerSnapshot?.value ?? input.composer.promptRef.current;
      return input.runtime.pending.submitFromComposer(livePendingAnswerText);
    }
    const liveComposerSnapshot =
      queuedTurn === undefined ? (input.composer.editorRef.current?.readSnapshot() ?? null) : null;
    const sendSnapshot = await prepareComposerSendSnapshot({
      ...(queuedTurn !== undefined ? { queuedTurn } : {}),
      live: {
        prompt: liveComposerSnapshot?.value ?? input.composer.promptRef.current,
        ...input.composer.content,
        skills: input.composer.selectedSkillsRef.current,
        mentions: input.composer.selectedMentionsRef.current,
        selectedProvider: input.provider.selectedProvider,
        selectedModel: input.provider.selectedModel,
        selectedPromptEffort: input.provider.selectedPromptEffort,
        modelSelection: input.provider.modelSelection,
        providerOptions: input.provider.options,
        runtimeMode: input.runtime.runtimeMode,
        interactionMode: input.runtime.interactionMode,
      },
      persistedAttachments:
        useComposerDraftStore.getState().draftsByThreadId[activeThread.id]?.persistedAttachments ??
        [],
    });
    const admission = await admitSend(sendSnapshot, dispatchMode);
    if (admission.kind === "handled") return admission.result;
    const routing = await routeSend({
      api,
      admission,
      dispatchMode,
      previewTrimmedPrompt: sendSnapshot.trimmedPrompt,
    });
    if (routing.kind === "handled") return routing.result;
    return startTurn({ api, activeThread, routing, dispatchMode });
  };

  visualizationFollowUpRef.current = async (rawPrompt) => {
    const prompt = rawPrompt.trim();
    if (
      !prompt ||
      prompt.length > 8_000 ||
      prompt.startsWith("/") ||
      input.runtime.pending.hasProgress
    ) {
      return false;
    }
    const queuedTurn: QueuedComposerChatTurn = {
      id: randomUUID(),
      kind: "chat",
      createdAt: new Date().toISOString(),
      previewText: prompt,
      prompt,
      images: [],
      files: [],
      assistantSelections: [],
      terminalContexts: [],
      fileComments: [],
      pastedTexts: [],
      skills: [],
      mentions: [],
      selectedProvider: input.provider.selectedProvider,
      selectedModel: input.provider.selectedModel,
      selectedPromptEffort: input.provider.selectedPromptEffort,
      modelSelection: input.provider.modelSelection,
      ...(input.provider.options ? { providerOptionsForDispatch: input.provider.options } : {}),
      runtimeMode: input.runtime.runtimeMode,
      interactionMode: input.runtime.interactionMode,
      envMode: input.composer.content.envMode,
    };
    return dispatch(undefined, "queue", queuedTurn);
  };

  const editUserMessage = useEditUserMessageController({
    activeThread: input.thread.active,
    isServerThread: input.thread.state.isServerThread,
    isRevertingCheckpoint: input.runtime.isRevertingCheckpoint,
    isSendBusy: input.runtime.isSendBusy,
    isConnecting: input.runtime.isConnecting,
    sendInFlightRef: input.localDispatch.sendInFlightRef,
    selectedProvider: input.provider.selectedProvider,
    selectedModel: input.provider.selectedModel,
    selectedPromptEffort: input.provider.selectedPromptEffort,
    selectedModelSelection: input.provider.modelSelection,
    providerOptionsForDispatch: input.provider.options,
    assistantDeliveryMode: input.runtime.assistantDeliveryMode,
    runtimeMode: input.runtime.runtimeMode,
    interactionMode: input.runtime.interactionMode,
    setHistoryMutationBusy: input.runtime.setHistoryMutationBusy,
    setThreadError: input.transcript.setThreadError,
    persistThreadSettingsForNextTurn: input.persistence.persistThreadSettings,
  });

  const queue = useQueuedComposerController({
    threadId: input.thread.routeId,
    queuedTurns: input.composer.queue.turns,
    phase: input.runtime.phase,
    nonCodexSteerGateActive: input.runtime.nonCodexSteerGateActive,
    hasLiveTurn: input.runtime.hasLiveTurn,
    isSendBusy: input.runtime.isSendBusy,
    isConnecting: input.runtime.isConnecting,
    hasPendingApproval: input.runtime.pending.hasApproval,
    hasPendingProgress: input.runtime.pending.hasProgress,
    pendingUserInputCount: input.runtime.pending.userInputCount,
    sendInFlightRef: input.localDispatch.sendInFlightRef,
    isSendPreflightInFlight: input.runtime.isSendPreflightInFlight,
    dispatchChat: dispatch,
    dispatchPlanFollowUp: submitPlanFollowUp,
    insertQueuedTurn: input.composer.queue.insert,
    removeQueuedTurn: input.composer.queue.remove,
    restoreQueuedTurn: input.composer.queue.restore,
  });

  const implementInNewThread = usePlanImplementationThreadController({
    activeThread: input.thread.active,
    activeProject: input.thread.project,
    proposedPlan: input.thread.plan.proposed,
    associatedWorktree: input.thread.associatedWorktree,
    isServerThread: input.thread.state.isServerThread,
    isSendBusy: input.runtime.isSendBusy,
    isConnecting: input.runtime.isConnecting,
    sendInFlightRef: input.localDispatch.sendInFlightRef,
    modelSelection: input.provider.modelSelection,
    selectedPromptEffort: input.provider.selectedPromptEffort,
    providerOptions: input.provider.options,
    assistantDeliveryMode: input.runtime.assistantDeliveryMode,
    runtimeMode: input.runtime.runtimeMode,
    beginLocalDispatch: input.localDispatch.begin,
    resetLocalDispatch: input.localDispatch.reset,
    rememberCustomBinaryPath: input.provider.rememberDispatch,
    openPlanSidebarOnNextThread: input.thread.plan.openOnNextThread,
  });

  return {
    send: { dispatch, visualizationFollowUp },
    edit: { userMessage: editUserMessage },
    queue: {
      edit: queue.editQueuedTurn,
      remove: queue.removeQueuedTurn,
      steer: queue.steerQueuedTurn,
    },
    plan: {
      submitFollowUp: submitPlanFollowUp,
      implementInNewThread,
    },
  };
}
