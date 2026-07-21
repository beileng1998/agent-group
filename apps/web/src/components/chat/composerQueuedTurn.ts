// FILE: composerQueuedTurn.ts
// Purpose: Materialize a live composer snapshot into a durable queued chat turn.
// Layer: Web composer queue

import type { QueuedComposerChatTurn } from "../../composerDraftStore";
import { readFileAsDataUrl } from "../../lib/composerSend";
import { randomUUID } from "../../lib/utils";
import { buildQueuedComposerPreviewText } from "./chatViewComposerValues";

type QueuedComposerChatTurnInput = Omit<
  QueuedComposerChatTurn,
  "id" | "kind" | "createdAt" | "previewText" | "images"
> & {
  images: QueuedComposerChatTurn["images"];
  previewTrimmedPrompt: string;
};

export async function buildQueuedComposerChatTurn(
  input: QueuedComposerChatTurnInput,
): Promise<QueuedComposerChatTurn> {
  const { images, previewTrimmedPrompt, ...snapshot } = input;
  const persistedImages = await Promise.all(
    images.map(async (image) => {
      try {
        return { ...image, previewUrl: await readFileAsDataUrl(image.file) };
      } catch {
        return image;
      }
    }),
  );

  return {
    ...snapshot,
    id: randomUUID(),
    kind: "chat",
    createdAt: new Date().toISOString(),
    previewText: buildQueuedComposerPreviewText({
      trimmedPrompt: previewTrimmedPrompt,
      images: persistedImages,
      files: snapshot.files,
      assistantSelections: snapshot.assistantSelections,
      terminalContexts: snapshot.terminalContexts,
      fileComments: snapshot.fileComments,
      pastedTexts: snapshot.pastedTexts,
    }),
    images: persistedImages,
  };
}
