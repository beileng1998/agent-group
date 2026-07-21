// FILE: useComposerPromptMutationController.ts
// Purpose: Own composer prompt mutations from voice, traits, replacements, and editor input.
// Layer: Web composer controller

import { type ThreadId } from "@agent-group/contracts";
import { useCallback, type MutableRefObject } from "react";

import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  type ComposerTrigger,
} from "../composer-logic";
import { appendVoiceTranscriptToPrompt } from "../components/ChatView.voiceAttachments";
import {
  syncTerminalContextsByIds,
  terminalContextIdListsEqual,
} from "../components/chat/chatViewComposerValues";
import type { TerminalContextDraft } from "../lib/terminalContext";
import {
  setPendingUserInputCustomAnswer,
  type PendingUserInputDraftAnswer,
} from "../pendingUserInput";

interface PendingPromptMutationState {
  requestId: string | null;
  questionId: string | null;
  answersByRequestIdRef: MutableRefObject<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >;
  mergeDraftAnswers: (
    requestId: string,
    answers: Record<string, PendingUserInputDraftAnswer>,
  ) => unknown;
  changeCustomAnswer: (
    questionId: string,
    value: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
  ) => void;
  interruptHistory: () => void;
}

export function useComposerPromptMutationController(input: {
  threadId: ThreadId;
  promptRef: MutableRefObject<string>;
  commandPicker: null | "fork-target" | "review-target";
  terminalContexts: TerminalContextDraft[];
  pending: PendingPromptMutationState;
  handleHistoryEditorChange: (prompt: string) => void;
  clearRestoredSourceIfPromptChanged: (prompt: string) => void;
  setPrompt: (prompt: string) => void;
  setCommandPicker: (picker: null | "fork-target" | "review-target") => void;
  persistTerminalContexts: (threadId: ThreadId, contexts: TerminalContextDraft[]) => void;
  setCursor: (cursor: number) => void;
  setTrigger: (trigger: ComposerTrigger | null) => void;
  focus: () => void;
}) {
  const {
    changeCustomAnswer,
    interruptHistory,
    mergeDraftAnswers,
    questionId,
    requestId,
    answersByRequestIdRef,
  } = input.pending;

  const appendVoiceTranscript = useCallback(
    (transcript: string) => {
      const nextPrompt = appendVoiceTranscriptToPrompt(input.promptRef.current, transcript);
      if (!nextPrompt) return;

      input.promptRef.current = nextPrompt;
      input.setPrompt(nextPrompt);
      input.setCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
      input.setTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
      input.focus();
    },
    [input.focus, input.promptRef, input.setCursor, input.setPrompt, input.setTrigger],
  );

  const setFromTraits = useCallback(
    (nextPrompt: string) => {
      if (nextPrompt === input.promptRef.current) {
        input.focus();
        return;
      }
      input.promptRef.current = nextPrompt;
      input.setPrompt(nextPrompt);
      input.setCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
      input.setTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
      input.focus();
    },
    [input.focus, input.promptRef, input.setCursor, input.setPrompt, input.setTrigger],
  );

  const commitReplacementText = useCallback(
    (nextText: string) => {
      if (questionId === null || requestId === null) {
        input.setPrompt(nextText);
        return;
      }
      const nextDraftAnswer = setPendingUserInputCustomAnswer(
        answersByRequestIdRef.current[requestId]?.[questionId],
        nextText,
      );
      mergeDraftAnswers(requestId, { [questionId]: nextDraftAnswer });
    },
    [answersByRequestIdRef, mergeDraftAnswers, questionId, requestId, input.setPrompt],
  );

  const onEditorChange = useCallback(
    (
      nextPrompt: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
      terminalContextIds: string[],
    ) => {
      if (questionId !== null && requestId !== null) {
        interruptHistory();
        changeCustomAnswer(
          questionId,
          nextPrompt,
          nextCursor,
          expandedCursor,
          cursorAdjacentToMention,
        );
        return;
      }

      input.handleHistoryEditorChange(nextPrompt);
      input.clearRestoredSourceIfPromptChanged(nextPrompt);
      input.promptRef.current = nextPrompt;
      input.setPrompt(nextPrompt);
      if (input.commandPicker !== null && nextPrompt.trim().length > 0) {
        input.setCommandPicker(null);
      }
      if (!terminalContextIdListsEqual(input.terminalContexts, terminalContextIds)) {
        input.persistTerminalContexts(
          input.threadId,
          syncTerminalContextsByIds(input.terminalContexts, terminalContextIds),
        );
      }
      input.setCursor(nextCursor);
      input.setTrigger(
        cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
      );
    },
    [
      input.clearRestoredSourceIfPromptChanged,
      input.commandPicker,
      input.handleHistoryEditorChange,
      input.persistTerminalContexts,
      input.promptRef,
      input.setCommandPicker,
      input.setCursor,
      input.setPrompt,
      input.setTrigger,
      input.terminalContexts,
      input.threadId,
      changeCustomAnswer,
      interruptHistory,
      questionId,
      requestId,
    ],
  );

  return { appendVoiceTranscript, commitReplacementText, onEditorChange, setFromTraits };
}
