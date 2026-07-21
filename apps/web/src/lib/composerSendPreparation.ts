// FILE: composerSendPreparation.ts
// Purpose: Build immutable title, prompt, reference, and attachment snapshots for one send.
// Layer: Web composer send preparation

import {
  type MessageMentionReference,
  type ProviderKind,
  type ProviderSkillReference,
} from "@agent-group/contracts";
import { GENERIC_CHAT_THREAD_TITLE } from "@agent-group/shared/chatThreads";

import type {
  ComposerAssistantSelectionAttachment,
  ComposerFileAttachment,
  ComposerImageAttachment,
} from "../composerDraftStore";
import {
  appendAssistantSelectionsToPrompt,
  formatAssistantSelectionTitleSeed,
} from "./assistantSelections";
import {
  appendFileCommentsToPrompt,
  formatFileCommentTitleSeed,
  type FileCommentDraft,
} from "./fileComments";
import {
  appendPastedTextsToPrompt,
  formatPastedTextTitleSeed,
  type PastedTextDraft,
} from "./composerPastedText";
import {
  appendTerminalContextsToPrompt,
  formatTerminalContextLabel,
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  type TerminalContextDraft,
} from "./terminalContext";
import { buildUploadComposerAttachments, formatOutgoingComposerPrompt } from "./composerSend";
import { filterPromptMentionReferences, filterPromptSkillReferences } from "./composerMentions";

export interface ComposerSendTitleSeedInput {
  trimmedPrompt: string;
  images: readonly ComposerImageAttachment[];
  files: readonly ComposerFileAttachment[];
  assistantSelections: readonly ComposerAssistantSelectionAttachment[];
  terminalContexts: readonly TerminalContextDraft[];
  fileComments: readonly FileCommentDraft[];
  pastedTexts: readonly PastedTextDraft[];
}

export function buildComposerSendTitleSeed(input: ComposerSendTitleSeedInput): string {
  if (input.trimmedPrompt) return input.trimmedPrompt;
  const firstImageName = input.images[0]?.name;
  if (firstImageName) return `Image: ${firstImageName}`;
  if (input.files.length > 0) return `File: ${input.files[0]?.name ?? "attachment"}`;
  if (input.assistantSelections.length > 0) {
    return formatAssistantSelectionTitleSeed(input.assistantSelections.length);
  }
  if (input.terminalContexts.length > 0) {
    return formatTerminalContextLabel(input.terminalContexts[0]!);
  }
  if (input.fileComments.length > 0) {
    return formatFileCommentTitleSeed(input.fileComments.length);
  }
  if (input.pastedTexts.length > 0) {
    return formatPastedTextTitleSeed(input.pastedTexts) ?? GENERIC_CHAT_THREAD_TITLE;
  }
  return GENERIC_CHAT_THREAD_TITLE;
}

export function prepareOutgoingComposerMessage(input: {
  prompt: string;
  images: readonly ComposerImageAttachment[];
  files: readonly ComposerFileAttachment[];
  assistantSelections: readonly ComposerAssistantSelectionAttachment[];
  fileComments: readonly FileCommentDraft[];
  terminalContexts: readonly TerminalContextDraft[];
  pastedTexts: readonly PastedTextDraft[];
  selectedSkills: readonly ProviderSkillReference[];
  selectedMentions: readonly MessageMentionReference[];
  provider: ProviderKind;
  model: string | null;
  effort: string | null;
}) {
  const images = [...input.images];
  const files = [...input.files];
  const assistantSelections = [...input.assistantSelections];
  const fileComments = [...input.fileComments];
  const terminalContexts = [...input.terminalContexts];
  const pastedTexts = [...input.pastedTexts];
  const skills = [...input.selectedSkills];
  const mentions = [...input.selectedMentions];
  const messageText = appendPastedTextsToPrompt(
    appendFileCommentsToPrompt(
      appendTerminalContextsToPrompt(
        appendAssistantSelectionsToPrompt(input.prompt, assistantSelections),
        terminalContexts,
      ),
      fileComments,
    ),
    pastedTexts,
  );
  const outgoingTextSeed = messageText || (images.length > 0 ? IMAGE_ONLY_BOOTSTRAP_PROMPT : "");
  const text = formatOutgoingComposerPrompt({
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    text: outgoingTextSeed,
  });
  const mentionedSkills = filterPromptSkillReferences(text, skills, input.provider);
  const mentionedMentions = filterPromptMentionReferences(text, mentions);
  const attachmentsPromise = buildUploadComposerAttachments({
    images,
    files,
    assistantSelections,
  });
  const optimisticAttachments = [
    ...assistantSelections,
    ...images.map((image) => ({
      type: "image" as const,
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      previewUrl: image.previewUrl,
    })),
    ...files.map((file) => ({
      type: "file" as const,
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    })),
  ];

  return {
    assistantSelections,
    attachmentsPromise,
    fileComments,
    files,
    images,
    mentionedMentions,
    mentionedSkills,
    mentions,
    optimisticAttachments,
    pastedTexts,
    skills,
    terminalContexts,
    text,
  };
}
