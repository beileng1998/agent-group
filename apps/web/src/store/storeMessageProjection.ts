// FILE: storeMessageProjection.ts
// Purpose: Normalize transcript messages and merge live assistant output into read-model snapshots.
// Layer: Web state message projection

import { MessageId } from "@agent-group/contracts";
import { toAttachmentPreviewUrl } from "../lib/wsHttpUrl";
import type { ChatAttachment, ChatMessage, Thread } from "../types";
import { arraysShallowEqual, providerReferenceArraysEqual } from "./storeEquality";
import { MAX_THREAD_MESSAGES, type ReadModelMessage, type ReadModelThread } from "./storeState";

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}

function normalizeChatAttachments(
  incoming: ReadModelMessage["attachments"],
  previous: ChatAttachment[] | undefined,
): ChatAttachment[] | undefined {
  if (!incoming || incoming.length === 0) return undefined;
  const previousById = new Map(previous?.map((attachment) => [attachment.id, attachment] as const));
  const nextAttachments = incoming.map((attachment) => {
    const nextAttachment: ChatAttachment =
      attachment.type === "assistant-selection"
        ? {
            type: "assistant-selection",
            id: attachment.id,
            assistantMessageId: attachment.assistantMessageId,
            text: attachment.text,
          }
        : attachment.type === "file"
          ? {
              type: "file",
              id: attachment.id,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
            }
          : {
              type: "image",
              id: attachment.id,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
            };
    const existing = previousById.get(attachment.id);
    if (
      existing &&
      ((existing.type === "assistant-selection" &&
        nextAttachment.type === "assistant-selection" &&
        existing.assistantMessageId === nextAttachment.assistantMessageId &&
        existing.text === nextAttachment.text) ||
        (existing.type === "image" &&
          nextAttachment.type === "image" &&
          existing.name === nextAttachment.name &&
          existing.mimeType === nextAttachment.mimeType &&
          existing.sizeBytes === nextAttachment.sizeBytes &&
          existing.previewUrl === nextAttachment.previewUrl) ||
        (existing.type === "file" &&
          nextAttachment.type === "file" &&
          existing.name === nextAttachment.name &&
          existing.mimeType === nextAttachment.mimeType &&
          existing.sizeBytes === nextAttachment.sizeBytes))
    ) {
      return existing;
    }
    return nextAttachment;
  });
  return arraysShallowEqual(previous, nextAttachments) ? previous : nextAttachments;
}

export function normalizeChatMessage(
  incoming: ReadModelMessage,
  previous: ChatMessage | undefined,
): ChatMessage {
  const attachments = normalizeChatAttachments(incoming.attachments, previous?.attachments);
  const skills =
    incoming.skills && incoming.skills.length > 0 ? incoming.skills : (previous?.skills ?? []);
  const mentions =
    incoming.mentions && incoming.mentions.length > 0
      ? incoming.mentions
      : (previous?.mentions ?? []);
  const previousSkills = previous?.skills ?? [];
  const previousMentions = previous?.mentions ?? [];
  const completedAt = incoming.streaming ? undefined : incoming.updatedAt;
  if (
    previous &&
    previous.role === incoming.role &&
    previous.text === incoming.text &&
    previous.dispatchMode === incoming.dispatchMode &&
    previous.dispatchOrigin === incoming.dispatchOrigin &&
    previous.turnId === incoming.turnId &&
    previous.createdAt === incoming.createdAt &&
    previous.streaming === incoming.streaming &&
    previous.source === incoming.source &&
    previous.completedAt === completedAt &&
    previous.attachments === attachments &&
    providerReferenceArraysEqual(previousSkills, skills) &&
    providerReferenceArraysEqual(previousMentions, mentions)
  ) {
    return previous;
  }
  return {
    id: incoming.id,
    role: incoming.role,
    text: incoming.text,
    ...(incoming.dispatchMode ? { dispatchMode: incoming.dispatchMode } : {}),
    ...(incoming.dispatchOrigin ? { dispatchOrigin: incoming.dispatchOrigin } : {}),
    turnId: incoming.turnId,
    createdAt: incoming.createdAt,
    streaming: incoming.streaming,
    source: incoming.source,
    ...(completedAt ? { completedAt } : {}),
    ...(attachments ? { attachments } : {}),
    ...(skills.length > 0 ? { skills: [...skills] } : {}),
    ...(mentions.length > 0 ? { mentions: [...mentions] } : {}),
  };
}

export function normalizeChatMessages(
  incoming: ReadModelThread["messages"],
  previous: ChatMessage[] | undefined,
): ChatMessage[] {
  const previousById = new Map(previous?.map((message) => [message.id, message] as const));
  const nextMessages = incoming
    .slice(-MAX_THREAD_MESSAGES)
    .map((message) => normalizeChatMessage(message, previousById.get(message.id)));
  return arraysShallowEqual(previous, nextMessages) ? previous : nextMessages;
}

function readModelAttachmentsFromChatMessage(
  attachments: ChatMessage["attachments"],
): ReadModelThread["messages"][number]["attachments"] {
  return (
    attachments?.map((attachment) =>
      attachment.type === "assistant-selection"
        ? {
            id: attachment.id,
            type: "assistant-selection" as const,
            assistantMessageId: MessageId.makeUnsafe(attachment.assistantMessageId),
            text: attachment.text,
          }
        : attachment.type === "file"
          ? {
              id: attachment.id,
              name: attachment.name,
              type: "file" as const,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
            }
          : {
              id: attachment.id,
              name: attachment.name,
              type: "image" as const,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
            },
    ) ?? []
  );
}

function readModelMessageFromChatMessage(
  message: ChatMessage,
): ReadModelThread["messages"][number] {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    ...(message.dispatchMode ? { dispatchMode: message.dispatchMode } : {}),
    ...(message.dispatchOrigin ? { dispatchOrigin: message.dispatchOrigin } : {}),
    turnId: message.turnId ?? null,
    streaming: message.streaming,
    source: message.source ?? "native",
    createdAt: message.createdAt,
    updatedAt: message.completedAt ?? message.createdAt,
    attachments: readModelAttachmentsFromChatMessage(message.attachments),
    ...(message.skills && message.skills.length > 0 ? { skills: message.skills } : {}),
    ...(message.mentions && message.mentions.length > 0 ? { mentions: message.mentions } : {}),
  };
}

function shouldRetainLiveAssistantMessageForHotPath(
  previousThread: Thread,
  message: ChatMessage,
): boolean {
  if (message.role !== "assistant") return false;
  if (message.streaming) return true;
  const latestTurn = previousThread.latestTurn;
  if (!latestTurn) return false;
  if (latestTurn.assistantMessageId === message.id) return true;
  return (
    previousThread.session?.orchestrationStatus === "running" &&
    message.turnId !== undefined &&
    latestTurn.turnId === message.turnId
  );
}

export function mergeReadModelMessagesWithLiveHotPath(
  incomingMessages: ReadModelThread["messages"],
  previousThread: Thread | undefined,
): ReadModelThread["messages"] {
  if (!previousThread || previousThread.messages.length === 0) return incomingMessages;
  const previousMessageById = new Map(
    previousThread.messages.map((message) => [message.id, message] as const),
  );
  const mergedById = new Map<MessageId, ReadModelThread["messages"][number]>();
  let changed = false;
  for (const incomingMessage of incomingMessages) {
    const previousMessage = previousMessageById.get(incomingMessage.id);
    if (!previousMessage || previousMessage.role !== incomingMessage.role) {
      mergedById.set(incomingMessage.id, incomingMessage);
      continue;
    }
    const incomingCompletedAt = incomingMessage.streaming ? undefined : incomingMessage.updatedAt;
    const shouldPreferLiveMessage =
      previousMessage.text.length > incomingMessage.text.length ||
      (!previousMessage.streaming && incomingMessage.streaming) ||
      (previousMessage.completedAt !== undefined &&
        (incomingCompletedAt === undefined || previousMessage.completedAt > incomingCompletedAt));
    if (!shouldPreferLiveMessage) {
      mergedById.set(incomingMessage.id, {
        ...incomingMessage,
        ...(!incomingMessage.mentions || incomingMessage.mentions.length === 0
          ? previousMessage.mentions && previousMessage.mentions.length > 0
            ? { mentions: previousMessage.mentions }
            : {}
          : {}),
        ...(!incomingMessage.skills || incomingMessage.skills.length === 0
          ? previousMessage.skills && previousMessage.skills.length > 0
            ? { skills: previousMessage.skills }
            : {}
          : {}),
      });
      continue;
    }
    changed = true;
    mergedById.set(incomingMessage.id, {
      ...incomingMessage,
      text: previousMessage.text,
      dispatchMode: previousMessage.dispatchMode ?? incomingMessage.dispatchMode,
      dispatchOrigin: previousMessage.dispatchOrigin ?? incomingMessage.dispatchOrigin,
      turnId: previousMessage.turnId ?? incomingMessage.turnId ?? null,
      source: previousMessage.source ?? incomingMessage.source ?? "native",
      streaming: previousMessage.streaming,
      updatedAt: previousMessage.completedAt ?? incomingMessage.updatedAt,
      attachments: readModelAttachmentsFromChatMessage(previousMessage.attachments),
      ...(previousMessage.skills && previousMessage.skills.length > 0
        ? { skills: previousMessage.skills }
        : {}),
      ...(previousMessage.mentions && previousMessage.mentions.length > 0
        ? { mentions: previousMessage.mentions }
        : {}),
    });
  }
  for (const previousMessage of previousThread.messages) {
    if (mergedById.has(previousMessage.id)) continue;
    if (!shouldRetainLiveAssistantMessageForHotPath(previousThread, previousMessage)) continue;
    changed = true;
    mergedById.set(previousMessage.id, readModelMessageFromChatMessage(previousMessage));
  }
  if (!changed) return incomingMessages;
  return [...mergedById.values()].toSorted((left, right) =>
    left.createdAt === right.createdAt
      ? String(left.id).localeCompare(String(right.id))
      : left.createdAt.localeCompare(right.createdAt),
  );
}
