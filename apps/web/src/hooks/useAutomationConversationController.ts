// FILE: useAutomationConversationController.ts
// Purpose: Own the ephemeral multi-turn automation setup conversation.
// Layer: Web automation controller

import { type MessageId, type ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import type { ChatMessage } from "../types";

export interface PendingAutomationConversation {
  readonly threadId: ThreadId;
  readonly accumulatedMessage: string;
  readonly bubbles: readonly ChatMessage[];
}

export function useAutomationConversationController(input: {
  threadId: ThreadId;
  hasLiveTurn: boolean;
  promptRef: MutableRefObject<string>;
  setComposerDraftPrompt: (threadId: ThreadId, prompt: string) => void;
}) {
  const [conversation, setConversationState] = useState<PendingAutomationConversation | null>(null);
  const conversationRef = useRef<PendingAutomationConversation | null>(conversation);
  conversationRef.current = conversation;
  const activeThreadIdRef = useRef(input.threadId);
  activeThreadIdRef.current = input.threadId;
  const hasLiveTurnRef = useRef(input.hasLiveTurn);
  hasLiveTurnRef.current = input.hasLiveTurn;

  const setConversation = useCallback((next: PendingAutomationConversation) => {
    conversationRef.current = next;
    setConversationState(next);
  }, []);

  const clear = useCallback(() => {
    conversationRef.current = null;
    setConversationState(null);
  }, []);

  const restoreDraft = useCallback(
    (pending: PendingAutomationConversation) => {
      const draft = input.promptRef.current.trim();
      const restored = draft
        ? `${pending.accumulatedMessage}\n${draft}`
        : pending.accumulatedMessage;
      input.setComposerDraftPrompt(pending.threadId, restored);
    },
    [input.promptRef, input.setComposerDraftPrompt],
  );

  useEffect(() => {
    const pending = conversationRef.current;
    if (pending && pending.threadId !== input.threadId) {
      restoreDraft(pending);
      conversationRef.current = null;
    }
    if (conversationRef.current === null) {
      setConversationState(null);
    }
    return () => {
      const pendingOnCleanup = conversationRef.current;
      if (!pendingOnCleanup) {
        return;
      }
      restoreDraft(pendingOnCleanup);
      conversationRef.current = null;
    };
  }, [input.threadId, restoreDraft]);

  const cancel = useCallback(() => {
    const pending = conversationRef.current;
    if (pending) {
      const draft = input.promptRef.current.trim();
      const restored = draft
        ? `${pending.accumulatedMessage}\n${draft}`
        : pending.accumulatedMessage;
      if (pending.threadId === input.threadId) {
        input.promptRef.current = restored;
      }
      input.setComposerDraftPrompt(pending.threadId, restored);
    }
    clear();
  }, [clear, input.promptRef, input.setComposerDraftPrompt, input.threadId]);

  const isPendingSetupBubbleId = useCallback(
    (messageId: MessageId): boolean =>
      conversationRef.current?.bubbles.some((bubble) => bubble.id === messageId) ?? false,
    [],
  );

  const isResolveCurrent = useCallback(
    (request: {
      threadId: ThreadId;
      conversation: PendingAutomationConversation | null;
      startedWithLiveTurn: boolean;
    }): boolean =>
      activeThreadIdRef.current === request.threadId &&
      conversationRef.current === request.conversation &&
      (request.startedWithLiveTurn || !hasLiveTurnRef.current),
    [],
  );

  return {
    cancel,
    clear,
    conversation,
    isPendingSetupBubbleId,
    isResolveCurrent,
    setConversation,
  };
}
