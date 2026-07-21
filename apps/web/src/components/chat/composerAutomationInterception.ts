// FILE: composerAutomationInterception.ts
// Purpose: Intercept live prompt sends that define or continue an automation setup.
// Layer: Web composer automation

import {
  type ModelSelection,
  type NativeApi,
  type ProviderStartOptions,
  type ThreadId,
} from "@agent-group/contracts";
import type { MutableRefObject } from "react";

import type { ComposerTrigger } from "../../composer-logic";
import type { PendingAutomationConversation } from "../../hooks/useAutomationConversationController";
import {
  automationClarificationPrompt,
  buildComposerAutomationDraft,
  resolveComposerAutomationRequest,
} from "../../lib/composerAutomation";
import type { AutomationDraftWarning, AutomationDraftWarningId } from "../../lib/automationDraft";
import type { Project } from "../../types";
import {
  projectModelSelection as automationProjectModelSelection,
  type AutomationFormState,
} from "../../routes/-automations.shared";
import { toastManager } from "../ui/toast";
import { makeAutomationSetupBubble } from "./chatViewSetupAutomation";

type ComposerAutomationDraft = ReturnType<typeof buildComposerAutomationDraft>;

export async function interceptComposerAutomationSend(input: {
  enabled: boolean;
  api: NativeApi;
  activeProject: Project;
  automationProjects: readonly Project[];
  threadId: ThreadId;
  trimmedPrompt: string;
  hasPromptOnlySendableContent: boolean;
  hasLiveTurn: boolean;
  selectedModelSelection: ModelSelection;
  providerOptions: ProviderStartOptions | undefined;
  conversation: PendingAutomationConversation | null;
  promptRef: MutableRefObject<string>;
  setComposerDraftPrompt: (threadId: ThreadId, prompt: string) => void;
  setComposerTrigger: (trigger: ComposerTrigger | null) => void;
  armTranscriptAutoFollow: (threadId: ThreadId, force: boolean) => void;
  setConversation: (conversation: PendingAutomationConversation) => void;
  clearConversation: () => void;
  isResolveCurrent: (request: {
    threadId: ThreadId;
    conversation: PendingAutomationConversation | null;
    startedWithLiveTurn: boolean;
  }) => boolean;
  openDraftReview: (draft: ComposerAutomationDraft) => void;
  prepareFormForCreate: (form: AutomationFormState) => Promise<{
    readonly form: AutomationFormState;
    readonly activityThreadId: ThreadId | null;
  } | null>;
  createFromForm: (input: {
    readonly form: AutomationFormState;
    readonly warnings: readonly AutomationDraftWarning[];
    readonly acknowledgedWarningIds: ReadonlySet<AutomationDraftWarningId>;
    readonly activityThreadId: ThreadId | null;
    readonly providerOptions?: ProviderStartOptions;
  }) => Promise<boolean>;
}): Promise<"continue" | "handled"> {
  if (!input.enabled) {
    return "continue";
  }

  const conversation = input.conversation;
  const messageForAutomation = conversation
    ? `${conversation.accumulatedMessage}\n${input.trimmedPrompt}`
    : input.trimmedPrompt;
  const automationRequest = await resolveComposerAutomationRequest({
    message: messageForAutomation,
    cwd: input.activeProject.cwd,
    generateIntent: (request) => input.api.server.generateAutomationIntent(request),
  });
  if (
    !input.isResolveCurrent({
      threadId: input.threadId,
      conversation,
      startedWithLiveTurn: input.hasLiveTurn,
    })
  ) {
    return "handled";
  }

  if (automationRequest.type === "normal-chat") {
    if (conversation) {
      input.clearConversation();
    }
    return "continue";
  }

  if (automationRequest.type === "needs-clarification") {
    if (!input.hasPromptOnlySendableContent || input.hasLiveTurn) {
      toastManager.add({
        type: "warning",
        title: "Automation needs a bit more detail",
        description:
          automationRequest.reason ??
          'Add what it should do and how often, e.g. "every weekday at 9am, summarize my PRs".',
      });
      return "handled";
    }

    const question = automationClarificationPrompt(automationRequest.missingFields);
    const liveDraft = input.promptRef.current.trimStart();
    const leftover = liveDraft.startsWith(input.trimmedPrompt)
      ? liveDraft.slice(input.trimmedPrompt.length).trimStart()
      : liveDraft;
    input.promptRef.current = leftover;
    input.setComposerDraftPrompt(input.threadId, leftover);
    input.setComposerTrigger(null);
    input.armTranscriptAutoFollow(input.threadId, true);
    input.setConversation({
      threadId: input.threadId,
      accumulatedMessage: automationRequest.automationMessage,
      bubbles: [
        ...(conversation?.bubbles ?? []),
        makeAutomationSetupBubble("user", input.trimmedPrompt),
        makeAutomationSetupBubble("assistant", question),
      ],
    });
    return "handled";
  }

  input.clearConversation();
  const automationIntent = automationRequest.resolution.intent;
  const targetThreadId = automationIntent.executionScope === "thread" ? input.threadId : null;
  const draft = buildComposerAutomationDraft({
    resolution: automationRequest.resolution,
    projectId: input.activeProject.id,
    projectModelSelection: automationProjectModelSelection(
      input.automationProjects,
      input.activeProject.id,
    ),
    selectedModelSelection: input.selectedModelSelection,
    targetThreadId,
    hasEphemeralContext: !input.hasPromptOnlySendableContent,
  });

  if (draft.needsDraftReview || conversation !== null) {
    if (conversation) {
      const liveDraft = input.promptRef.current.trimStart();
      const leftover = liveDraft.startsWith(input.trimmedPrompt)
        ? liveDraft.slice(input.trimmedPrompt.length).trimStart()
        : liveDraft;
      const restoredPrompt = leftover
        ? `${messageForAutomation}\n${leftover}`
        : messageForAutomation;
      input.promptRef.current = restoredPrompt;
      input.setComposerDraftPrompt(input.threadId, restoredPrompt);
    }
    input.openDraftReview(draft);
    return "handled";
  }

  const prepared = await input.prepareFormForCreate(draft.form);
  if (!prepared) {
    return "handled";
  }
  await input.createFromForm({
    form: prepared.form,
    warnings: draft.warnings,
    acknowledgedWarningIds: draft.acknowledgedWarningIds,
    activityThreadId: prepared.activityThreadId,
    ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
  });
  return "handled";
}
