import type { ChatAttachment } from "@agent-group/contracts";
import { Effect, FileSystem, Path } from "effect";

import {
  attachmentRelativePath,
  parseAttachmentIdFromRelativePath,
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../../../attachmentStore.ts";
import { ServerConfig } from "../../../config.ts";
import type { ProjectionThreadMessage } from "../../../persistence/Services/ProjectionThreadMessages.ts";
import type { AttachmentSideEffects } from "./projectorDefinitions.ts";

export const materializeAttachmentsForProjection = Effect.fn(
  (input: { readonly attachments: ReadonlyArray<ChatAttachment> }) =>
    Effect.succeed(input.attachments.length === 0 ? [] : input.attachments),
);

export function collectThreadAttachmentRelativePaths(
  threadId: string,
  messages: ReadonlyArray<ProjectionThreadMessage>,
): Set<string> {
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  if (!threadSegment) return new Set();
  const relativePaths = new Set<string>();
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.type !== "image" && attachment.type !== "file") continue;
      const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachment.id);
      if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) continue;
      relativePaths.add(attachmentRelativePath(attachment));
    }
  }
  return relativePaths;
}

export const runAttachmentSideEffects = Effect.fn(function* (sideEffects: AttachmentSideEffects) {
  const serverConfig = yield* Effect.service(ServerConfig);
  const fileSystem = yield* Effect.service(FileSystem.FileSystem);
  const path = yield* Effect.service(Path.Path);
  const attachmentsRootDir = serverConfig.attachmentsDir;
  const attachmentRootEntries = yield* fileSystem
    .readDirectory(attachmentsRootDir, { recursive: false })
    .pipe(Effect.catch(() => Effect.succeed([] as Array<string>)));

  const removeDeletedThreadAttachmentEntry = Effect.fn(function* (
    threadSegment: string,
    entry: string,
  ) {
    const normalizedEntry = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    if (normalizedEntry.length === 0 || normalizedEntry.includes("/")) return;
    const attachmentId = parseAttachmentIdFromRelativePath(normalizedEntry);
    if (!attachmentId) return;
    const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
    if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) return;
    yield* fileSystem.remove(path.join(attachmentsRootDir, normalizedEntry), { force: true });
  });

  const deleteThreadAttachments = Effect.fn(function* (threadId: string) {
    const threadSegment = toSafeThreadAttachmentSegment(threadId);
    if (!threadSegment) {
      yield* Effect.logWarning("skipping attachment cleanup for unsafe thread id", { threadId });
      return;
    }
    yield* Effect.forEach(
      attachmentRootEntries,
      (entry) => removeDeletedThreadAttachmentEntry(threadSegment, entry),
      { concurrency: 1 },
    );
  });

  const pruneThreadAttachmentEntry = Effect.fn(function* (
    threadSegment: string,
    keptThreadRelativePaths: Set<string>,
    entry: string,
  ) {
    const relativePath = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    if (relativePath.length === 0 || relativePath.includes("/")) return;
    const attachmentId = parseAttachmentIdFromRelativePath(relativePath);
    if (!attachmentId) return;
    const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
    if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) return;
    const absolutePath = path.join(attachmentsRootDir, relativePath);
    const fileInfo = yield* fileSystem
      .stat(absolutePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") return;
    if (!keptThreadRelativePaths.has(relativePath)) {
      yield* fileSystem.remove(absolutePath, { force: true });
    }
  });

  yield* Effect.forEach(sideEffects.deletedThreadIds, deleteThreadAttachments, {
    concurrency: 1,
  });
  yield* Effect.forEach(
    sideEffects.prunedThreadRelativePaths.entries(),
    ([threadId, keptThreadRelativePaths]) => {
      if (sideEffects.deletedThreadIds.has(threadId)) return Effect.void;
      return Effect.gen(function* () {
        const threadSegment = toSafeThreadAttachmentSegment(threadId);
        if (!threadSegment) {
          yield* Effect.logWarning("skipping attachment prune for unsafe thread id", { threadId });
          return;
        }
        yield* Effect.forEach(
          attachmentRootEntries,
          (entry) => pruneThreadAttachmentEntry(threadSegment, keptThreadRelativePaths, entry),
          { concurrency: 1 },
        );
      });
    },
    { concurrency: 1 },
  );
});
