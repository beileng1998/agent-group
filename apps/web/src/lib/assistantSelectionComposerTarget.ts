// FILE: assistantSelectionComposerTarget.ts
// Purpose: Add an assistant-text reference to another thread's composer.
// Layer: Web composer utility

import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS, type ThreadId } from "@agent-group/contracts";

import { useComposerDraftStore } from "../composerDraftStore";
import { requestComposerFocus } from "../composerFocusRequestStore";
import { createAssistantSelectionAttachment } from "./assistantSelections";

export type AddAssistantSelectionToComposerResult = "inserted" | "existing" | "invalid" | "limit";

export function addAssistantSelectionToComposer(
  threadId: ThreadId,
  selection: { assistantMessageId: string; text: string },
): AddAssistantSelectionToComposerResult {
  const attachment = createAssistantSelectionAttachment(selection);
  if (!attachment) {
    return "invalid";
  }

  const store = useComposerDraftStore.getState();
  const draft = store.draftsByThreadId[threadId];
  const alreadyPresent = draft?.assistantSelections.some(
    (candidate) =>
      candidate.assistantMessageId === attachment.assistantMessageId &&
      candidate.text === attachment.text,
  );
  if (alreadyPresent) {
    requestComposerFocus(threadId);
    return "existing";
  }

  const attachmentCount =
    (draft?.images.length ?? 0) +
    (draft?.files.length ?? 0) +
    (draft?.assistantSelections.length ?? 0);
  if (attachmentCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
    return "limit";
  }

  if (!store.addAssistantSelection(threadId, attachment)) {
    return "invalid";
  }
  requestComposerFocus(threadId);
  return "inserted";
}
