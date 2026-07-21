// FILE: composerDraftPersistenceContentCodec.ts
// Purpose: Encode and decode persisted composer content and queued Turns.
// Layer: Web composer persistence codec

import {
  MessageMentionReference,
  ProviderSkillReference,
  ProviderStartOptions,
  type ThreadId,
} from "@agent-group/contracts";
import * as Schema from "effect/Schema";
import type { DeepMutable } from "effect/Types";
import { normalizeAssistantSelectionAttachment } from "../lib/assistantSelections";
import { normalizeFileCommentSelection } from "../lib/fileComments";
import { normalizePastedTextContent } from "../lib/composerPastedText";
import {
  normalizeComposerImageSource,
  toPersistedComposerImageSource,
} from "../lib/composerImageSource";
import { normalizeTerminalContextText } from "../lib/terminalContext";
import type {
  ComposerImageAttachment,
  PersistedComposerImageAttachment,
  PersistedComposerPromptHistorySavedDraft,
  PersistedComposerThreadDraftState,
  PersistedFileCommentDraft,
  PersistedPastedTextDraft,
  PersistedQueuedTerminalContextDraft,
  PersistedTerminalContextDraft,
} from "./composerDraftContracts";
import { PersistedSourceProposedPlanReference } from "./composerDraftContracts";
import { normalizeModelSelection, normalizeProviderKind } from "./composerDraftModelCodec";

export function normalizePersistedAttachment(
  value: unknown,
): PersistedComposerImageAttachment | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = candidate.id;
  const name = candidate.name;
  const mimeType = candidate.mimeType;
  const sizeBytes = candidate.sizeBytes;
  const dataUrl = candidate.dataUrl;
  const blobKey = candidate.blobKey;
  const source = normalizeComposerImageSource(candidate.source);
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof mimeType !== "string" ||
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    id.length === 0 ||
    !(
      (typeof dataUrl === "string" && dataUrl.length > 0) ||
      (typeof blobKey === "string" && blobKey.length > 0)
    )
  ) {
    return null;
  }
  return {
    id,
    name,
    mimeType,
    sizeBytes,
    ...(typeof dataUrl === "string" && dataUrl.length > 0 ? { dataUrl } : {}),
    ...(typeof blobKey === "string" && blobKey.length > 0 ? { blobKey } : {}),
    ...(source ? { source } : {}),
  };
}

export function toStorageSafePersistedAttachment(
  attachment: PersistedComposerImageAttachment,
): PersistedComposerImageAttachment {
  const { source: _source, ...attachmentWithoutSource } = attachment;
  const source = toPersistedComposerImageSource(attachment.source);
  return {
    ...attachmentWithoutSource,
    ...(source ? { source } : {}),
  };
}

export function normalizePersistedPromptHistorySavedDraft(
  value: unknown,
): DeepMutable<PersistedComposerPromptHistorySavedDraft> | null {
  if (typeof value === "string") {
    return { prompt: value, attachments: [] };
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const prompt = typeof candidate.prompt === "string" ? candidate.prompt : null;
  if (prompt === null) {
    return null;
  }
  const attachments = Array.isArray(candidate.attachments)
    ? candidate.attachments.flatMap((entry) => {
        const normalized = normalizePersistedAttachment(entry);
        return normalized ? [normalized] : [];
      })
    : [];
  const assistantSelections = Array.isArray(candidate.assistantSelections)
    ? candidate.assistantSelections.flatMap((entry) => {
        const normalized = normalizePersistedAssistantSelection(entry);
        return normalized ? [normalized] : [];
      })
    : [];
  const terminalContexts = Array.isArray(candidate.terminalContexts)
    ? candidate.terminalContexts.flatMap((entry) => {
        const normalized = normalizePersistedTerminalContextDraft(entry);
        return normalized ? [normalized] : [];
      })
    : [];
  const fileComments = Array.isArray(candidate.fileComments)
    ? candidate.fileComments.flatMap((entry) => {
        const normalized = normalizePersistedFileCommentDraft(entry);
        return normalized ? [normalized] : [];
      })
    : [];
  const pastedTexts = Array.isArray(candidate.pastedTexts)
    ? candidate.pastedTexts.flatMap((entry) => {
        const normalized = normalizePersistedPastedTextDraft(entry);
        return normalized ? [normalized] : [];
      })
    : [];
  const skills = Array.isArray(candidate.skills)
    ? candidate.skills.filter(Schema.is(ProviderSkillReference))
    : [];
  const mentions = Array.isArray(candidate.mentions)
    ? candidate.mentions.filter(Schema.is(MessageMentionReference))
    : [];
  return {
    prompt,
    attachments,
    ...(assistantSelections.length > 0 ? { assistantSelections } : {}),
    ...(terminalContexts.length > 0 ? { terminalContexts } : {}),
    ...(fileComments.length > 0 ? { fileComments } : {}),
    ...(pastedTexts.length > 0 ? { pastedTexts } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(mentions.length > 0 ? { mentions } : {}),
  };
}

export function normalizePersistedTerminalContextDraft(
  value: unknown,
): PersistedTerminalContextDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = candidate.id;
  const threadId = candidate.threadId;
  const createdAt = candidate.createdAt;
  const lineStart = candidate.lineStart;
  const lineEnd = candidate.lineEnd;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof threadId !== "string" ||
    threadId.length === 0 ||
    typeof createdAt !== "string" ||
    createdAt.length === 0 ||
    typeof lineStart !== "number" ||
    !Number.isFinite(lineStart) ||
    typeof lineEnd !== "number" ||
    !Number.isFinite(lineEnd)
  ) {
    return null;
  }
  const terminalId = typeof candidate.terminalId === "string" ? candidate.terminalId.trim() : "";
  const terminalLabel =
    typeof candidate.terminalLabel === "string" ? candidate.terminalLabel.trim() : "";
  if (terminalId.length === 0 || terminalLabel.length === 0) {
    return null;
  }
  const normalizedLineStart = Math.max(1, Math.floor(lineStart));
  const normalizedLineEnd = Math.max(normalizedLineStart, Math.floor(lineEnd));
  return {
    id,
    threadId: threadId as ThreadId,
    createdAt,
    terminalId,
    terminalLabel,
    lineStart: normalizedLineStart,
    lineEnd: normalizedLineEnd,
  };
}

export function normalizePersistedQueuedTerminalContextDraft(
  value: unknown,
): PersistedQueuedTerminalContextDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const base = normalizePersistedTerminalContextDraft(candidate);
  if (!base) {
    return null;
  }
  const text =
    typeof candidate.text === "string" ? normalizeTerminalContextText(candidate.text) : "";
  return {
    ...base,
    text,
  };
}

export function normalizePersistedAssistantSelection(
  value: unknown,
): { id: string; assistantMessageId: string; text: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id : "";
  const assistantMessageId =
    typeof candidate.assistantMessageId === "string" ? candidate.assistantMessageId : "";
  const text = typeof candidate.text === "string" ? candidate.text : "";
  if (id.length === 0) {
    return null;
  }
  const normalized = normalizeAssistantSelectionAttachment({ assistantMessageId, text });
  if (!normalized) {
    return null;
  }
  return { id, assistantMessageId: normalized.assistantMessageId, text: normalized.text };
}

export function normalizePersistedFileCommentDraft(
  value: unknown,
): PersistedFileCommentDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id : "";
  if (id.length === 0) {
    return null;
  }
  const path = typeof candidate.path === "string" ? candidate.path : "";
  const text = typeof candidate.text === "string" ? candidate.text : "";
  const startLine = typeof candidate.startLine === "number" ? candidate.startLine : Number.NaN;
  const endLine = typeof candidate.endLine === "number" ? candidate.endLine : Number.NaN;
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
    return null;
  }
  const normalized = normalizeFileCommentSelection({ path, startLine, endLine, text });
  if (!normalized) {
    return null;
  }
  return { id, ...normalized };
}

export function normalizePersistedPastedTextDraft(value: unknown): PersistedPastedTextDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id : "";
  const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : "";
  const text = typeof candidate.text === "string" ? normalizePastedTextContent(candidate.text) : "";
  if (id.length === 0 || text.length === 0) {
    return null;
  }
  return { id, createdAt, text };
}

export function persistImageAttachmentFromDataUrl(input: {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}): PersistedComposerImageAttachment | null {
  return normalizePersistedAttachment(input);
}

export function persistQueuedComposerImages(
  images: ReadonlyArray<ComposerImageAttachment>,
): PersistedComposerImageAttachment[] {
  return images.flatMap((image) => {
    if (!image.previewUrl.startsWith("data:")) {
      return [];
    }
    const normalized = persistImageAttachmentFromDataUrl({
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      dataUrl: image.previewUrl,
    });
    return normalized ? [normalized] : [];
  });
}

export function normalizePersistedQueuedTurns(
  rawQueuedTurns: unknown,
): DeepMutable<NonNullable<PersistedComposerThreadDraftState["queuedTurns"]>> | undefined {
  if (!Array.isArray(rawQueuedTurns)) {
    return undefined;
  }
  const normalizedTurns: DeepMutable<
    NonNullable<PersistedComposerThreadDraftState["queuedTurns"]>
  > = [];
  const seenIds = new Set<string>();
  for (const entry of rawQueuedTurns) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : "";
    const kind = candidate.kind;
    const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : "";
    const previewText = typeof candidate.previewText === "string" ? candidate.previewText : "";
    const selectedProvider = normalizeProviderKind(candidate.selectedProvider);
    const selectedModel =
      candidate.selectedModel === null
        ? null
        : typeof candidate.selectedModel === "string"
          ? candidate.selectedModel
          : null;
    const selectedPromptEffort =
      candidate.selectedPromptEffort === null
        ? null
        : typeof candidate.selectedPromptEffort === "string"
          ? candidate.selectedPromptEffort
          : null;
    const modelSelection = normalizeModelSelection(candidate.modelSelection);
    const providerOptionsForDispatch = Schema.is(ProviderStartOptions)(
      candidate.providerOptionsForDispatch,
    )
      ? candidate.providerOptionsForDispatch
      : undefined;
    const sourceProposedPlan = Schema.is(PersistedSourceProposedPlanReference)(
      candidate.sourceProposedPlan,
    )
      ? candidate.sourceProposedPlan
      : undefined;
    const runtimeMode =
      candidate.runtimeMode === "approval-required" || candidate.runtimeMode === "full-access"
        ? candidate.runtimeMode
        : null;
    if (
      id.length === 0 ||
      createdAt.length === 0 ||
      previewText.length === 0 ||
      selectedProvider === null ||
      modelSelection === null ||
      runtimeMode === null ||
      seenIds.has(id)
    ) {
      continue;
    }
    if (kind === "chat") {
      const prompt = typeof candidate.prompt === "string" ? candidate.prompt : "";
      const images = Array.isArray(candidate.images)
        ? candidate.images.flatMap((image) => {
            const normalized = normalizePersistedAttachment(image);
            return normalized ? [normalized] : [];
          })
        : [];
      const terminalContexts = Array.isArray(candidate.terminalContexts)
        ? candidate.terminalContexts.flatMap((context) => {
            const normalized = normalizePersistedQueuedTerminalContextDraft(context);
            return normalized ? [normalized] : [];
          })
        : [];
      const assistantSelections = Array.isArray(candidate.assistantSelections)
        ? candidate.assistantSelections.flatMap((selection) => {
            const normalized = normalizePersistedAssistantSelection(selection);
            return normalized ? [normalized] : [];
          })
        : [];
      const fileComments = Array.isArray(candidate.fileComments)
        ? candidate.fileComments.flatMap((comment) => {
            const normalized = normalizePersistedFileCommentDraft(comment);
            return normalized ? [normalized] : [];
          })
        : [];
      const pastedTexts = Array.isArray(candidate.pastedTexts)
        ? candidate.pastedTexts.flatMap((pasted) => {
            const normalized = normalizePersistedPastedTextDraft(pasted);
            return normalized ? [normalized] : [];
          })
        : [];
      const skills = Array.isArray(candidate.skills)
        ? candidate.skills.filter(Schema.is(ProviderSkillReference))
        : [];
      const mentions = Array.isArray(candidate.mentions)
        ? candidate.mentions.filter(Schema.is(MessageMentionReference))
        : [];
      const interactionMode =
        candidate.interactionMode === "default" || candidate.interactionMode === "plan"
          ? candidate.interactionMode
          : null;
      const envMode =
        candidate.envMode === "local" || candidate.envMode === "worktree"
          ? candidate.envMode
          : null;
      if (interactionMode === null || envMode === null) {
        continue;
      }
      normalizedTurns.push({
        id,
        kind: "chat",
        createdAt,
        previewText,
        prompt,
        images,
        ...(assistantSelections.length > 0 ? { assistantSelections } : {}),
        terminalContexts,
        ...(fileComments.length > 0 ? { fileComments } : {}),
        ...(pastedTexts.length > 0 ? { pastedTexts } : {}),
        skills: [...skills],
        mentions: [...mentions],
        selectedProvider,
        selectedModel,
        selectedPromptEffort,
        modelSelection,
        ...(providerOptionsForDispatch ? { providerOptionsForDispatch } : {}),
        ...(sourceProposedPlan ? { sourceProposedPlan } : {}),
        runtimeMode,
        interactionMode,
        envMode,
      });
      seenIds.add(id);
      continue;
    }
    if (kind === "plan-follow-up") {
      const text = typeof candidate.text === "string" ? candidate.text : "";
      const interactionMode =
        candidate.interactionMode === "default" || candidate.interactionMode === "plan"
          ? candidate.interactionMode
          : null;
      if (interactionMode === null) {
        continue;
      }
      normalizedTurns.push({
        id,
        kind: "plan-follow-up",
        createdAt,
        previewText,
        text,
        interactionMode,
        selectedProvider,
        selectedModel,
        selectedPromptEffort,
        modelSelection,
        ...(providerOptionsForDispatch ? { providerOptionsForDispatch } : {}),
        runtimeMode,
      });
      seenIds.add(id);
    }
  }
  return normalizedTurns.length > 0 ? normalizedTurns : undefined;
}
