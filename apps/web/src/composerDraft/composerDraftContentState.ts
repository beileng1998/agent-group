// FILE: composerDraftContentState.ts
// Purpose: Normalize composer content, attachment references, and history snapshots.
// Layer: Web composer domain state

import type {
  MessageMentionReference,
  ModelSelection,
  ProviderKind,
  ProviderSkillReference,
  ThreadId,
} from "@agent-group/contracts";
import type { TerminalContextDraft } from "../lib/terminalContext";
import { normalizeTerminalContextText } from "../lib/terminalContext";
import type { FileCommentDraft, FileCommentSelection } from "../lib/fileComments";
import { normalizeFileCommentSelection } from "../lib/fileComments";
import type { PastedTextDraft } from "../lib/composerPastedText";
import {
  countPastedTextLines,
  createPastedTextDraft,
  normalizePastedTextContent,
} from "../lib/composerPastedText";
import { normalizeAssistantSelectionAttachment } from "../lib/assistantSelections";
import type {
  ComposerAssistantSelectionAttachment,
  ComposerFileAttachment,
  ComposerImageAttachment,
  ComposerPromptHistorySavedDraft,
  PersistedComposerImageAttachment,
  PersistedPastedTextDraft,
  QueuedComposerTurn,
} from "./composerDraftContracts";
import {
  cloneComposerImageAttachment,
  revokeObjectPreviewUrl,
} from "./composerDraftImageLifecycle";
import type { ComposerThreadDraftState } from "./composerDraftState";

export const EMPTY_IMAGES: ComposerImageAttachment[] = [];
export const EMPTY_FILES: ComposerFileAttachment[] = [];
export const EMPTY_IDS: string[] = [];
export const EMPTY_PERSISTED_ATTACHMENTS: PersistedComposerImageAttachment[] = [];
export const EMPTY_TERMINAL_CONTEXTS: TerminalContextDraft[] = [];
export const EMPTY_PASTED_TEXTS: PastedTextDraft[] = [];
export const EMPTY_SKILLS: ProviderSkillReference[] = [];
export const EMPTY_MENTIONS: MessageMentionReference[] = [];
export const EMPTY_QUEUED_TURNS: QueuedComposerTurn[] = [];
Object.freeze(EMPTY_IMAGES);
Object.freeze(EMPTY_FILES);
Object.freeze(EMPTY_IDS);
Object.freeze(EMPTY_PERSISTED_ATTACHMENTS);
Object.freeze(EMPTY_PASTED_TEXTS);
Object.freeze(EMPTY_SKILLS);
Object.freeze(EMPTY_MENTIONS);
Object.freeze(EMPTY_QUEUED_TURNS);
export const EMPTY_MODEL_SELECTION_BY_PROVIDER: Partial<Record<ProviderKind, ModelSelection>> =
  Object.freeze({});

export const EMPTY_THREAD_DRAFT = Object.freeze<ComposerThreadDraftState>({
  prompt: "",
  promptHistorySavedDraft: null,
  images: EMPTY_IMAGES,
  files: EMPTY_FILES,
  nonPersistedImageIds: EMPTY_IDS,
  persistedAttachments: EMPTY_PERSISTED_ATTACHMENTS,
  assistantSelections: [],
  terminalContexts: EMPTY_TERMINAL_CONTEXTS,
  fileComments: [],
  pastedTexts: EMPTY_PASTED_TEXTS,
  skills: EMPTY_SKILLS,
  mentions: EMPTY_MENTIONS,
  queuedTurns: EMPTY_QUEUED_TURNS,
  restoredSourceProposedPlan: null,
  modelSelectionByProvider: EMPTY_MODEL_SELECTION_BY_PROVIDER,
  activeProvider: null,
  runtimeMode: null,
  interactionMode: null,
});

export function createEmptyThreadDraft(): ComposerThreadDraftState {
  return {
    prompt: "",
    promptHistorySavedDraft: null,
    images: [],
    files: [],
    nonPersistedImageIds: [],
    persistedAttachments: [],
    assistantSelections: [],
    terminalContexts: [],
    fileComments: [],
    pastedTexts: [],
    skills: [],
    mentions: [],
    queuedTurns: [],
    restoredSourceProposedPlan: null,
    modelSelectionByProvider: {},
    activeProvider: null,
    runtimeMode: null,
    interactionMode: null,
  };
}

export function composerImageDedupKey(image: ComposerImageAttachment): string {
  // Keep this independent from File.lastModified so dedupe is stable for hydrated
  // images reconstructed from localStorage (which get a fresh lastModified value).
  return `${image.mimeType}\u0000${image.sizeBytes}\u0000${image.name}`;
}

export function mergeComposerImages(
  existingImages: ReadonlyArray<ComposerImageAttachment>,
  incomingImages: ReadonlyArray<ComposerImageAttachment>,
): ComposerImageAttachment[] | null {
  const existingIds = new Set(existingImages.map((image) => image.id));
  const existingDedupKeys = new Set(existingImages.map((image) => composerImageDedupKey(image)));
  const acceptedPreviewUrls = new Set(existingImages.map((image) => image.previewUrl));
  const acceptedIncoming: ComposerImageAttachment[] = [];
  for (const image of incomingImages) {
    const dedupKey = composerImageDedupKey(image);
    if (existingIds.has(image.id) || existingDedupKeys.has(dedupKey)) {
      if (!acceptedPreviewUrls.has(image.previewUrl)) {
        revokeObjectPreviewUrl(image.previewUrl);
      }
      continue;
    }
    acceptedIncoming.push(image);
    existingIds.add(image.id);
    existingDedupKeys.add(dedupKey);
    acceptedPreviewUrls.add(image.previewUrl);
  }
  return acceptedIncoming.length > 0 ? [...existingImages, ...acceptedIncoming] : null;
}

export function composerFileDedupKey(file: ComposerFileAttachment): string {
  return `${file.mimeType}\u0000${file.sizeBytes}\u0000${file.name}`;
}

export function terminalContextDedupKey(context: TerminalContextDraft): string {
  return `${context.terminalId}\u0000${context.lineStart}\u0000${context.lineEnd}`;
}

export function assistantSelectionDedupKey(
  selection: Pick<ComposerAssistantSelectionAttachment, "assistantMessageId" | "text">,
): string {
  return `${selection.assistantMessageId}\u0000${selection.text}`;
}

export function normalizeAssistantSelection(
  selection: Pick<ComposerAssistantSelectionAttachment, "id" | "assistantMessageId" | "text">,
): ComposerAssistantSelectionAttachment | null {
  const normalized = normalizeAssistantSelectionAttachment(selection);
  if (!normalized) {
    return null;
  }
  return {
    type: "assistant-selection",
    ...selection,
    assistantMessageId: normalized.assistantMessageId,
    text: normalized.text,
  };
}

export function normalizeAssistantSelections(
  selections: ReadonlyArray<
    Pick<ComposerAssistantSelectionAttachment, "id" | "assistantMessageId" | "text">
  >,
): ComposerAssistantSelectionAttachment[] {
  const normalizedSelections: ComposerAssistantSelectionAttachment[] = [];
  const existingIds = new Set<string>();
  const existingDedupKeys = new Set<string>();

  for (const selection of selections) {
    const normalizedSelection = normalizeAssistantSelection(selection);
    if (!normalizedSelection) {
      continue;
    }
    const dedupKey = assistantSelectionDedupKey(normalizedSelection);
    if (existingIds.has(normalizedSelection.id) || existingDedupKeys.has(dedupKey)) {
      continue;
    }
    normalizedSelections.push(normalizedSelection);
    existingIds.add(normalizedSelection.id);
    existingDedupKeys.add(dedupKey);
  }

  return normalizedSelections;
}

export function fileCommentDedupKey(comment: FileCommentSelection): string {
  return JSON.stringify([comment.path, comment.startLine, comment.endLine, comment.text]);
}

export function normalizeFileComment(comment: FileCommentDraft): FileCommentDraft | null {
  const normalized = normalizeFileCommentSelection(comment);
  if (!normalized) {
    return null;
  }
  return {
    id: comment.id,
    ...normalized,
  };
}

export function normalizeFileComments(
  comments: ReadonlyArray<FileCommentDraft>,
): FileCommentDraft[] {
  const normalizedComments: FileCommentDraft[] = [];
  const existingIds = new Set<string>();
  const existingDedupKeys = new Set<string>();

  for (const comment of comments) {
    const normalizedComment = normalizeFileComment(comment);
    if (!normalizedComment) {
      continue;
    }
    const dedupKey = fileCommentDedupKey(normalizedComment);
    if (existingIds.has(normalizedComment.id) || existingDedupKeys.has(dedupKey)) {
      continue;
    }
    normalizedComments.push(normalizedComment);
    existingIds.add(normalizedComment.id);
    existingDedupKeys.add(dedupKey);
  }

  return normalizedComments;
}

export function normalizePastedText(pasted: PastedTextDraft): PastedTextDraft | null {
  const text = normalizePastedTextContent(pasted.text);
  if (pasted.id.length === 0 || text.length === 0) {
    return null;
  }
  return {
    id: pasted.id,
    createdAt: pasted.createdAt,
    text,
    lineCount: countPastedTextLines(text),
    charCount: text.length,
  };
}

// Dedupe by id only — two identical pastes are distinct chips at distinct
// positions, so content collisions must not collapse them.
export function normalizePastedTexts(
  pastedTexts: ReadonlyArray<PastedTextDraft>,
): PastedTextDraft[] {
  const normalizedPastedTexts: PastedTextDraft[] = [];
  const existingIds = new Set<string>();
  for (const pasted of pastedTexts) {
    const normalized = normalizePastedText(pasted);
    if (!normalized || existingIds.has(normalized.id)) {
      continue;
    }
    normalizedPastedTexts.push(normalized);
    existingIds.add(normalized.id);
  }
  return normalizedPastedTexts;
}

export function hydratePastedTextsFromPersisted(
  persisted: ReadonlyArray<PersistedPastedTextDraft> | undefined,
): PastedTextDraft[] {
  if (!persisted || persisted.length === 0) {
    return [];
  }
  return normalizePastedTexts(persisted.map((entry) => createPastedTextDraft(entry)));
}

export function normalizeTerminalContextForThread(
  threadId: ThreadId,
  context: TerminalContextDraft,
): TerminalContextDraft | null {
  const terminalId = context.terminalId.trim();
  const terminalLabel = context.terminalLabel.trim();
  if (terminalId.length === 0 || terminalLabel.length === 0) {
    return null;
  }
  const lineStart = Math.max(1, Math.floor(context.lineStart));
  const lineEnd = Math.max(lineStart, Math.floor(context.lineEnd));
  return {
    ...context,
    threadId,
    terminalId,
    terminalLabel,
    lineStart,
    lineEnd,
    text: normalizeTerminalContextText(context.text),
  };
}

export function normalizeTerminalContextsForThread(
  threadId: ThreadId,
  contexts: ReadonlyArray<TerminalContextDraft>,
): TerminalContextDraft[] {
  const existingIds = new Set<string>();
  const existingDedupKeys = new Set<string>();
  const normalizedContexts: TerminalContextDraft[] = [];

  for (const context of contexts) {
    const normalizedContext = normalizeTerminalContextForThread(threadId, context);
    if (!normalizedContext) {
      continue;
    }
    const dedupKey = terminalContextDedupKey(normalizedContext);
    if (existingIds.has(normalizedContext.id) || existingDedupKeys.has(dedupKey)) {
      continue;
    }
    normalizedContexts.push(normalizedContext);
    existingIds.add(normalizedContext.id);
    existingDedupKeys.add(dedupKey);
  }

  return normalizedContexts;
}

// Moves all sendable composer content into a hidden draft while history text is being browsed.
export function captureComposerPromptHistorySavedDraft(input: {
  threadId: ThreadId;
  draft: ComposerThreadDraftState;
  prompt: string;
}): ComposerPromptHistorySavedDraft {
  const { threadId, draft, prompt } = input;
  return {
    prompt,
    // Keep the same image objects here: ownership moves from visible composer to saved snapshot.
    images: [...draft.images],
    files: [...draft.files],
    nonPersistedImageIds: [...draft.nonPersistedImageIds],
    persistedAttachments: [...draft.persistedAttachments],
    assistantSelections: normalizeAssistantSelections(draft.assistantSelections),
    terminalContexts: normalizeTerminalContextsForThread(threadId, draft.terminalContexts),
    fileComments: normalizeFileComments(draft.fileComments),
    pastedTexts: normalizePastedTexts(draft.pastedTexts),
    skills: [...draft.skills],
    mentions: [...draft.mentions],
  };
}

export function buildTransferredComposerDraft(input: {
  sourceDraft: ComposerThreadDraftState;
  targetDraft: ComposerThreadDraftState | undefined;
  targetThreadId: ThreadId;
}): ComposerThreadDraftState {
  const { sourceDraft, targetDraft, targetThreadId } = input;
  const base = targetDraft ?? createEmptyThreadDraft();
  return {
    ...base,
    prompt: sourceDraft.prompt,
    promptHistorySavedDraft: clonePromptHistorySavedDraft(
      sourceDraft.promptHistorySavedDraft,
      targetThreadId,
    ),
    images: sourceDraft.images.map(cloneComposerImageAttachment),
    files: [...sourceDraft.files],
    nonPersistedImageIds: [...sourceDraft.nonPersistedImageIds],
    persistedAttachments: [...sourceDraft.persistedAttachments],
    assistantSelections: normalizeAssistantSelections(sourceDraft.assistantSelections),
    terminalContexts: normalizeTerminalContextsForThread(
      targetThreadId,
      sourceDraft.terminalContexts,
    ),
    fileComments: normalizeFileComments(sourceDraft.fileComments),
    pastedTexts: normalizePastedTexts(sourceDraft.pastedTexts),
    skills: [...sourceDraft.skills],
    mentions: [...sourceDraft.mentions],
    restoredSourceProposedPlan: null,
  };
}

export function clonePromptHistorySavedDraft(
  savedDraft: ComposerPromptHistorySavedDraft | null,
  targetThreadId: ThreadId,
): ComposerPromptHistorySavedDraft | null {
  if (!savedDraft) {
    return null;
  }
  return {
    prompt: savedDraft.prompt,
    images: savedDraft.images.map(cloneComposerImageAttachment),
    files: [...savedDraft.files],
    nonPersistedImageIds: [...savedDraft.nonPersistedImageIds],
    persistedAttachments: [...savedDraft.persistedAttachments],
    assistantSelections: normalizeAssistantSelections(savedDraft.assistantSelections),
    terminalContexts: normalizeTerminalContextsForThread(
      targetThreadId,
      savedDraft.terminalContexts,
    ),
    fileComments: normalizeFileComments(savedDraft.fileComments),
    pastedTexts: normalizePastedTexts(savedDraft.pastedTexts),
    skills: [...savedDraft.skills],
    mentions: [...savedDraft.mentions],
  };
}

export function shouldRemoveDraft(draft: ComposerThreadDraftState): boolean {
  return (
    draft.prompt.length === 0 &&
    draft.promptHistorySavedDraft === null &&
    draft.images.length === 0 &&
    draft.files.length === 0 &&
    draft.persistedAttachments.length === 0 &&
    draft.assistantSelections.length === 0 &&
    draft.terminalContexts.length === 0 &&
    draft.fileComments.length === 0 &&
    draft.pastedTexts.length === 0 &&
    draft.skills.length === 0 &&
    draft.mentions.length === 0 &&
    draft.queuedTurns.length === 0 &&
    draft.restoredSourceProposedPlan == null &&
    Object.keys(draft.modelSelectionByProvider).length === 0 &&
    draft.activeProvider === null &&
    draft.runtimeMode === null &&
    draft.interactionMode === null
  );
}
