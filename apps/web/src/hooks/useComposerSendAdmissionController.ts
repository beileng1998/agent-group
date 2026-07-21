// FILE: useComposerSendAdmissionController.ts
// Purpose: Decide whether a prepared composer send is consumed or may continue to dispatch.
// Layer: Web composer admission controller

import {
  type ModelSelection,
  type ProviderKind,
  type ProviderStartOptions,
  type RuntimeMode,
  type ThreadId,
} from "@agent-group/contracts";
import { useCallback } from "react";

import type {
  ComposerDraftStoreState,
  RestoredComposerSourceProposedPlan,
} from "../composerDraftStore";
import { buildExpiredTerminalContextToastCopy } from "../components/ChatView.threadPresentation";
import { toastManager } from "../components/ui/toast";
import type { PreparedComposerSendSnapshot } from "../lib/prepareComposerSendSnapshot";
import { randomUUID } from "../lib/utils";
import { resolvePlanFollowUpSubmission } from "../proposedPlan";
import { buildSourceProposedPlanReference } from "../session-logic";
import type { ProposedPlan } from "../types";

type DispatchMode = "queue" | "steer";

export type ComposerSendAdmissionResult =
  | { kind: "handled"; result: boolean }
  | {
      kind: "ready";
      snapshot: PreparedComposerSendSnapshot;
      hasPromptOnlySendableContent: boolean;
      isLivePlanFollowUpSubmission: boolean;
      sourceProposedPlan:
        | NonNullable<RestoredComposerSourceProposedPlan["sourceProposedPlan"]>
        | undefined;
    };

export function useComposerSendAdmissionController(input: {
  activeThreadId: ThreadId | null;
  activeProposedPlan: Pick<ProposedPlan, "id" | "planMarkdown"> | null;
  showPlanFollowUpPrompt: boolean;
  hasLiveTurn: boolean;
  selectedProvider: ProviderKind;
  selectedModel: string | null;
  selectedPromptEffort: string | null;
  modelSelection: ModelSelection;
  providerOptions: ProviderStartOptions | undefined;
  runtimeMode: RuntimeMode;
  resolveRestoredSource: (
    threadId: ThreadId,
    prompt: string,
  ) => RestoredComposerSourceProposedPlan | null;
  clearComposerInput: (threadId: ThreadId) => void;
  focus: () => void;
  enqueueTurn: ComposerDraftStoreState["enqueueQueuedTurn"];
  submitPlanFollowUp: (request: {
    text: string;
    interactionMode: "default" | "plan";
    dispatchMode: DispatchMode;
  }) => Promise<boolean>;
  handleStandaloneSlashCommand: (prompt: string) => Promise<boolean>;
  clearPendingAutomationConversation: () => void;
}) {
  return useCallback(
    async (
      snapshot: PreparedComposerSendSnapshot,
      dispatchMode: DispatchMode,
    ): Promise<ComposerSendAdmissionResult> => {
      const threadId = input.activeThreadId;
      if (!threadId) return { kind: "handled", result: false };

      const restoredSource =
        snapshot.queuedTurn === null
          ? input.resolveRestoredSource(threadId, snapshot.prompt)
          : null;
      const isLivePlanFollowUpSubmission =
        snapshot.queuedTurn === null &&
        restoredSource === null &&
        input.showPlanFollowUpPrompt &&
        input.activeProposedPlan !== null;
      const hasStructuredPlanFollowUpContent =
        snapshot.images.length > 0 ||
        snapshot.files.length > 0 ||
        snapshot.assistantSelections.length > 0 ||
        snapshot.fileComments.length > 0 ||
        snapshot.terminalContexts.length > 0 ||
        snapshot.pastedTexts.length > 0;
      let admittedSnapshot = snapshot;

      if (isLivePlanFollowUpSubmission && input.activeProposedPlan) {
        const followUp = resolvePlanFollowUpSubmission({
          draftText: snapshot.trimmedPrompt,
          planMarkdown: input.activeProposedPlan.planMarkdown,
        });
        if (hasStructuredPlanFollowUpContent) {
          admittedSnapshot = {
            ...snapshot,
            prompt: followUp.text,
            interactionMode: followUp.interactionMode,
            trimmedPrompt: followUp.text.trim(),
          };
        } else {
          input.clearComposerInput(threadId);
          input.focus();
          if (input.hasLiveTurn && dispatchMode === "queue") {
            input.enqueueTurn(threadId, {
              id: randomUUID(),
              kind: "plan-follow-up",
              createdAt: new Date().toISOString(),
              previewText: followUp.text.trim(),
              text: followUp.text,
              interactionMode: followUp.interactionMode,
              selectedProvider: input.selectedProvider,
              selectedModel: input.selectedModel,
              selectedPromptEffort: input.selectedPromptEffort,
              modelSelection: input.modelSelection,
              ...(input.providerOptions
                ? { providerOptionsForDispatch: input.providerOptions }
                : {}),
              runtimeMode: input.runtimeMode,
            });
            return { kind: "handled", result: true };
          }
          return {
            kind: "handled",
            result: await input.submitPlanFollowUp({
              text: followUp.text,
              interactionMode: followUp.interactionMode,
              dispatchMode,
            }),
          };
        }
      }

      const hasPromptOnlySendableContent =
        admittedSnapshot.images.length === 0 &&
        admittedSnapshot.files.length === 0 &&
        admittedSnapshot.assistantSelections.length === 0 &&
        admittedSnapshot.fileComments.length === 0 &&
        admittedSnapshot.terminalContexts.length === 0 &&
        admittedSnapshot.pastedTexts.length === 0 &&
        admittedSnapshot.mentions.length === 0;
      if (
        hasPromptOnlySendableContent &&
        (await input.handleStandaloneSlashCommand(admittedSnapshot.trimmedPrompt))
      ) {
        input.clearPendingAutomationConversation();
        return { kind: "handled", result: true };
      }

      const sourceProposedPlan =
        admittedSnapshot.queuedTurn?.sourceProposedPlan ??
        restoredSource?.sourceProposedPlan ??
        (isLivePlanFollowUpSubmission &&
        input.activeProposedPlan &&
        admittedSnapshot.interactionMode === "default"
          ? buildSourceProposedPlanReference({
              threadId,
              proposedPlan: input.activeProposedPlan,
            })
          : undefined);
      if (!admittedSnapshot.hasSendableContent) {
        if (admittedSnapshot.expiredTerminalContextCount > 0) {
          const copy = buildExpiredTerminalContextToastCopy(
            admittedSnapshot.expiredTerminalContextCount,
            "empty",
          );
          toastManager.add({
            type: "warning",
            title: copy.title,
            description: copy.description,
          });
        }
        return { kind: "handled", result: false };
      }
      return {
        kind: "ready",
        snapshot: admittedSnapshot,
        hasPromptOnlySendableContent,
        isLivePlanFollowUpSubmission,
        sourceProposedPlan,
      };
    },
    [input],
  );
}
