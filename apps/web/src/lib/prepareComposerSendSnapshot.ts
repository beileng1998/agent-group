// FILE: prepareComposerSendSnapshot.ts
// Purpose: Freeze a live or queued composer draft into one send snapshot.
// Layer: Web composer send preparation

import {
  type MessageMentionReference,
  type ModelSelection,
  type ProviderInteractionMode,
  type ProviderKind,
  type ProviderSkillReference,
  type ProviderStartOptions,
  type RuntimeMode,
} from "@agent-group/contracts";

import {
  type ComposerAssistantSelectionAttachment,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  type PersistedComposerImageAttachment,
  type QueuedComposerChatTurn,
} from "../composerDraftStore";
import { deriveComposerSendState } from "../components/ChatView.composerHistory";
import {
  findPendingBlobComposerAttachments,
  hydratePendingBlobComposerAttachments,
} from "./composerSend";
import type { PastedTextDraft } from "./composerPastedText";
import type { FileCommentDraft } from "./fileComments";
import type { TerminalContextDraft } from "./terminalContext";

interface LiveComposerSendState {
  prompt: string;
  images: ComposerImageAttachment[];
  files: ComposerFileAttachment[];
  assistantSelections: ComposerAssistantSelectionAttachment[];
  fileComments: FileCommentDraft[];
  terminalContexts: TerminalContextDraft[];
  pastedTexts: PastedTextDraft[];
  skills: ProviderSkillReference[];
  mentions: MessageMentionReference[];
  selectedProvider: ProviderKind;
  selectedModel: string | null;
  selectedPromptEffort: string | null;
  modelSelection: ModelSelection;
  providerOptions: ProviderStartOptions | undefined;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  envMode: DraftThreadEnvMode;
}

export async function prepareComposerSendSnapshot(input: {
  queuedTurn?: QueuedComposerChatTurn;
  live: LiveComposerSendState;
  persistedAttachments: PersistedComposerImageAttachment[];
}) {
  const queuedTurn = input.queuedTurn ?? null;
  const live = input.live;
  const prompt = queuedTurn?.prompt ?? live.prompt;
  let images = queuedTurn?.images ?? live.images;

  if (queuedTurn === null) {
    const pendingBlobAttachments = findPendingBlobComposerAttachments({
      persistedAttachments: input.persistedAttachments,
      images,
    });
    if (pendingBlobAttachments.length > 0) {
      const hydrated = await hydratePendingBlobComposerAttachments(pendingBlobAttachments);
      if (hydrated.length > 0) images = [...images, ...hydrated];
    }
  }

  const files = queuedTurn?.files ?? live.files;
  const assistantSelections = queuedTurn?.assistantSelections ?? live.assistantSelections;
  const fileComments = queuedTurn?.fileComments ?? live.fileComments;
  const terminalContexts = queuedTurn?.terminalContexts ?? live.terminalContexts;
  const pastedTexts = queuedTurn?.pastedTexts ?? live.pastedTexts;
  const skills = queuedTurn?.skills ?? live.skills;
  const mentions = queuedTurn?.mentions ?? live.mentions;
  const sendState = deriveComposerSendState({
    prompt,
    imageCount: images.length,
    fileCount: files.length,
    assistantSelectionCount: assistantSelections.length,
    fileCommentCount: fileComments.length,
    terminalContexts,
    pastedTexts,
  });

  return {
    assistantSelections,
    envMode: queuedTurn?.envMode ?? live.envMode,
    expiredTerminalContextCount: sendState.expiredTerminalContextCount,
    fileComments,
    files,
    hasSendableContent: sendState.hasSendableContent,
    images,
    interactionMode: queuedTurn?.interactionMode ?? live.interactionMode,
    mentions,
    modelSelection: queuedTurn?.modelSelection ?? live.modelSelection,
    pastedTexts: sendState.sendablePastedTexts,
    prompt,
    providerOptions: queuedTurn?.providerOptionsForDispatch ?? live.providerOptions,
    queuedTurn,
    runtimeMode: queuedTurn?.runtimeMode ?? live.runtimeMode,
    selectedModel: queuedTurn?.selectedModel ?? live.selectedModel,
    selectedPromptEffort: queuedTurn?.selectedPromptEffort ?? live.selectedPromptEffort,
    selectedProvider: queuedTurn?.selectedProvider ?? live.selectedProvider,
    skills,
    terminalContexts: sendState.sendableTerminalContexts,
    trimmedPrompt: sendState.trimmedPrompt,
  };
}

export type PreparedComposerSendSnapshot = Awaited<ReturnType<typeof prepareComposerSendSnapshot>>;
