import type { SidebarThreadSummary } from "../../../types";
import { canSessionAnswerPendingRequests, hasLiveLatestTurn } from "../../../session-logic";
import type { KanbanColumnKey, KanbanOptimisticDispatchSnapshot } from "./kanbanTypes";

/** Derives the kanban lane exclusively from current runtime state. */
export function deriveKanbanColumn(thread: SidebarThreadSummary): KanbanColumnKey {
  const hasActionablePendingRequests =
    (thread.hasPendingApprovals || thread.hasPendingUserInput) &&
    canSessionAnswerPendingRequests(thread.session);
  if (hasActionablePendingRequests || thread.hasLiveTailWork) {
    return "inProgress";
  }
  if (thread.latestTurn?.state === "running") {
    return "inProgress";
  }
  if (hasLiveLatestTurn(thread.latestTurn, thread.session)) {
    return "inProgress";
  }
  if (thread.session?.status === "connecting") {
    return "inProgress";
  }
  if (thread.session?.status === "running" && thread.latestTurn === null) {
    return "inProgress";
  }
  if (thread.latestTurn === null) {
    return "draft";
  }
  return "done";
}

export type KanbanOptimisticDispatchOutcome = "pending" | "settled" | "failed";

/** Relates current runtime state to an optimistic dispatch overlay. */
export function resolveOptimisticDispatchOutcome(
  entry: Pick<KanbanOptimisticDispatchSnapshot, "baselineTurnId" | "droppedAtMs">,
  thread: SidebarThreadSummary,
): KanbanOptimisticDispatchOutcome {
  if ((thread.latestTurn?.turnId ?? null) !== entry.baselineTurnId) {
    return "settled";
  }
  if (deriveKanbanColumn(thread) === "inProgress" && thread.session?.status !== "connecting") {
    return "settled";
  }
  const sessionStatus = thread.session?.status;
  if (sessionStatus === "error" || sessionStatus === "closed") {
    const endedAtMs = Date.parse(thread.session?.updatedAt ?? "");
    if (Number.isFinite(endedAtMs) && endedAtMs >= entry.droppedAtMs) {
      return "failed";
    }
  }
  return "pending";
}
