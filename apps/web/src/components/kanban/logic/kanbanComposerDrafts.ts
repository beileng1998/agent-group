import type { ComposerThreadDraftState } from "../../../composerDraftStore";
import type { KanbanComposerDraftSnapshot } from "./kanbanTypes";

type KanbanComposerDraftSource = Pick<
  ComposerThreadDraftState,
  | "prompt"
  | "files"
  | "images"
  | "persistedAttachments"
  | "terminalContexts"
  | "assistantSelections"
  | "fileComments"
  | "activeProvider"
>;

/** Shared projection so board building and drop-time dispatch checks agree. */
export function buildKanbanComposerDraftSnapshot(
  draft: KanbanComposerDraftSource | null | undefined,
): KanbanComposerDraftSnapshot | null {
  if (!draft) {
    return null;
  }
  return {
    prompt: draft.prompt,
    hasAttachments:
      draft.images.length > 0 ||
      draft.files.length > 0 ||
      draft.persistedAttachments.length > 0 ||
      draft.terminalContexts.some((context) => context.text.trim().length > 0) ||
      draft.assistantSelections.length > 0 ||
      draft.fileComments.length > 0,
    provider: draft.activeProvider,
  };
}

/** Equality for the stable composer-draft projection consumed by the board. */
export function areKanbanComposerDraftSnapshotsEqual(
  left: Readonly<Record<string, KanbanComposerDraftSnapshot>>,
  right: Readonly<Record<string, KanbanComposerDraftSnapshot>>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }
  for (const key of leftKeys) {
    const leftSnapshot = left[key];
    const rightSnapshot = right[key];
    if (
      !leftSnapshot ||
      !rightSnapshot ||
      leftSnapshot.prompt !== rightSnapshot.prompt ||
      leftSnapshot.hasAttachments !== rightSnapshot.hasAttachments ||
      leftSnapshot.provider !== rightSnapshot.provider
    ) {
      return false;
    }
  }
  return true;
}
