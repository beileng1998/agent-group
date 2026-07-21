import type { ThreadId } from "@agent-group/contracts";

import type {
  ComposerImageAttachment,
  PersistedComposerImageAttachment,
} from "../../composerDraftStore";
import { composerImageBlobKey, persistComposerImageBlob } from "../../lib/composerImageBlobStore";
import { readFileAsDataUrl } from "../../lib/composerSend";
import { revokeBlobPreviewUrl } from "../ChatView.logic";

export const ATTACHMENT_PREVIEW_HANDOFF_TTL_MS = 5000;

export function revokeBlobPreviewUrlsAfterPaint(previewUrls: readonly string[]): void {
  if (previewUrls.length === 0 || typeof window === "undefined") {
    return;
  }
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }, 0);
  });
}

// Shared by the live-composer and prompt-history attachment sync effects:
// AppSnap images persist their bytes as IndexedDB blobs (reusing an existing
// blob key when valid), everything else inlines a data URL. Falls back to the
// already-persisted attachments for images whose serialization fails.
export async function stagePersistedComposerImageAttachments(input: {
  threadId: ThreadId;
  images: ReadonlyArray<ComposerImageAttachment>;
  getPersistedAttachments: () => PersistedComposerImageAttachment[];
}): Promise<PersistedComposerImageAttachment[]> {
  try {
    const existingPersistedById = new Map(
      input.getPersistedAttachments().map((attachment) => [attachment.id, attachment]),
    );
    const stagedAttachmentById = new Map<string, PersistedComposerImageAttachment>();
    await Promise.all(
      input.images.map(async (image) => {
        try {
          if (image.source?.kind === "appsnap") {
            const existingPersisted = existingPersistedById.get(image.id);
            const expectedBlobKey = composerImageBlobKey(input.threadId, image.id);
            const blobKey =
              existingPersisted?.blobKey === expectedBlobKey
                ? expectedBlobKey
                : await persistComposerImageBlob({
                    threadId: input.threadId,
                    imageId: image.id,
                    file: image.file,
                  });
            stagedAttachmentById.set(image.id, {
              id: image.id,
              name: image.name,
              mimeType: image.mimeType,
              sizeBytes: image.sizeBytes,
              blobKey,
              source: image.source,
            });
            return;
          }
          const dataUrl = await readFileAsDataUrl(image.file);
          stagedAttachmentById.set(image.id, {
            id: image.id,
            name: image.name,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            dataUrl,
          });
        } catch {
          const existingPersisted = existingPersistedById.get(image.id);
          if (existingPersisted) {
            stagedAttachmentById.set(image.id, existingPersisted);
          }
        }
      }),
    );
    return Array.from(stagedAttachmentById.values());
  } catch {
    const currentImageIds = new Set(input.images.map((image) => image.id));
    return input
      .getPersistedAttachments()
      .filter((attachment) => currentImageIds.has(attachment.id));
  }
}
