// FILE: useChatComposerDraftController.ts
// Purpose: Bind one chat composer to its durable draft content and mutation API.
// Layer: Web chat controller

import type { ThreadId } from "@agent-group/contracts";
import { useMemo } from "react";

import { deriveComposerSendState } from "../components/ChatView.composerHistory";
import { useComposerDraftStore, useComposerThreadDraft } from "../composerDraftStore";

export function useChatComposerDraftController(threadId: ThreadId) {
  const draft = useComposerThreadDraft(threadId);
  const sendState = useMemo(
    () =>
      deriveComposerSendState({
        prompt: draft.prompt,
        imageCount: draft.images.length,
        fileCount: draft.files.length,
        assistantSelectionCount: draft.assistantSelections.length,
        fileCommentCount: draft.fileComments.length,
        terminalContexts: draft.terminalContexts,
        pastedTexts: draft.pastedTexts,
      }),
    [
      draft.assistantSelections.length,
      draft.fileComments.length,
      draft.files.length,
      draft.images.length,
      draft.pastedTexts,
      draft.prompt,
      draft.terminalContexts,
    ],
  );
  const setModelSelectionAndSticky = useComposerDraftStore(
    (store) => store.setModelSelectionAndSticky,
  );
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const setPromptHistorySavedDraft = useComposerDraftStore(
    (store) => store.setPromptHistorySavedDraft,
  );
  const restorePromptHistorySavedDraft = useComposerDraftStore(
    (store) => store.restorePromptHistorySavedDraft,
  );
  const setModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const setRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setInteractionMode = useComposerDraftStore((store) => store.setInteractionMode);
  const enqueueQueuedTurn = useComposerDraftStore((store) => store.enqueueQueuedTurn);
  const insertQueuedTurn = useComposerDraftStore((store) => store.insertQueuedTurn);
  const removeQueuedTurn = useComposerDraftStore((store) => store.removeQueuedTurn);
  const setTerminalContexts = useComposerDraftStore((store) => store.setTerminalContexts);
  const setSkills = useComposerDraftStore((store) => store.setSkills);
  const setMentions = useComposerDraftStore((store) => store.setMentions);
  const setRestoredSourceProposedPlan = useComposerDraftStore(
    (store) => store.setRestoredSourceProposedPlan,
  );
  const clearComposerContent = useComposerDraftStore((store) => store.clearComposerContent);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );

  return {
    draft,
    content: {
      prompt: draft.prompt,
      promptHistorySavedDraft: draft.promptHistorySavedDraft,
      images: draft.images,
      files: draft.files,
      assistantSelections: draft.assistantSelections,
      fileComments: draft.fileComments,
      terminalContexts: draft.terminalContexts,
      pastedTexts: draft.pastedTexts,
      skills: draft.skills,
      mentions: draft.mentions,
      queuedTurns: draft.queuedTurns,
      restoredSourceProposedPlan: draft.restoredSourceProposedPlan,
    },
    attachmentState: {
      nonPersistedImageIds: draft.nonPersistedImageIds,
      persistedAttachments: draft.persistedAttachments,
    },
    sendState,
    actions: {
      setModelSelectionAndSticky,
      setPrompt,
      setPromptHistorySavedDraft,
      restorePromptHistorySavedDraft,
      setModelSelection,
      setProviderModelOptions,
      setRuntimeMode,
      setInteractionMode,
      enqueueQueuedTurn,
      insertQueuedTurn,
      removeQueuedTurn,
      setTerminalContexts,
      setSkills,
      setMentions,
      setRestoredSourceProposedPlan,
      clearComposerContent,
      setDraftThreadContext,
      clearProjectDraftThreadId,
    },
  };
}
