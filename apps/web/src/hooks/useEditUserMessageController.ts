// FILE: useEditUserMessageController.ts
// Purpose: Own rollbackable user-message edit and resend dispatch.
// Layer: Web thread controller

import {
  type AssistantDeliveryMode,
  type MessageId,
  type ModelSelection,
  type ProviderInteractionMode,
  type ProviderKind,
  type ProviderStartOptions,
  type RuntimeMode,
  type ThreadId,
} from "@agent-group/contracts";
import { resolveTailUserMessageEditTarget } from "@agent-group/shared/conversationEdit";
import { useCallback, type MutableRefObject } from "react";

import { filterPromptMentionReferences } from "../lib/composerMentions";
import { formatOutgoingComposerPrompt } from "../lib/composerSend";
import { appendOriginalComposerPromptBlocks } from "../lib/terminalContext";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import type { Thread } from "../types";

export function useEditUserMessageController(input: {
  activeThread: Thread | null | undefined;
  isServerThread: boolean;
  isRevertingCheckpoint: boolean;
  isSendBusy: boolean;
  isConnecting: boolean;
  sendInFlightRef: MutableRefObject<boolean>;
  selectedProvider: ProviderKind;
  selectedModel: string | null;
  selectedPromptEffort: string | null;
  selectedModelSelection: ModelSelection;
  providerOptionsForDispatch: ProviderStartOptions | null | undefined;
  assistantDeliveryMode: AssistantDeliveryMode;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  setHistoryMutationBusy: (busy: boolean) => void;
  setThreadError: (threadId: ThreadId, error: string | null) => void;
  persistThreadSettingsForNextTurn: (input: {
    threadId: ThreadId;
    createdAt: string;
    modelSelection?: ModelSelection;
    runtimeMode: RuntimeMode;
    interactionMode: ProviderInteractionMode;
  }) => Promise<void>;
}) {
  return useCallback(
    async (messageId: MessageId, text: string): Promise<boolean> => {
      const api = readNativeApi();
      const activeThread = input.activeThread;
      if (!api || !activeThread || !input.isServerThread || input.isRevertingCheckpoint) {
        return false;
      }
      const editTarget = resolveTailUserMessageEditTarget({
        messages: activeThread.messages,
        messageId,
        activeTurnId:
          activeThread.session?.orchestrationStatus === "running"
            ? (activeThread.session.activeTurnId ?? null)
            : null,
      });
      if (!editTarget.editable) {
        input.setThreadError(
          activeThread.id,
          "Only the latest rollbackable user message can be edited.",
        );
        return false;
      }
      const originalMessage = activeThread.messages[editTarget.messageIndex];
      if (!originalMessage || originalMessage.role !== "user") {
        input.setThreadError(
          activeThread.id,
          "Only the latest rollbackable user message can be edited.",
        );
        return false;
      }
      if (input.isSendBusy || input.isConnecting || input.sendInFlightRef.current) {
        input.setThreadError(activeThread.id, "Wait for the current send to start before editing.");
        return false;
      }

      input.setHistoryMutationBusy(true);
      input.setThreadError(activeThread.id, null);
      const messageCreatedAt = new Date().toISOString();
      const outgoingMessageText = formatOutgoingComposerPrompt({
        provider: input.selectedProvider,
        model: input.selectedModel,
        effort: input.selectedPromptEffort,
        text: appendOriginalComposerPromptBlocks({
          editedPrompt: text,
          originalPrompt: originalMessage.text,
        }),
      });
      const editedMentions = filterPromptMentionReferences(
        outgoingMessageText,
        originalMessage.mentions ?? [],
      );
      try {
        await input.persistThreadSettingsForNextTurn({
          threadId: activeThread.id,
          createdAt: messageCreatedAt,
          modelSelection: input.selectedModelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
        });
        await api.orchestration.dispatchCommand({
          type: "thread.message.edit-and-resend",
          commandId: newCommandId(),
          threadId: activeThread.id,
          messageId,
          text: outgoingMessageText,
          mentions: editedMentions,
          modelSelection: input.selectedModelSelection,
          ...(input.providerOptionsForDispatch
            ? { providerOptions: input.providerOptionsForDispatch }
            : {}),
          assistantDeliveryMode: input.assistantDeliveryMode,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          createdAt: messageCreatedAt,
        });
        return true;
      } catch (error) {
        input.setThreadError(
          activeThread.id,
          error instanceof Error ? error.message : "Failed to edit message.",
        );
        return false;
      } finally {
        input.setHistoryMutationBusy(false);
      }
    },
    [input],
  );
}
