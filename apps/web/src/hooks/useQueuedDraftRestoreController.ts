// FILE: useQueuedDraftRestoreController.ts
// Purpose: Restore a queued turn into the composer in one ordered operation.
// Layer: Web composer controller

import {
  type MessageMentionReference,
  type ProviderSkillReference,
  type ThreadId,
} from "@agent-group/contracts";
import { useCallback, type MutableRefObject } from "react";

import {
  type ComposerAssistantSelectionAttachment,
  type ComposerDraftStoreState,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type QueuedComposerTurn,
  type RestoredComposerSourceProposedPlan,
} from "../composerDraftStore";
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  type ComposerTrigger,
} from "../composer-logic";
import type { FileCommentDraft } from "../lib/fileComments";
import type { PastedTextDraft } from "../lib/composerPastedText";
import { cloneComposerImageAttachment } from "../lib/composerSend";
import type { TerminalContextDraft } from "../lib/terminalContext";

interface QueuedDraftReferenceActions {
  addImages: (images: ComposerImageAttachment[]) => void;
  addFiles: (files: ComposerFileAttachment[]) => void;
  addAssistantSelection: (selection: ComposerAssistantSelectionAttachment) => unknown;
  addFileComment: (comment: FileCommentDraft) => unknown;
  addTerminalContexts: (contexts: TerminalContextDraft[]) => void;
  addPastedTexts: (texts: PastedTextDraft[]) => void;
  setSkills: (skills: ProviderSkillReference[]) => void;
  setMentions: (mentions: MessageMentionReference[]) => void;
}

type QueuedDraftStoreActions = Pick<
  ComposerDraftStoreState,
  | "clearComposerContent"
  | "setDraftThreadContext"
  | "setInteractionMode"
  | "setModelSelection"
  | "setPrompt"
  | "setRuntimeMode"
>;

export function useQueuedDraftRestoreController(input: {
  activeThreadId: ThreadId | null;
  promptRef: MutableRefObject<string>;
  store: QueuedDraftStoreActions;
  references: QueuedDraftReferenceActions;
  setRestoredSource: (
    threadId: ThreadId,
    source: RestoredComposerSourceProposedPlan | null,
  ) => void;
  setCursor: (cursor: number) => void;
  setTrigger: (trigger: ComposerTrigger | null) => void;
  focus: () => void;
}) {
  const { activeThreadId, focus, promptRef, setCursor, setRestoredSource, setTrigger } = input;
  const {
    addAssistantSelection,
    addFileComment,
    addFiles,
    addImages,
    addPastedTexts,
    addTerminalContexts,
    setMentions,
    setSkills,
  } = input.references;
  const {
    clearComposerContent,
    setDraftThreadContext,
    setInteractionMode,
    setModelSelection,
    setPrompt,
    setRuntimeMode,
  } = input.store;

  return useCallback(
    (queuedTurn: QueuedComposerTurn) => {
      if (!activeThreadId) return;

      const nextPrompt = queuedTurn.kind === "chat" ? queuedTurn.prompt : queuedTurn.text;
      const restoredImages =
        queuedTurn.kind === "chat" ? queuedTurn.images.map(cloneComposerImageAttachment) : [];

      promptRef.current = nextPrompt;
      clearComposerContent(activeThreadId);
      setPrompt(activeThreadId, nextPrompt);
      setDraftThreadContext(activeThreadId, {
        runtimeMode: queuedTurn.runtimeMode,
        interactionMode: queuedTurn.interactionMode,
        ...(queuedTurn.kind === "chat" ? { envMode: queuedTurn.envMode } : {}),
      });

      if (queuedTurn.kind === "chat") {
        if (restoredImages.length > 0) addImages(restoredImages);
        if (queuedTurn.files.length > 0) addFiles(queuedTurn.files);
        for (const selection of queuedTurn.assistantSelections) {
          addAssistantSelection(selection);
        }
        for (const comment of queuedTurn.fileComments) addFileComment(comment);
        if (queuedTurn.terminalContexts.length > 0) {
          addTerminalContexts(queuedTurn.terminalContexts);
        }
        if (queuedTurn.pastedTexts.length > 0) {
          addPastedTexts(queuedTurn.pastedTexts);
        }
        setSkills(queuedTurn.skills);
        setMentions(queuedTurn.mentions);
      } else {
        setSkills([]);
        setMentions([]);
      }

      setRestoredSource(
        activeThreadId,
        queuedTurn.kind === "chat" && queuedTurn.sourceProposedPlan
          ? {
              threadId: activeThreadId,
              restoredPrompt: nextPrompt,
              sourceProposedPlan: queuedTurn.sourceProposedPlan,
            }
          : null,
      );
      setModelSelection(activeThreadId, queuedTurn.modelSelection);
      setRuntimeMode(activeThreadId, queuedTurn.runtimeMode);
      setInteractionMode(activeThreadId, queuedTurn.interactionMode);
      setCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
      setTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
      focus();
    },
    [
      activeThreadId,
      addAssistantSelection,
      addFileComment,
      addFiles,
      addImages,
      addPastedTexts,
      addTerminalContexts,
      clearComposerContent,
      focus,
      promptRef,
      setCursor,
      setDraftThreadContext,
      setInteractionMode,
      setMentions,
      setModelSelection,
      setPrompt,
      setRestoredSource,
      setRuntimeMode,
      setSkills,
      setTrigger,
    ],
  );
}
