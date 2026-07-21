// FILE: usePendingInteractionController.ts
// Purpose: Own approval responses and provider user-input draft interaction state.
// Layer: Web pending interaction controller

import {
  type ApprovalRequestId,
  type OrchestrationThreadActivity,
  type ProviderApprovalDecision,
  type ProviderUserInputAnswers,
  type RuntimeMode,
  type ThreadId,
} from "@agent-group/contracts";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  type ComposerTrigger,
} from "../composer-logic";
import { resolveRuntimeModeAfterApprovalDecision } from "../components/ChatView.environmentModel";
import { EMPTY_PENDING_USER_INPUT_ANSWERS } from "../components/chat/chatViewComposerValues";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  hasCompletePendingUserInputAnswers,
  omitNullPendingUserInputAnswers,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../pendingUserInput";
import { derivePendingApprovals, derivePendingUserInputs } from "../session-logic";

interface UsePendingInteractionControllerOptions {
  activeThreadId: ThreadId | null;
  activities: readonly OrchestrationThreadActivity[];
  promptRef: MutableRefObject<string>;
  runtimeMode: RuntimeMode;
  setComposerCursor: (cursor: number) => void;
  setComposerHighlightedItemId: (itemId: string | null) => void;
  setComposerTrigger: (trigger: ComposerTrigger | null) => void;
  setPrompt: (prompt: string) => void;
  setRuntimeMode: (threadId: ThreadId, runtimeMode: RuntimeMode) => void;
  setThreadError: (threadId: ThreadId, message: string | null) => void;
}

export function usePendingInteractionController(options: UsePendingInteractionControllerOptions) {
  const {
    activeThreadId,
    activities,
    promptRef,
    runtimeMode,
    setComposerCursor,
    setComposerHighlightedItemId,
    setComposerTrigger,
    setPrompt,
    setRuntimeMode,
    setThreadError,
  } = options;
  const [respondingApprovalRequestIds, setRespondingApprovalRequestIds] = useState<
    ApprovalRequestId[]
  >([]);
  const [respondingUserInputRequestIds, setRespondingUserInputRequestIds] = useState<
    ApprovalRequestId[]
  >([]);
  const [answersByRequestId, setAnswersByRequestId] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const answersByRequestIdRef = useRef(answersByRequestId);
  const [questionIndexByRequestId, setQuestionIndexByRequestId] = useState<Record<string, number>>(
    {},
  );
  const lastSyncedCustomAnswerRef = useRef<{
    requestId: string | null;
    questionId: string | null;
  } | null>(null);

  const pendingApprovals = useMemo(() => derivePendingApprovals(activities), [activities]);
  const pendingUserInputs = useMemo(() => derivePendingUserInputs(activities), [activities]);
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const activePendingDraftAnswers = useMemo(
    () =>
      activePendingUserInput
        ? (answersByRequestId[activePendingUserInput.requestId] ?? EMPTY_PENDING_USER_INPUT_ANSWERS)
        : EMPTY_PENDING_USER_INPUT_ANSWERS,
    [activePendingUserInput, answersByRequestId],
  );
  const activeQuestionIndex = activePendingUserInput
    ? (questionIndexByRequestId[activePendingUserInput.requestId] ?? 0)
    : 0;
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activeQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingUserInput, activeQuestionIndex],
  );
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );
  const activePendingIsResponding = activePendingUserInput
    ? respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
    : false;

  const mergePendingDraftAnswers = useCallback(
    (requestId: string, answers: Record<string, PendingUserInputDraftAnswer>) => {
      const nextRequestAnswers = {
        ...answersByRequestIdRef.current[requestId],
        ...answers,
      };
      answersByRequestIdRef.current = {
        ...answersByRequestIdRef.current,
        [requestId]: nextRequestAnswers,
      };
      setAnswersByRequestId((existing) => ({
        ...existing,
        [requestId]: nextRequestAnswers,
      }));
      return nextRequestAnswers;
    },
    [],
  );

  useEffect(() => {
    const nextCustomAnswer = activePendingProgress?.customAnswer;
    if (typeof nextCustomAnswer !== "string") {
      lastSyncedCustomAnswerRef.current = null;
      return;
    }
    const nextRequestId = activePendingUserInput?.requestId ?? null;
    const nextQuestionId = activePendingProgress?.activeQuestion?.id ?? null;
    const questionChanged =
      lastSyncedCustomAnswerRef.current?.requestId !== nextRequestId ||
      lastSyncedCustomAnswerRef.current?.questionId !== nextQuestionId;
    const textChangedExternally = promptRef.current !== nextCustomAnswer;
    lastSyncedCustomAnswerRef.current = {
      requestId: nextRequestId,
      questionId: nextQuestionId,
    };
    if (!questionChanged && !textChangedExternally) return;

    promptRef.current = nextCustomAnswer;
    const nextCursor = collapseExpandedComposerCursor(nextCustomAnswer, nextCustomAnswer.length);
    setComposerCursor(nextCursor);
    setComposerTrigger(
      detectComposerTrigger(
        nextCustomAnswer,
        expandCollapsedComposerCursor(nextCustomAnswer, nextCursor),
      ),
    );
    setComposerHighlightedItemId(null);
  }, [
    activePendingProgress?.activeQuestion?.id,
    activePendingProgress?.customAnswer,
    activePendingUserInput?.requestId,
    promptRef,
    setComposerCursor,
    setComposerHighlightedItemId,
    setComposerTrigger,
  ]);

  const respondToApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      const api = readNativeApi();
      if (!api || !activeThreadId) return;
      setRespondingApprovalRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      const durableRuntimeMode = resolveRuntimeModeAfterApprovalDecision(runtimeMode, decision);
      if (durableRuntimeMode) setRuntimeMode(activeThreadId, durableRuntimeMode);
      await api.orchestration
        .dispatchCommand({
          type: "thread.approval.respond",
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          decision,
          createdAt: new Date().toISOString(),
        })
        .catch((error: unknown) => {
          setThreadError(
            activeThreadId,
            error instanceof Error ? error.message : "Failed to submit approval decision.",
          );
        });
      setRespondingApprovalRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeThreadId, runtimeMode, setRuntimeMode, setThreadError],
  );

  const respondToUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: ProviderUserInputAnswers) => {
      const api = readNativeApi();
      if (!api || !activeThreadId) return;
      const dispatchAnswers = hasCompletePendingUserInputAnswers(answers)
        ? answers
        : omitNullPendingUserInputAnswers(answers);
      setRespondingUserInputRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "thread.user-input.respond",
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          answers: dispatchAnswers,
          createdAt: new Date().toISOString(),
        })
        .catch((error: unknown) => {
          setThreadError(
            activeThreadId,
            error instanceof Error ? error.message : "Failed to submit user input.",
          );
        });
      setRespondingUserInputRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeThreadId, setThreadError],
  );

  const cancelActivePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || activePendingIsResponding) return;
    promptRef.current = "";
    setPrompt("");
    setComposerCursor(0);
    setComposerTrigger(null);
    void respondToUserInput(activePendingUserInput.requestId, {});
  }, [
    activePendingIsResponding,
    activePendingUserInput,
    promptRef,
    respondToUserInput,
    setComposerCursor,
    setComposerTrigger,
    setPrompt,
  ]);

  const setActiveQuestionIndex = useCallback(
    (nextQuestionIndex: number) => {
      if (!activePendingUserInput) return;
      setQuestionIndexByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: nextQuestionIndex,
      }));
    },
    [activePendingUserInput],
  );

  const toggleActivePendingOption = useCallback(
    (questionId: string, optionLabel: string) => {
      if (!activePendingUserInput) return null;
      const question = activePendingUserInput.questions.find((entry) => entry.id === questionId);
      if (!question) return null;
      const nextDraftAnswer = togglePendingUserInputOptionSelection(
        question,
        answersByRequestIdRef.current[activePendingUserInput.requestId]?.[questionId],
        optionLabel,
      );
      mergePendingDraftAnswers(activePendingUserInput.requestId, {
        [questionId]: nextDraftAnswer,
      });
      promptRef.current = "";
      setComposerCursor(0);
      setComposerTrigger(null);
      return nextDraftAnswer;
    },
    [
      activePendingUserInput,
      mergePendingDraftAnswers,
      promptRef,
      setComposerCursor,
      setComposerTrigger,
    ],
  );

  const changeActivePendingCustomAnswer = useCallback(
    (
      questionId: string,
      value: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
    ) => {
      if (!activePendingUserInput) return;
      promptRef.current = value;
      const nextDraftAnswer = setPendingUserInputCustomAnswer(
        answersByRequestIdRef.current[activePendingUserInput.requestId]?.[questionId],
        value,
      );
      mergePendingDraftAnswers(activePendingUserInput.requestId, {
        [questionId]: nextDraftAnswer,
      });
      setComposerCursor(nextCursor);
      setComposerTrigger(
        cursorAdjacentToMention ? null : detectComposerTrigger(value, expandedCursor),
      );
    },
    [
      activePendingUserInput,
      mergePendingDraftAnswers,
      promptRef,
      setComposerCursor,
      setComposerTrigger,
    ],
  );

  const advanceActivePendingUserInput = useCallback(
    (answerOverrides?: Record<string, PendingUserInputDraftAnswer>): boolean => {
      if (!activePendingUserInput || !activePendingProgress) return false;
      const hasOverrides = answerOverrides && Object.keys(answerOverrides).length > 0;
      const pendingDraftAnswers = hasOverrides
        ? mergePendingDraftAnswers(activePendingUserInput.requestId, answerOverrides)
        : (answersByRequestIdRef.current[activePendingUserInput.requestId] ??
          activePendingDraftAnswers);
      const resolvedAnswers = buildPendingUserInputAnswers(
        activePendingUserInput.questions,
        pendingDraftAnswers,
      );
      if (activePendingProgress.isLastQuestion) {
        if (!resolvedAnswers) return false;
        void respondToUserInput(activePendingUserInput.requestId, resolvedAnswers);
        return true;
      }
      const activeQuestionId = activePendingProgress.activeQuestion?.id ?? null;
      const hasActiveOverride = activeQuestionId
        ? answerOverrides?.[activeQuestionId] !== undefined
        : false;
      if (!activePendingProgress.canAdvance && !hasActiveOverride) return false;
      setActiveQuestionIndex(activePendingProgress.questionIndex + 1);
      return true;
    },
    [
      activePendingDraftAnswers,
      activePendingProgress,
      activePendingUserInput,
      mergePendingDraftAnswers,
      respondToUserInput,
      setActiveQuestionIndex,
    ],
  );

  const submitActivePendingUserInputFromComposer = useCallback(
    (text: string): boolean => {
      if (!activePendingProgress) return false;
      const activeQuestion = activePendingProgress.activeQuestion;
      const currentDraftAnswer =
        activePendingUserInput && activeQuestion
          ? answersByRequestIdRef.current[activePendingUserInput.requestId]?.[activeQuestion.id]
          : undefined;
      const answerOverrides =
        activeQuestion && text.trim().length > 0
          ? {
              [activeQuestion.id]: setPendingUserInputCustomAnswer(currentDraftAnswer, text),
            }
          : undefined;
      if (activePendingUserInput && answerOverrides) {
        mergePendingDraftAnswers(activePendingUserInput.requestId, answerOverrides);
      }
      return advanceActivePendingUserInput(answerOverrides);
    },
    [
      activePendingProgress,
      activePendingUserInput,
      advanceActivePendingUserInput,
      mergePendingDraftAnswers,
    ],
  );

  const previousActivePendingQuestion = useCallback(() => {
    if (!activePendingProgress) return;
    setActiveQuestionIndex(Math.max(activePendingProgress.questionIndex - 1, 0));
  }, [activePendingProgress, setActiveQuestionIndex]);

  return {
    activePendingDraftAnswers,
    activePendingIsResponding,
    activePendingProgress,
    activePendingQuestionIndex: activeQuestionIndex,
    activePendingResolvedAnswers,
    activePendingUserInput,
    answersByRequestIdRef,
    cancelActivePendingUserInput,
    changeActivePendingCustomAnswer,
    mergePendingDraftAnswers,
    pendingApprovals,
    pendingUserInputs,
    previousActivePendingQuestion,
    respondToApproval,
    respondingApprovalRequestIds,
    respondingUserInputRequestIds,
    submitActivePendingUserInputFromComposer,
    advanceActivePendingUserInput,
    toggleActivePendingOption,
  };
}
