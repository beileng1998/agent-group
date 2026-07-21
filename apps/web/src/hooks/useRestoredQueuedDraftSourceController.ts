// FILE: useRestoredQueuedDraftSourceController.ts
// Purpose: Own the source-plan marker attached to a restored queued draft.
// Layer: Web composer controller

import { type ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useRef } from "react";

import type { RestoredComposerSourceProposedPlan } from "../composerDraftStore";
import { composerPromptStillMatchesRestoredQueuedDraft } from "../components/chat/chatViewDraftPersistence";

export function useRestoredQueuedDraftSourceController(input: {
  threadId: ThreadId;
  source: RestoredComposerSourceProposedPlan | null | undefined;
  persist: (threadId: ThreadId, source: RestoredComposerSourceProposedPlan | null) => void;
}) {
  const sourceRef = useRef<RestoredComposerSourceProposedPlan | null>(input.source ?? null);

  useEffect(() => {
    sourceRef.current = input.source ?? null;
  }, [input.source]);

  const setSource = useCallback(
    (threadId: ThreadId, source: RestoredComposerSourceProposedPlan | null) => {
      sourceRef.current = source;
      input.persist(threadId, source);
    },
    [input.persist],
  );

  const resolveForPrompt = useCallback((threadId: ThreadId, prompt: string) => {
    const source = sourceRef.current;
    return source?.threadId === threadId &&
      composerPromptStillMatchesRestoredQueuedDraft(source.restoredPrompt, prompt)
      ? source
      : null;
  }, []);

  const clearIfPromptChanged = useCallback(
    (nextPrompt: string) => {
      const source = sourceRef.current;
      if (
        source?.threadId === input.threadId &&
        !composerPromptStillMatchesRestoredQueuedDraft(source.restoredPrompt, nextPrompt)
      ) {
        setSource(input.threadId, null);
      }
    },
    [input.threadId, setSource],
  );

  return { clearIfPromptChanged, resolveForPrompt, setSource };
}
