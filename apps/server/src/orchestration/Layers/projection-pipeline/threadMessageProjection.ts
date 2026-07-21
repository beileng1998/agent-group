import { Effect, Option } from "effect";

import { ProjectionThreadMessageRepository } from "../../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionTurnRepository } from "../../../persistence/Services/ProjectionTurns.ts";
import { resolveStableMessageTurnId } from "../../messageTurnId.ts";
import {
  collectThreadAttachmentRelativePaths,
  materializeAttachmentsForProjection,
} from "./attachmentSideEffects.ts";
import type { ProjectorDefinition } from "./projectorDefinitions.ts";
import {
  retainProjectionMessagesAfterRevert,
  rollbackProjectionMessagesFromMessage,
} from "./rollbackRetention.ts";

export const makeThreadMessageProjection = Effect.gen(function* () {
  const messageRepository = yield* ProjectionThreadMessageRepository;
  const turnRepository = yield* ProjectionTurnRepository;

  const apply: ProjectorDefinition["apply"] = (event, attachmentSideEffects) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.message-sent": {
          const existingMessage = yield* messageRepository.getByMessageId({
            messageId: event.payload.messageId,
          });
          const nextText =
            Option.isSome(existingMessage) && event.payload.streaming
              ? `${existingMessage.value.text}${event.payload.text}`
              : Option.isSome(existingMessage) && event.payload.text.length === 0
                ? existingMessage.value.text
                : event.payload.text;
          const nextAttachments =
            event.payload.attachments !== undefined
              ? yield* materializeAttachmentsForProjection({
                  attachments: event.payload.attachments,
                })
              : Option.isSome(existingMessage)
                ? existingMessage.value.attachments
                : undefined;
          yield* messageRepository.upsert({
            messageId: event.payload.messageId,
            threadId: event.payload.threadId,
            turnId: resolveStableMessageTurnId({
              existingTurnId: Option.isSome(existingMessage) ? existingMessage.value.turnId : null,
              incomingTurnId: event.payload.turnId,
            }),
            role: event.payload.role,
            text: nextText,
            ...(nextAttachments !== undefined ? { attachments: [...nextAttachments] } : {}),
            ...(event.payload.skills !== undefined ? { skills: event.payload.skills } : {}),
            ...(event.payload.mentions !== undefined ? { mentions: event.payload.mentions } : {}),
            ...(event.payload.dispatchMode !== undefined
              ? { dispatchMode: event.payload.dispatchMode }
              : {}),
            ...(event.payload.dispatchOrigin !== undefined
              ? { dispatchOrigin: event.payload.dispatchOrigin }
              : {}),
            isStreaming: event.payload.streaming,
            source: event.payload.source,
            createdAt:
              (Option.isSome(existingMessage) ? existingMessage.value.createdAt : null) ??
              event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }
        case "thread.reverted": {
          const existingRows = yield* messageRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) return;
          const existingTurns = yield* turnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionMessagesAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) return;
          yield* messageRepository.deleteByThreadId({ threadId: event.payload.threadId });
          yield* Effect.forEach(keptRows, messageRepository.upsert, { concurrency: 1 }).pipe(
            Effect.asVoid,
          );
          attachmentSideEffects.prunedThreadRelativePaths.set(
            event.payload.threadId,
            collectThreadAttachmentRelativePaths(event.payload.threadId, keptRows),
          );
          return;
        }
        case "thread.conversation-rolled-back": {
          if (event.payload.numTurns === 0) return;
          const existingRows = yield* messageRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const rollback = rollbackProjectionMessagesFromMessage(
            existingRows,
            event.payload.messageId,
          );
          if (!rollback.changed) return;
          yield* messageRepository.deleteByThreadId({ threadId: event.payload.threadId });
          yield* Effect.forEach(rollback.keptRows, messageRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          if (event.payload.skipAttachmentPrune !== true) {
            attachmentSideEffects.prunedThreadRelativePaths.set(
              event.payload.threadId,
              collectThreadAttachmentRelativePaths(event.payload.threadId, rollback.keptRows),
            );
          }
          return;
        }
        default:
          return;
      }
    });
  return apply;
});
