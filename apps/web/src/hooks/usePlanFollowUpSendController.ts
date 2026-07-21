// FILE: usePlanFollowUpSendController.ts
// Purpose: Dispatch same-thread plan refinement and implementation follow-ups.
// Layer: Web plan/composer controller

import {
  type AssistantDeliveryMode,
  type ModelSelection,
  type ProviderInteractionMode,
  type ProviderKind,
  type ProviderStartOptions,
  type RuntimeMode,
  type ThreadId,
} from "@agent-group/contracts";
import { useCallback, type MutableRefObject } from "react";

import type { ComposerDraftStoreState, QueuedComposerPlanFollowUp } from "../composerDraftStore";
import { formatOutgoingComposerPrompt } from "../lib/composerSend";
import { newCommandId, newMessageId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { buildSourceProposedPlanReference } from "../session-logic";
import type { ChatMessage, ProposedPlan } from "../types";

type DispatchMode = "queue" | "steer";

export function usePlanFollowUpSendController(input: {
  activeThreadId: ThreadId | null;
  proposedPlan: Pick<ProposedPlan, "id"> | null;
  isServerThread: boolean;
  isSendBusy: boolean;
  isConnecting: boolean;
  sendInFlightRef: MutableRefObject<boolean>;
  selectedProvider: ProviderKind;
  selectedModel: string | null;
  selectedPromptEffort: string | null;
  modelSelection: ModelSelection;
  providerOptions: ProviderStartOptions | undefined;
  assistantDeliveryMode: AssistantDeliveryMode;
  runtimeMode: RuntimeMode;
  beginLocalDispatch: () => void;
  resetLocalDispatch: () => void;
  setThreadError: (threadId: ThreadId, error: string | null) => void;
  appendOptimisticUserMessage: (message: ChatMessage) => void;
  removeOptimisticUserMessage: (messageId: ChatMessage["id"]) => void;
  armTranscriptAutoFollow: (threadId: ThreadId, armed: boolean) => void;
  persistThreadSettings: (next: {
    threadId: ThreadId;
    createdAt: string;
    modelSelection?: ModelSelection;
    runtimeMode: RuntimeMode;
    interactionMode: ProviderInteractionMode;
  }) => Promise<void>;
  setInteractionMode: ComposerDraftStoreState["setInteractionMode"];
  rememberCustomBinaryPath: (request: {
    threadId: ThreadId;
    provider: ProviderKind;
    providerOptions: ProviderStartOptions | undefined;
  }) => void;
  beginNonCodexSteerGate: () => void;
  openPlanSidebar: () => void;
}) {
  return useCallback(
    async ({
      text,
      interactionMode,
      dispatchMode,
      queuedTurn,
    }: {
      text: string;
      interactionMode: "default" | "plan";
      dispatchMode: DispatchMode;
      queuedTurn?: QueuedComposerPlanFollowUp;
    }): Promise<boolean> => {
      const api = readNativeApi();
      const threadId = input.activeThreadId;
      if (
        !api ||
        !threadId ||
        !input.isServerThread ||
        input.isSendBusy ||
        input.isConnecting ||
        input.sendInFlightRef.current
      ) {
        return false;
      }
      const trimmed = text.trim();
      if (!trimmed) return false;

      const messageId = newMessageId();
      const createdAt = new Date().toISOString();
      const outgoingText = formatOutgoingComposerPrompt({
        provider: queuedTurn?.selectedProvider ?? input.selectedProvider,
        model: queuedTurn?.selectedModel ?? input.selectedModel,
        effort: queuedTurn?.selectedPromptEffort ?? input.selectedPromptEffort,
        text: trimmed,
      });

      input.sendInFlightRef.current = true;
      input.beginLocalDispatch();
      input.setThreadError(threadId, null);
      input.appendOptimisticUserMessage({
        id: messageId,
        role: "user",
        text: outgoingText,
        dispatchMode,
        createdAt,
        streaming: false,
        source: "native",
      });
      input.armTranscriptAutoFollow(threadId, true);

      try {
        const modelSelection = queuedTurn?.modelSelection ?? input.modelSelection;
        const runtimeMode = queuedTurn?.runtimeMode ?? input.runtimeMode;
        await input.persistThreadSettings({
          threadId,
          createdAt,
          modelSelection,
          runtimeMode,
          interactionMode,
        });
        input.setInteractionMode(threadId, interactionMode);

        const providerOptions = queuedTurn?.providerOptionsForDispatch ?? input.providerOptions;
        const sourceProposedPlan =
          interactionMode === "default"
            ? buildSourceProposedPlanReference({
                threadId,
                proposedPlan: input.proposedPlan,
              })
            : undefined;
        input.rememberCustomBinaryPath({
          threadId,
          provider: modelSelection.provider,
          providerOptions,
        });
        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId,
          message: {
            messageId,
            role: "user",
            text: outgoingText,
            attachments: [],
          },
          modelSelection,
          ...(providerOptions ? { providerOptions } : {}),
          assistantDeliveryMode: input.assistantDeliveryMode,
          dispatchMode,
          runtimeMode,
          interactionMode,
          ...(sourceProposedPlan ? { sourceProposedPlan } : {}),
          createdAt,
        });
        if (dispatchMode === "steer" && modelSelection.provider !== "codex") {
          input.beginNonCodexSteerGate();
        }
        if (interactionMode === "default") input.openPlanSidebar();
        input.sendInFlightRef.current = false;
        return true;
      } catch (error) {
        input.removeOptimisticUserMessage(messageId);
        input.setThreadError(
          threadId,
          error instanceof Error ? error.message : "Failed to send plan follow-up.",
        );
        input.sendInFlightRef.current = false;
        input.resetLocalDispatch();
        return false;
      }
    },
    [input],
  );
}
