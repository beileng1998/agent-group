// FILE: useComposerPromptHistoryController.ts
// Purpose: Own composer prompt-history browsing, restoration, and interruption semantics.
// Layer: Web composer controller

import { type ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

import {
  captureComposerPromptHistorySavedDraft,
  type ComposerPromptHistorySavedDraft,
  type ComposerThreadDraftState,
} from "../composerDraftStore";
import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  type ComposerTrigger,
} from "../composer-logic";
import {
  promptStillMatchesActiveHistoryBrowse,
  resolvePromptHistoryNavigation,
  shouldHandlePromptHistoryNavigationKey,
  type PromptHistoryNavigationState,
} from "../components/ChatView.composerHistory";

export function useComposerPromptHistoryController(input: {
  threadId: ThreadId;
  prompt: string;
  history: readonly string[];
  composerDraft: ComposerThreadDraftState;
  savedDraft: ComposerPromptHistorySavedDraft | null;
  promptRef: MutableRefObject<string>;
  setPrompt: (prompt: string) => void;
  setComposerCursor: (value: number | ((current: number) => number)) => void;
  setComposerTrigger: (trigger: ComposerTrigger | null) => void;
  setSavedDraft: (threadId: ThreadId, saved: ComposerPromptHistorySavedDraft | null) => void;
  restoreSavedDraft: (threadId: ThreadId) => void;
}) {
  const navigationRef = useRef<PromptHistoryNavigationState | null>(null);
  const applyingNavigationRef = useRef(false);
  const expectedPromptRef = useRef<string | null>(null);
  const appliedPromptRef = useRef<string | null>(null);

  const resetRefs = useCallback(() => {
    navigationRef.current = null;
    applyingNavigationRef.current = false;
    expectedPromptRef.current = null;
    appliedPromptRef.current = null;
  }, []);

  useEffect(() => resetRefs(), [input.threadId, resetRefs]);

  useEffect(() => {
    if (navigationRef.current !== null || input.savedDraft === null) {
      return;
    }
    input.restoreSavedDraft(input.threadId);
    input.setComposerCursor(
      collapseExpandedComposerCursor(input.savedDraft.prompt, input.savedDraft.prompt.length),
    );
  }, [input.restoreSavedDraft, input.savedDraft, input.setComposerCursor, input.threadId]);

  useEffect(() => {
    input.promptRef.current = input.prompt;
    if (navigationRef.current !== null && input.prompt !== appliedPromptRef.current) {
      navigationRef.current = null;
      expectedPromptRef.current = null;
      input.setSavedDraft(input.threadId, null);
    }
    input.setComposerCursor((current) => clampCollapsedComposerCursor(input.prompt, current));
  }, [input.prompt, input.promptRef, input.setComposerCursor, input.setSavedDraft, input.threadId]);

  const discardForMutation = useCallback(() => {
    if (navigationRef.current === null) return;
    resetRefs();
    input.setSavedDraft(input.threadId, null);
  }, [input.setSavedDraft, input.threadId, resetRefs]);

  const clearForComposerReset = useCallback(() => {
    resetRefs();
  }, [resetRefs]);

  const interruptForPendingInput = useCallback((): boolean => {
    const interrupted = navigationRef.current;
    if (interrupted === null) {
      expectedPromptRef.current = null;
      return false;
    }
    navigationRef.current = null;
    input.restoreSavedDraft(input.threadId);
    input.promptRef.current = interrupted.draft;
    input.setPrompt(interrupted.draft);
    expectedPromptRef.current = null;
    return true;
  }, [input.promptRef, input.restoreSavedDraft, input.setPrompt, input.threadId]);

  const handleEditorChange = useCallback(
    (nextPrompt: string) => {
      const expectedPrompt = expectedPromptRef.current;
      if (expectedPrompt !== null) {
        if (nextPrompt === expectedPrompt) {
          expectedPromptRef.current = null;
        } else {
          navigationRef.current = null;
          expectedPromptRef.current = null;
          input.setSavedDraft(input.threadId, null);
        }
        return;
      }
      if (applyingNavigationRef.current) return;
      const navigation = navigationRef.current;
      if (
        navigation !== null &&
        !promptStillMatchesActiveHistoryBrowse({
          state: navigation,
          history: input.history,
          nextPrompt,
          appliedPrompt: appliedPromptRef.current,
        })
      ) {
        navigationRef.current = null;
        input.setSavedDraft(input.threadId, null);
      }
    },
    [input.history, input.setSavedDraft, input.threadId],
  );

  const handleNavigationKey = useCallback(
    (request: {
      key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Slash";
      metaKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
      menuIsActive: boolean;
      hasActivePendingProgress: boolean;
      isComposerApprovalState: boolean;
      pendingUserInputCount: number;
      currentPrompt: string;
      currentExpandedCursor: number;
      selectionCollapsed: boolean;
    }): boolean => {
      if (!shouldHandlePromptHistoryNavigationKey(request)) {
        return false;
      }
      const previousState = navigationRef.current;
      const result = resolvePromptHistoryNavigation({
        direction: request.key === "ArrowUp" ? "older" : "newer",
        history: input.history,
        currentPrompt: request.currentPrompt,
        currentExpandedCursor: request.currentExpandedCursor,
        selectionCollapsed: request.selectionCollapsed,
        state: previousState,
      });
      if (!result.handled) return false;

      navigationRef.current = result.state;
      if (result.state === null) {
        input.restoreSavedDraft(input.threadId);
      } else if (previousState === null) {
        input.setSavedDraft(
          input.threadId,
          captureComposerPromptHistorySavedDraft({
            threadId: input.threadId,
            draft: input.composerDraft,
            prompt: result.state.draft,
          }),
        );
      }
      applyingNavigationRef.current = true;
      expectedPromptRef.current = result.prompt;
      appliedPromptRef.current = result.prompt;
      input.promptRef.current = result.prompt;
      input.setPrompt(result.prompt);
      input.setComposerCursor(collapseExpandedComposerCursor(result.prompt, result.expandedCursor));
      input.setComposerTrigger(null);
      window.requestAnimationFrame(() => {
        applyingNavigationRef.current = false;
      });
      return true;
    },
    [
      input.composerDraft,
      input.history,
      input.promptRef,
      input.restoreSavedDraft,
      input.setComposerCursor,
      input.setComposerTrigger,
      input.setPrompt,
      input.setSavedDraft,
      input.threadId,
    ],
  );

  const commitRecalledPrompt = useCallback(() => {
    if (navigationRef.current !== null) {
      navigationRef.current = null;
      input.setSavedDraft(input.threadId, null);
    }
    expectedPromptRef.current = null;
  }, [input.setSavedDraft, input.threadId]);

  return {
    clearForComposerReset,
    commitRecalledPrompt,
    discardForMutation,
    handleEditorChange,
    handleNavigationKey,
    interruptForPendingInput,
  };
}
