import { isPendingThreadWorktree } from "@agent-group/shared/threadEnvironment";
import type { KanbanCard } from "./kanbanTypes";

/** Reorders the visible draft column after a drag; returns null when nothing moved. */
export function reorderDraftCardIds(
  visibleCardIds: readonly string[],
  activeCardId: string,
  overCardId: string,
): string[] | null {
  const fromIndex = visibleCardIds.indexOf(activeCardId);
  const toIndex = visibleCardIds.indexOf(overCardId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return null;
  }
  const next = [...visibleCardIds];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) {
    return null;
  }
  next.splice(toIndex, 0, moved);
  return next;
}

export type KanbanDraftOpenThreadReason = "not-draft" | "empty" | "worktree-pending";
export type KanbanDraftDropAction = "dispatch" | "open-thread";

/** Explains why a draft card must fall back to the canonical chat composer flow. */
export function resolveKanbanDraftOpenThreadReason(
  card: KanbanCard,
): KanbanDraftOpenThreadReason | null {
  if (card.column !== "draft") {
    return "not-draft";
  }
  if (card.draftPrompt.length === 0 && !card.draftHasAttachments) {
    return "empty";
  }
  if (isPendingThreadWorktree({ envMode: card.envMode, worktreePath: card.worktreePath })) {
    return "worktree-pending";
  }
  return null;
}

export function resolveDraftDropAction(card: KanbanCard): KanbanDraftDropAction {
  return resolveKanbanDraftOpenThreadReason(card) ? "open-thread" : "dispatch";
}
