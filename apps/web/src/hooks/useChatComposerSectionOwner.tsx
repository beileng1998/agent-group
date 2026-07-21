// FILE: useChatComposerSectionOwner.tsx
// Purpose: Assemble the complete composer section model from focused chat owners.
// Layer: Web chat composer presentation owner

import type { ReactElement } from "react";

import {
  ChatComposerSection,
  type ChatComposerSectionModel,
} from "../components/chat/ChatComposerSection";
import { proposedPlanTitle } from "../proposedPlan";
import type { useChatComposerModelControlsOwner } from "./useChatComposerModelControlsOwner";
import type { buildChatComposerPresentation } from "./useChatComposerPresentationOwner";

type ComposerModel = ChatComposerSectionModel;
type PromptModel = ComposerModel["editor"]["prompt"];
type ReferenceModel = NonNullable<ComposerModel["editor"]["references"]>;
type ContextMeterModel = NonNullable<ComposerModel["footer"]["actions"]["contextMeter"]>;
type VoiceRecorderModel = NonNullable<ComposerModel["footer"]["actions"]["voiceRecorder"]>;
type PlanModeControl = NonNullable<ComposerModel["footer"]["leading"]["planMode"]>;
type PlanSidebarControl = NonNullable<ComposerModel["footer"]["leading"]["planSidebar"]>;
type ComposerPresentationOwner = ReturnType<typeof buildChatComposerPresentation>;
type ComposerModelControlsOwner = ReturnType<typeof useChatComposerModelControlsOwner>;

interface PendingComposerState {
  readonly approvalActive: boolean;
  readonly userInputCount: number;
  readonly progress: {
    readonly customAnswer: string;
    readonly activeQuestionOptionCount: number | null;
  } | null;
}

export interface UseChatComposerSectionOwnerInput {
  readonly frame: {
    readonly secondaryChromeReady: boolean;
    readonly shouldRenderChatPaneContent: boolean;
    readonly centeredEmptyLanding: boolean;
    readonly form: ComposerModel["frame"]["form"];
    readonly providerClassName: string;
    readonly surfaceClassName: string;
    readonly menuVisible: ComposerPresentationOwner["menuVisible"];
  };
  readonly activity: {
    readonly measureRef: ComposerModel["activity"]["measureRef"];
    readonly presentation: ComposerPresentationOwner["activity"];
  };
  readonly editor: {
    readonly pending: PendingComposerState;
    readonly plan: {
      readonly showFollowUpPrompt: boolean;
      readonly proposed: { readonly id: string; readonly planMarkdown: string } | null;
    };
    readonly automation: {
      readonly activeThreadId: string;
      readonly pendingThreadId: string | null | undefined;
      readonly onCancel: () => void;
    };
    readonly menu: ComposerPresentationOwner["menu"];
    readonly references: ReferenceModel;
    readonly prompt: {
      readonly props: Omit<
        PromptModel,
        "disabled" | "onCollapsePastedText" | "placeholder" | "terminalContexts" | "value"
      >;
      readonly value: string;
      readonly terminalContexts: PromptModel["terminalContexts"];
      readonly canCollapsePastedText: boolean;
      readonly onCollapsePastedText: NonNullable<PromptModel["onCollapsePastedText"]>;
      readonly hasLiveTurn: boolean;
      readonly phase: string;
      readonly disabled: boolean;
    };
  };
  readonly footer: {
    readonly compact: boolean;
    readonly presentation: Pick<
      ComposerPresentationOwner,
      "leadingControls" | "primary" | "relocateLeadingControls"
    >;
    readonly plan: {
      readonly modeActive: boolean;
      readonly onToggleMode: PlanModeControl["onClick"];
      readonly sidebarVisible: boolean;
      readonly sidebarLabel: string;
      readonly sidebarTitle: string;
      readonly onToggleSidebar: PlanSidebarControl["onClick"];
    };
    readonly context: {
      readonly usage: ComposerModelControlsOwner["runtimeUsageContextWindow"];
      readonly visible: ComposerModelControlsOwner["footerControlsPlan"]["showContextMeter"];
      readonly cumulativeCostUsd: ContextMeterModel["cumulativeCostUsd"];
      readonly activeWindowLabel: ContextMeterModel["activeWindowLabel"];
      readonly pendingWindowLabel: ContextMeterModel["pendingWindowLabel"];
    };
    readonly modelControls: ComposerModelControlsOwner["modelControlsModel"];
    readonly voice: {
      readonly controlVisible: boolean;
      readonly recording: boolean;
      readonly transcribing: boolean;
      readonly connecting: boolean;
      readonly sendBusy: boolean;
      readonly durationLabel: string;
      readonly waveformLevels: VoiceRecorderModel["waveformLevels"];
      readonly cancel: () => void;
      readonly submit: () => Promise<void> | void;
    };
  };
  readonly landing: ComposerModel["landing"];
  readonly deferred: ComposerModel["deferred"];
}

export interface ChatComposerSectionOwner {
  readonly composerSectionModel: ChatComposerSectionModel;
  readonly composerSection: ReactElement;
}

export function buildChatComposerSection(
  input: UseChatComposerSectionOwnerInput,
): ChatComposerSectionOwner {
  const { pending } = input.editor;
  const blocksInlineContent = pending.approvalActive || pending.userInputCount > 0;
  const { proposed } = input.editor.plan;
  const planFollowUp =
    !blocksInlineContent && input.editor.plan.showFollowUpPrompt && proposed
      ? {
          id: proposed.id,
          title: proposedPlanTitle(proposed.planMarkdown) ?? null,
        }
      : null;
  const automationSetup =
    !blocksInlineContent &&
    input.editor.automation.pendingThreadId === input.editor.automation.activeThreadId
      ? { onCancel: input.editor.automation.onCancel }
      : null;

  const references = shouldShowReferences(input.editor.references, pending)
    ? input.editor.references
    : null;
  const prompt = buildPromptModel(input.editor);
  const footer = buildFooterModel(input.footer, pending.approvalActive);

  const composerSectionModel: ChatComposerSectionModel = {
    frame: {
      visible: input.frame.secondaryChromeReady && input.frame.shouldRenderChatPaneContent,
      centeredEmptyLanding: input.frame.centeredEmptyLanding,
      form: input.frame.form,
      shell: {
        providerClassName: input.frame.providerClassName,
        surfaceClassName: input.frame.surfaceClassName,
        menuVisible: input.frame.menuVisible,
      },
    },
    activity: {
      measureRef: input.activity.measureRef,
      ...input.activity.presentation,
    },
    editor: {
      banners: {
        roundedTopReset: false,
        planFollowUp,
        automationSetup,
      },
      menu: input.editor.menu,
      references,
      prompt,
    },
    footer,
    landing: input.landing,
    deferred: input.deferred,
  };

  return {
    composerSectionModel,
    composerSection: <ChatComposerSection model={composerSectionModel} />,
  };
}

function shouldShowReferences(references: ReferenceModel, pending: PendingComposerState): boolean {
  return (
    !pending.approvalActive &&
    pending.userInputCount === 0 &&
    (references.assistantSelections.length > 0 ||
      references.fileComments.length > 0 ||
      (references.pastedTexts?.length ?? 0) > 0 ||
      references.files.length > 0 ||
      references.images.length > 0)
  );
}

function buildPromptModel(editor: UseChatComposerSectionOwnerInput["editor"]): PromptModel {
  const { pending } = editor;
  const value = pending.approvalActive
    ? ""
    : pending.progress
      ? pending.progress.customAnswer
      : editor.prompt.value;
  const terminalContexts =
    !pending.approvalActive && pending.userInputCount === 0 ? editor.prompt.terminalContexts : [];

  return {
    ...editor.prompt.props,
    value,
    terminalContexts,
    ...(editor.prompt.canCollapsePastedText
      ? { onCollapsePastedText: editor.prompt.onCollapsePastedText }
      : {}),
    placeholder: resolvePromptPlaceholder(editor),
    disabled: editor.prompt.disabled,
  };
}

function resolvePromptPlaceholder(editor: UseChatComposerSectionOwnerInput["editor"]): string {
  const { pending } = editor;
  if (pending.approvalActive) {
    return "Resolve this approval request to continue";
  }
  if (pending.progress) {
    return pending.progress.activeQuestionOptionCount === 0
      ? "Type your answer to continue"
      : "Type your own answer, or leave this blank to use the selected option";
  }
  if (editor.plan.showFollowUpPrompt && editor.plan.proposed) {
    return "Add feedback to refine the plan, or leave this blank to implement it";
  }
  if (editor.prompt.hasLiveTurn) {
    return "Ask for follow-up changes";
  }
  return editor.prompt.phase === "disconnected"
    ? "Ask for follow-up changes or attach images"
    : "Ask anything, @tag files/folders, or use / to show available commands";
}

function buildFooterModel(
  footer: UseChatComposerSectionOwnerInput["footer"],
  approvalActive: boolean,
): ComposerModel["footer"] {
  const voiceActive = footer.voice.recording || footer.voice.transcribing;
  const contextMeter = buildContextMeter(footer.context);
  const voiceRecorder =
    footer.voice.controlVisible && voiceActive
      ? {
          disabled: approvalActive || footer.voice.connecting || footer.voice.sendBusy,
          isRecording: footer.voice.recording,
          isTranscribing: footer.voice.transcribing,
          durationLabel: footer.voice.durationLabel,
          waveformLevels: footer.voice.waveformLevels,
          onCancel: () => {
            if (footer.voice.recording) {
              void footer.voice.submit();
              return;
            }
            footer.voice.cancel();
          },
          onSubmit: () => void footer.voice.submit(),
        }
      : null;

  return {
    hidden: approvalActive,
    compact: footer.compact,
    voiceActive,
    leading: {
      relocated: footer.presentation.relocateLeadingControls,
      controls: footer.presentation.leadingControls,
      planMode: footer.plan.modeActive ? { onClick: footer.plan.onToggleMode } : null,
      planSidebar: footer.plan.sidebarVisible
        ? {
            label: footer.plan.sidebarLabel,
            title: footer.plan.sidebarTitle,
            onClick: footer.plan.onToggleSidebar,
          }
        : null,
    },
    actions: {
      contextMeter,
      modelControls: footer.modelControls,
      voiceRecorder,
      primary: footer.presentation.primary,
    },
  };
}

function buildContextMeter(
  context: UseChatComposerSectionOwnerInput["footer"]["context"],
): ContextMeterModel | null {
  if (!context.usage || !context.visible) {
    return null;
  }
  return {
    usage: context.usage,
    ...(context.cumulativeCostUsd != null ? { cumulativeCostUsd: context.cumulativeCostUsd } : {}),
    ...(context.activeWindowLabel !== undefined
      ? { activeWindowLabel: context.activeWindowLabel }
      : {}),
    ...(context.pendingWindowLabel !== undefined
      ? { pendingWindowLabel: context.pendingWindowLabel }
      : {}),
  };
}
