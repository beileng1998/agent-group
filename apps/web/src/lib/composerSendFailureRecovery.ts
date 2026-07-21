// FILE: composerSendFailureRecovery.ts
// Purpose: Restore an untouched composer after a chat turn fails before starting.
// Layer: Web send recovery

import {
  type MessageId,
  type MessageMentionReference,
  type OrchestrationLatestTurn,
  type ProviderSkillReference,
  type ThreadId,
} from "@agent-group/contracts";
import type { MutableRefObject } from "react";

import {
  type ComposerAssistantSelectionAttachment,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  useComposerDraftStore,
} from "../composerDraftStore";
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  type ComposerTrigger,
} from "../composer-logic";
import type { FileCommentDraft } from "./fileComments";
import type { PastedTextDraft } from "./composerPastedText";
import type { TerminalContextDraft } from "./terminalContext";
import { cloneComposerImageAttachment } from "./composerSend";

interface ComposerContentRefs {
  readonly prompt: MutableRefObject<string>;
  readonly images: MutableRefObject<readonly ComposerImageAttachment[]>;
  readonly files: MutableRefObject<readonly ComposerFileAttachment[]>;
  readonly assistantSelections: MutableRefObject<readonly ComposerAssistantSelectionAttachment[]>;
  readonly fileComments: MutableRefObject<readonly FileCommentDraft[]>;
  readonly terminalContexts: MutableRefObject<readonly TerminalContextDraft[]>;
  readonly pastedTexts: MutableRefObject<readonly PastedTextDraft[]>;
}

interface ComposerSendRestoreSnapshot {
  readonly prompt: string;
  readonly images: readonly ComposerImageAttachment[];
  readonly files: readonly ComposerFileAttachment[];
  readonly assistantSelections: readonly ComposerAssistantSelectionAttachment[];
  readonly fileComments: readonly FileCommentDraft[];
  readonly terminalContexts: readonly TerminalContextDraft[];
  readonly pastedTexts: readonly PastedTextDraft[];
  readonly skills: readonly ProviderSkillReference[];
  readonly mentions: readonly MessageMentionReference[];
}

export function restoreFailedComposerSend(input: {
  threadId: ThreadId;
  messageId: MessageId;
  sourceProposedPlan: NonNullable<OrchestrationLatestTurn["sourceProposedPlan"]> | undefined;
  current: ComposerContentRefs;
  snapshot: ComposerSendRestoreSnapshot;
  removeOptimisticUserMessage: (messageId: MessageId) => void;
  setPrompt: (prompt: string) => void;
  setRestoredSourceProposedPlan: (
    threadId: ThreadId,
    source: {
      threadId: ThreadId;
      restoredPrompt: string;
      sourceProposedPlan: NonNullable<OrchestrationLatestTurn["sourceProposedPlan"]>;
    },
  ) => void;
  setComposerCursor: (cursor: number) => void;
  setComposerTrigger: (trigger: ComposerTrigger | null) => void;
}): boolean {
  if (
    input.current.prompt.current.length > 0 ||
    input.current.images.current.length > 0 ||
    input.current.files.current.length > 0 ||
    input.current.assistantSelections.current.length > 0 ||
    input.current.fileComments.current.length > 0 ||
    input.current.terminalContexts.current.length > 0 ||
    input.current.pastedTexts.current.length > 0
  ) {
    return false;
  }

  input.removeOptimisticUserMessage(input.messageId);

  input.current.prompt.current = input.snapshot.prompt;
  input.setPrompt(input.snapshot.prompt);
  if (input.sourceProposedPlan) {
    input.setRestoredSourceProposedPlan(input.threadId, {
      threadId: input.threadId,
      restoredPrompt: input.snapshot.prompt,
      sourceProposedPlan: input.sourceProposedPlan,
    });
  }
  input.setComposerCursor(
    collapseExpandedComposerCursor(input.snapshot.prompt, input.snapshot.prompt.length),
  );

  const draftStore = useComposerDraftStore.getState();
  draftStore.addImages(input.threadId, input.snapshot.images.map(cloneComposerImageAttachment));
  draftStore.addFiles(input.threadId, [...input.snapshot.files]);
  for (const selection of input.snapshot.assistantSelections) {
    draftStore.addAssistantSelection(input.threadId, selection);
  }
  for (const comment of input.snapshot.fileComments) {
    draftStore.addFileComment(input.threadId, comment);
  }
  draftStore.addTerminalContexts(input.threadId, [...input.snapshot.terminalContexts]);
  draftStore.addPastedTexts(input.threadId, [...input.snapshot.pastedTexts]);
  draftStore.setSkills(input.threadId, [...input.snapshot.skills]);
  draftStore.setMentions(input.threadId, [...input.snapshot.mentions]);
  input.setComposerTrigger(
    detectComposerTrigger(input.snapshot.prompt, input.snapshot.prompt.length),
  );
  return true;
}
