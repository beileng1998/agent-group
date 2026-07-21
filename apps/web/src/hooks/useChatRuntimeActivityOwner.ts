// FILE: useChatRuntimeActivityOwner.ts
// Purpose: Own one chat's runtime, activity, interaction, and optimistic transcript state.
// Layer: Web chat runtime owner

import type { ProviderInteractionMode, RuntimeMode, ThreadId } from "@agent-group/contracts";
import { useCallback, useMemo } from "react";

import { shouldEnableComposerPastedTextCollapse } from "../components/ChatView.logic";
import { useComposerStackedChromeMeasurement } from "../components/chat/useComposerLayoutController";
import {
  derivePhase,
  deriveTimelineEntries,
  hasActionableProposedPlan,
  isSessionRunningTurn,
} from "../session-logic";
import type { ChatMessage, Thread } from "../types";
import { useActiveTurnPresentationController } from "./useActiveTurnPresentationController";
import { useAutomationConversationController } from "./useAutomationConversationController";
import { useComposerPromptHistoryController } from "./useComposerPromptHistoryController";
import { useLocalDispatchController } from "./useLocalDispatchController";
import { useNonCodexSteerGate } from "./useNonCodexSteerGate";
import { useOptimisticTranscriptController } from "./useOptimisticTranscriptController";
import { usePendingInteractionController } from "./usePendingInteractionController";
import { usePlanSidebarController } from "./usePlanSidebarController";
import { useSidechatPromotion } from "./useSidechatPromotion";
import { useThreadActivityController } from "./useThreadActivityController";
import { useThreadCheckpointController } from "./useThreadCheckpointController";

type PendingInteractionInput = Parameters<typeof usePendingInteractionController>[0];
type PromptHistoryInput = Parameters<typeof useComposerPromptHistoryController>[0];
type SetPendingError = PendingInteractionInput["setThreadError"];
type SetThreadError = Parameters<typeof useThreadCheckpointController>[0]["setThreadError"];
type SetRuntimeMode = PendingInteractionInput["setRuntimeMode"];
type SetDraftPrompt = Parameters<
  typeof useAutomationConversationController
>[0]["setComposerDraftPrompt"];
type FinishSidechatPromotion = Parameters<typeof useSidechatPromotion>[0]["onPromoted"];

export interface ChatRuntimeActivityOwnerInput {
  readonly thread: {
    readonly id: ThreadId;
    readonly activeId: ThreadId | null;
    readonly active: Thread | undefined;
    readonly latestTurn: Thread["latestTurn"] | null;
    readonly activities: Thread["activities"];
    readonly latestTurnSettled: boolean;
    readonly latestTurnLive: boolean;
    readonly hasLiveTurnTail: boolean;
    readonly serverMessages: readonly ChatMessage[] | undefined;
    readonly promptHistoryMessages: readonly ChatMessage[] | undefined;
    readonly hasSidechatSource: boolean;
    readonly isTemporarySidechat: boolean;
    readonly showDebugTaskBanner: boolean;
    readonly setPendingError: SetPendingError;
    readonly setError: SetThreadError;
  };
  readonly composer: {
    readonly pending: Omit<
      PendingInteractionInput,
      "activeThreadId" | "activities" | "runtimeMode" | "setThreadError"
    >;
    readonly promptHistory: Omit<PromptHistoryInput, "threadId" | "history">;
    readonly setDraftPrompt: SetDraftPrompt;
  };
  readonly provider: {
    readonly runtimeMode: RuntimeMode;
    readonly setRuntimeMode: SetRuntimeMode;
  };
  readonly settings: {
    readonly interactionMode: ProviderInteractionMode;
  };
  readonly navigation: {
    readonly finishSidechatPromotion: FinishSidechatPromotion;
  };
}

export function useChatRuntimeActivityOwner(input: ChatRuntimeActivityOwnerInput) {
  const phase = derivePhase(input.thread.active?.session ?? null);
  const isConnecting = phase === "connecting";
  const steerGate = useNonCodexSteerGate({
    threadId: input.thread.id,
    phase,
    sessionErrored: input.thread.active?.session?.status === "error",
  });

  const activity = useThreadActivityController({
    activeThread: input.thread.active,
    latestTurn: input.thread.latestTurn,
    threadActivities: input.thread.activities,
    latestTurnSettled: input.thread.latestTurnSettled,
    showDebugTaskBanner: input.thread.showDebugTaskBanner,
  });
  const pendingInteraction = usePendingInteractionController({
    ...input.composer.pending,
    activeThreadId: input.thread.activeId,
    activities: input.thread.activities,
    runtimeMode: input.provider.runtimeMode,
    setRuntimeMode: input.provider.setRuntimeMode,
    setThreadError: input.thread.setPendingError,
  });
  const planSidebar = usePlanSidebarController({
    activeThread: input.thread.active,
    latestTurn: input.thread.latestTurn,
    latestTurnSettled: input.thread.latestTurnSettled,
    activeTaskListTurnId: activity.activeTaskList?.turnId ?? null,
  });
  const stackedChrome = useComposerStackedChromeMeasurement();

  const showFollowUpPrompt =
    pendingInteraction.pendingUserInputs.length === 0 &&
    input.settings.interactionMode === "plan" &&
    input.thread.latestTurnSettled &&
    hasActionableProposedPlan(planSidebar.activeProposedPlan);
  const activeApproval = pendingInteraction.pendingApprovals[0] ?? null;
  const localDispatch = useLocalDispatchController({
    activeThread: input.thread.active,
    phase,
    hasPendingApproval: activeApproval !== null,
    hasPendingUserInput: pendingInteraction.activePendingUserInput !== null,
  });
  const hasLiveTurn = isSessionRunningTurn(input.thread.active?.session);
  const automationConversation = useAutomationConversationController({
    threadId: input.thread.id,
    hasLiveTurn,
    promptRef: input.composer.pending.promptRef,
    setComposerDraftPrompt: input.composer.setDraftPrompt,
  });
  const optimisticTranscript = useOptimisticTranscriptController({
    threadId: input.thread.id,
    activeThreadId: input.thread.activeId,
    serverMessages: input.thread.serverMessages,
    promptHistoryMessages: input.thread.promptHistoryMessages,
    hasSidechatSource: input.thread.hasSidechatSource,
    automationConversation: automationConversation.conversation,
  });
  const promptHistory = useComposerPromptHistoryController({
    ...input.composer.promptHistory,
    threadId: input.thread.id,
    history: optimisticTranscript.promptHistory,
  });
  const checkpoint = useThreadCheckpointController({
    activeThread: input.thread.active,
    hasLiveTurn,
    isConnecting,
    isSendBusy: localDispatch.isSendBusy,
    setThreadError: input.thread.setError,
  });

  const hasLiveTranscriptOutput =
    hasLiveTurn || localDispatch.isSendBusy || checkpoint.isRevertingCheckpoint;
  const isWorking = hasLiveTranscriptOutput || isConnecting;
  const hasStreamingAssistantText =
    input.thread.active?.messages.some(
      (message) => message.role === "assistant" && message.streaming,
    ) ?? false;
  const activeTurn = useActiveTurnPresentationController({
    activeThreadId: input.thread.activeId,
    latestTurn: input.thread.latestTurn,
    session: input.thread.active?.session ?? null,
    hasLiveTurnTail: input.thread.hasLiveTurnTail,
    hasLiveTurn,
    hasLiveTranscriptOutput,
    latestTurnLive: input.thread.latestTurnLive,
  });
  const finishSidechatPromotion = input.navigation.finishSidechatPromotion;
  const onPromoted = useCallback(
    (promotedThreadId: ThreadId) => finishSidechatPromotion(promotedThreadId),
    [finishSidechatPromotion],
  );
  const sidechatBlocked =
    isWorking ||
    pendingInteraction.pendingApprovals.length > 0 ||
    pendingInteraction.pendingUserInputs.length > 0;
  const sidechatPromotion = useSidechatPromotion({
    threadId: input.thread.activeId,
    enabled: input.thread.isTemporarySidechat,
    blocked: sidechatBlocked,
    onPromoted,
  });

  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntries(
        optimisticTranscript.timelineMessages,
        input.thread.active?.proposedPlans ?? [],
        activity.agentActivityTimelineState.timelineWorkEntries,
      ),
    [
      activity.agentActivityTimelineState.timelineWorkEntries,
      input.thread.active?.proposedPlans,
      optimisticTranscript.timelineMessages,
    ],
  );
  const isComposerApprovalState = activeApproval !== null;

  return {
    session: {
      phase,
      isConnecting,
      hasLiveTurn,
      steerGate,
    },
    activity,
    pending: {
      ...pendingInteraction,
      activeApproval,
      isComposerApprovalState,
    },
    plan: {
      ...planSidebar,
      showFollowUpPrompt,
    },
    dispatch: localDispatch,
    automation: automationConversation,
    transcript: {
      ...optimisticTranscript,
      timelineEntries,
    },
    promptHistory,
    checkpoint,
    sidechat: {
      ...sidechatPromotion,
      blocked: sidechatBlocked,
    },
    presentation: {
      ...activeTurn,
      hasLiveTranscriptOutput,
      isWorking,
      hasStreamingAssistantText,
      isComposerEditorDisabled: isConnecting || isComposerApprovalState,
      canCollapsePastedTextToDraft: shouldEnableComposerPastedTextCollapse({
        isComposerApprovalState,
        hasPendingUserInput: pendingInteraction.pendingUserInputs.length > 0,
        showPlanFollowUpPrompt: showFollowUpPrompt,
      }),
      composerFooterHasWideActions:
        showFollowUpPrompt || pendingInteraction.activePendingProgress !== null,
      composerStackedChromeHeight: stackedChrome.height,
      measureComposerStackedChrome: stackedChrome.measure,
    },
  };
}
