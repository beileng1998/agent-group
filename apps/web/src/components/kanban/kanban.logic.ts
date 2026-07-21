// Compatibility facade for the kanban board's pure domain model.

export {
  areKanbanComposerDraftSnapshotsEqual,
  buildKanbanComposerDraftSnapshot,
} from "./logic/kanbanComposerDrafts";
export { buildKanbanBoard } from "./logic/kanbanBoard";
export {
  reorderDraftCardIds,
  resolveDraftDropAction,
  resolveKanbanDraftOpenThreadReason,
  type KanbanDraftDropAction,
  type KanbanDraftOpenThreadReason,
} from "./logic/kanbanMutations";
export { flattenProjectBoardForOverview, orderDraftCards } from "./logic/kanbanOrdering";
export {
  deriveKanbanColumn,
  resolveOptimisticDispatchOutcome,
  type KanbanOptimisticDispatchOutcome,
} from "./logic/kanbanStatusReadModel";
export {
  KANBAN_COLUMN_LABELS,
  KANBAN_FALLBACK_DRAFT_TITLE,
  isKanbanDraftOnlyCard,
  kanbanDraftCardId,
  kanbanThreadCardId,
  type BuildKanbanBoardInput,
  type KanbanBoard,
  type KanbanCard,
  type KanbanColumnKey,
  type KanbanComposerDraftSnapshot,
  type KanbanDraftThreadSnapshot,
  type KanbanOptimisticDispatchSnapshot,
  type KanbanProjectBoard,
} from "./logic/kanbanTypes";
