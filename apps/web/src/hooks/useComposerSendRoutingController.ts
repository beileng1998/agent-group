// FILE: useComposerSendRoutingController.ts
// Purpose: Apply automation, provider preflight, and live-turn queue routing before dispatch.
// Layer: Web composer routing controller

import { type NativeApi, type ThreadId } from "@agent-group/contracts";
import { useCallback } from "react";

import type { ComposerDraftStoreState } from "../composerDraftStore";
import { AGENT_GROUP_CAPABILITIES } from "../agentGroupCapabilities";
import { interceptComposerAutomationSend } from "../components/chat/composerAutomationInterception";
import { buildQueuedComposerChatTurn } from "../components/chat/composerQueuedTurn";
import type { Project } from "../types";
import type { ChatSendPreflightRun } from "./useChatSendPreflightController";
import type { ComposerSendAdmissionResult } from "./useComposerSendAdmissionController";

type ReadyAdmission = Extract<ComposerSendAdmissionResult, { kind: "ready" }>;
type AutomationPorts = Omit<
  Parameters<typeof interceptComposerAutomationSend>[0],
  | "enabled"
  | "api"
  | "activeProject"
  | "threadId"
  | "trimmedPrompt"
  | "hasPromptOnlySendableContent"
  | "hasLiveTurn"
  | "selectedModelSelection"
  | "providerOptions"
>;

export type ComposerSendRoutingResult =
  | { readonly kind: "handled"; readonly result: boolean }
  | {
      readonly kind: "ready";
      readonly activeProject: Project;
      readonly admission: ReadyAdmission;
    };

export function useComposerSendRoutingController(input: {
  activeProject: Project | undefined;
  threadId: ThreadId;
  hasLiveTurn: boolean;
  automation: AutomationPorts;
  runSendPreflight: ChatSendPreflightRun;
  clearComposerInput: (threadId: ThreadId) => void;
  focus: () => void;
  enqueueTurn: ComposerDraftStoreState["enqueueQueuedTurn"];
}) {
  return useCallback(
    async (request: {
      api: NativeApi;
      admission: ReadyAdmission;
      dispatchMode: "queue" | "steer";
      previewTrimmedPrompt: string;
    }): Promise<ComposerSendRoutingResult> => {
      const activeProject = input.activeProject;
      if (!activeProject) return { kind: "handled", result: false };
      const { admission } = request;
      const snapshot = admission.snapshot;
      const automationInterception = await interceptComposerAutomationSend({
        ...input.automation,
        enabled:
          AGENT_GROUP_CAPABILITIES.automations &&
          snapshot.queuedTurn === null &&
          !admission.isLivePlanFollowUpSubmission,
        api: request.api,
        activeProject,
        threadId: input.threadId,
        trimmedPrompt: snapshot.trimmedPrompt,
        hasPromptOnlySendableContent: admission.hasPromptOnlySendableContent,
        hasLiveTurn: input.hasLiveTurn,
        selectedModelSelection: snapshot.modelSelection,
        providerOptions: snapshot.providerOptions,
      });
      if (automationInterception === "handled") {
        return { kind: "handled", result: true };
      }

      const preflight = await input.runSendPreflight({
        api: request.api,
        threadId: input.threadId,
        prompt: snapshot.prompt,
        provider: snapshot.modelSelection.provider,
        images: snapshot.images,
        fileCount: snapshot.files.length,
        assistantSelectionCount: snapshot.assistantSelections.length,
      });
      if (preflight.kind === "blocked") {
        return { kind: "handled", result: false };
      }
      const routedAdmission: ReadyAdmission = {
        ...admission,
        snapshot: { ...snapshot, images: [...preflight.images] },
      };

      if (input.hasLiveTurn && request.dispatchMode === "queue" && snapshot.queuedTurn === null) {
        input.clearComposerInput(input.threadId);
        input.focus();
        const queuedTurn = await buildQueuedComposerChatTurn({
          previewTrimmedPrompt: request.previewTrimmedPrompt,
          prompt: routedAdmission.snapshot.prompt,
          images: routedAdmission.snapshot.images,
          files: routedAdmission.snapshot.files,
          assistantSelections: routedAdmission.snapshot.assistantSelections,
          fileComments: routedAdmission.snapshot.fileComments,
          terminalContexts: routedAdmission.snapshot.terminalContexts,
          pastedTexts: routedAdmission.snapshot.pastedTexts,
          skills: routedAdmission.snapshot.skills,
          mentions: routedAdmission.snapshot.mentions,
          selectedProvider: routedAdmission.snapshot.selectedProvider,
          selectedModel: routedAdmission.snapshot.selectedModel,
          selectedPromptEffort: routedAdmission.snapshot.selectedPromptEffort,
          modelSelection: routedAdmission.snapshot.modelSelection,
          ...(routedAdmission.snapshot.providerOptions
            ? { providerOptionsForDispatch: routedAdmission.snapshot.providerOptions }
            : {}),
          ...(routedAdmission.sourceProposedPlan
            ? { sourceProposedPlan: routedAdmission.sourceProposedPlan }
            : {}),
          runtimeMode: routedAdmission.snapshot.runtimeMode,
          interactionMode: routedAdmission.snapshot.interactionMode,
          envMode: routedAdmission.snapshot.envMode,
        });
        input.enqueueTurn(input.threadId, queuedTurn);
        return { kind: "handled", result: true };
      }

      return { kind: "ready", activeProject, admission: routedAdmission };
    },
    [input],
  );
}
