// FILE: useChatAutomationOwner.ts
// Purpose: Own automation drafts and queued-turn restoration for one chat composer.
// Layer: Web chat controller

import type { ThreadId } from "@agent-group/contracts";
import { useCallback } from "react";

import { useAutomationDraftController } from "./useAutomationDraftController";
import { useQueuedDraftRestoreController } from "./useQueuedDraftRestoreController";

type AutomationDraftInput = Parameters<typeof useAutomationDraftController>[0];
type QueuedDraftRestoreInput = Parameters<typeof useQueuedDraftRestoreController>[0];

interface ChatAutomationComposerInput extends Omit<
  QueuedDraftRestoreInput,
  "activeThreadId" | "references"
> {
  readonly clearPromptHistoryForComposerReset: () => void;
  readonly setComposerHighlightedItemId: (itemId: string | null) => void;
}

export interface ChatAutomationOwnerInput {
  readonly thread: Pick<QueuedDraftRestoreInput, "activeThreadId">;
  readonly composer: ChatAutomationComposerInput;
  readonly references: QueuedDraftRestoreInput["references"];
  readonly automation: Omit<AutomationDraftInput, "clearComposerInput">;
}

export function useChatAutomationOwner(input: ChatAutomationOwnerInput) {
  const {
    clearPromptHistoryForComposerReset,
    focus,
    promptRef,
    setComposerHighlightedItemId,
    setCursor,
    setRestoredSource,
    setTrigger,
    store,
  } = input.composer;
  const { setMentions, setSkills } = input.references;

  const clearComposerInput = useCallback(
    (threadId: ThreadId) => {
      clearPromptHistoryForComposerReset();
      promptRef.current = "";
      setRestoredSource(threadId, null);
      store.clearComposerContent(threadId);
      setSkills([]);
      setMentions([]);
      setComposerHighlightedItemId(null);
      setCursor(0);
      setTrigger(null);
    },
    [
      clearPromptHistoryForComposerReset,
      promptRef,
      setComposerHighlightedItemId,
      setCursor,
      setMentions,
      setRestoredSource,
      setSkills,
      setTrigger,
      store.clearComposerContent,
    ],
  );

  const automation = useAutomationDraftController({
    ...input.automation,
    clearComposerInput,
  });
  const restoreQueuedTurnToComposer = useQueuedDraftRestoreController({
    ...input.thread,
    promptRef,
    store,
    references: input.references,
    setRestoredSource,
    setCursor,
    setTrigger,
    focus,
  });

  return {
    clearComposerInput,
    automation,
    restoreQueuedTurnToComposer,
  };
}
