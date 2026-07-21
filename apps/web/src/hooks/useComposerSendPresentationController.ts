// FILE: useComposerSendPresentationController.ts
// Purpose: Present an admitted composer send optimistically and clear only its owned draft.
// Layer: Web composer presentation controller

import { type ProviderInteractionMode, type ThreadId } from "@agent-group/contracts";
import { useCallback, type MutableRefObject } from "react";

import type { ComposerDraftStoreState } from "../composerDraftStore";
import type { ComposerTrigger } from "../composer-logic";
import { resolveEnvironmentPanelPreferenceAfterFirstSend } from "../components/ChatView.environmentModel";
import { buildExpiredTerminalContextToastCopy } from "../components/ChatView.threadPresentation";
import { toastManager } from "../components/ui/toast";
import { prepareOutgoingComposerMessage } from "../lib/composerSendPreparation";
import { newMessageId } from "../lib/utils";
import type { ChatMessage } from "../types";

type OutgoingComposerInput = Parameters<typeof prepareOutgoingComposerMessage>[0];

export function useComposerSendPresentationController(input: {
  threadId: ThreadId;
  isCenteredEmptyLanding: boolean;
  environmentPanelDefaultOpen: boolean;
  environmentPanelPreferenceOpen: boolean | null;
  setEnvironmentPanelPreferenceOpen: (open: boolean | null) => void;
  appendOptimisticUserMessage: (message: ChatMessage) => void;
  armTranscriptAutoFollow: (threadId: ThreadId, force: boolean) => void;
  setThreadError: (threadId: ThreadId, error: string | null) => void;
  clearPromptHistory: () => void;
  promptRef: MutableRefObject<string>;
  clearComposerDraftContent: ComposerDraftStoreState["clearComposerContent"];
  setComposerInteractionMode: (threadId: ThreadId, mode: ProviderInteractionMode) => void;
  setComposerHighlightedItemId: (id: string | null) => void;
  setComposerCursor: (cursor: number) => void;
  setComposerTrigger: (trigger: ComposerTrigger | null) => void;
  focus: () => void;
}) {
  return useCallback(
    (request: {
      outgoing: OutgoingComposerInput;
      dispatchMode: "queue" | "steer";
      expiredTerminalContextCount: number;
      isLiveComposerSend: boolean;
      isLivePlanFollowUpSubmission: boolean;
      interactionMode: ProviderInteractionMode;
    }) => {
      const prepared = prepareOutgoingComposerMessage(request.outgoing);
      const messageId = newMessageId();
      const messageCreatedAt = new Date().toISOString();

      if (input.isCenteredEmptyLanding) {
        input.setEnvironmentPanelPreferenceOpen(
          resolveEnvironmentPanelPreferenceAfterFirstSend({
            isCenteredEmptyLanding: input.isCenteredEmptyLanding,
            settingsDefaultOpen: input.environmentPanelDefaultOpen,
            currentPreferenceOpen: input.environmentPanelPreferenceOpen,
          }),
        );
      }
      // Arm before the optimistic row can render so both the first tail scroll and
      // the post-layout settle pass belong to this send.
      input.armTranscriptAutoFollow(input.threadId, true);
      input.appendOptimisticUserMessage({
        id: messageId,
        role: "user",
        text: prepared.text,
        dispatchMode: request.dispatchMode,
        ...(prepared.optimisticAttachments.length > 0
          ? { attachments: prepared.optimisticAttachments }
          : {}),
        ...(prepared.mentionedSkills.length > 0 ? { skills: prepared.mentionedSkills } : {}),
        ...(prepared.mentionedMentions.length > 0 ? { mentions: prepared.mentionedMentions } : {}),
        createdAt: messageCreatedAt,
        streaming: false,
        source: "native",
      });
      input.setThreadError(input.threadId, null);

      if (request.expiredTerminalContextCount > 0) {
        const copy = buildExpiredTerminalContextToastCopy(
          request.expiredTerminalContextCount,
          "omitted",
        );
        toastManager.add({
          type: "warning",
          title: copy.title,
          description: copy.description,
        });
      }
      // Queued turns use their captured snapshot and never clear a newer live draft.
      if (request.isLiveComposerSend) {
        input.clearPromptHistory();
        input.promptRef.current = "";
        input.clearComposerDraftContent(input.threadId, {
          preservePreviewUrls: true,
        });
        if (request.isLivePlanFollowUpSubmission) {
          input.setComposerInteractionMode(input.threadId, request.interactionMode);
        }
        input.setComposerHighlightedItemId(null);
        input.setComposerCursor(0);
        input.setComposerTrigger(null);
        input.focus();
      }

      return {
        ...prepared,
        messageId,
        messageCreatedAt,
      };
    },
    [input],
  );
}
