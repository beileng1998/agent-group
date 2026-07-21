import type { KanbanCard, KanbanProjectBoard } from "./kanbanTypes";

export function compareKanbanCardsByRecencyDesc(left: KanbanCard, right: KanbanCard): number {
  if (right.sortTimestamp !== left.sortTimestamp) {
    return right.sortTimestamp > left.sortTimestamp ? 1 : -1;
  }
  return right.cardId.localeCompare(left.cardId);
}

/** Applies persisted manual order before newly-created recency-sorted draft cards. */
export function orderDraftCards(
  cards: readonly KanbanCard[],
  manualOrder: readonly string[] | undefined,
): KanbanCard[] {
  const recencySorted = cards.toSorted(compareKanbanCardsByRecencyDesc);
  if (!manualOrder || manualOrder.length === 0) {
    return recencySorted;
  }
  const manualIndexByCardId = new Map<string, number>();
  for (const [index, cardId] of manualOrder.entries()) {
    if (!manualIndexByCardId.has(cardId)) {
      manualIndexByCardId.set(cardId, index);
    }
  }
  return recencySorted.toSorted((left, right) => {
    const leftIndex = manualIndexByCardId.get(left.cardId);
    const rightIndex = manualIndexByCardId.get(right.cardId);
    if (leftIndex !== undefined && rightIndex !== undefined) {
      return leftIndex - rightIndex;
    }
    if (leftIndex !== undefined) return -1;
    if (rightIndex !== undefined) return 1;
    return 0;
  });
}

/** Overview project columns list cards In Progress → Draft → Done. */
export function flattenProjectBoardForOverview(board: KanbanProjectBoard): KanbanCard[] {
  return [...board.inProgress, ...board.draft, ...board.done];
}
