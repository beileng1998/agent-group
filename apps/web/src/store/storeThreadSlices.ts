// FILE: storeThreadSlices.ts
// Purpose: Build normalized thread slices and legacy shell/turn projections.
// Layer: Web state normalized records

import type { MessageId, ThreadId, TurnId } from "@agent-group/contracts";
import type { ChatMessage, Thread, ThreadShell, ThreadTurnState } from "../types";
import { capThreadActivities, dedupeActivitiesById } from "./storeActivityProjection";

export function updateThread(
  threads: Thread[],
  threadId: ThreadId,
  updater: (thread: Thread) => Thread,
): Thread[] {
  let changed = false;
  const next = threads.map((thread) => {
    if (thread.id !== threadId) return thread;
    const updated = updater(thread);
    if (updated !== thread) changed = true;
    return updated;
  });
  return changed ? next : threads;
}

export function resolveEventUpdatedAt(thread: Thread, updatedAt: string): string {
  const currentUpdatedAt = thread.updatedAt ?? thread.createdAt;
  return currentUpdatedAt > updatedAt ? currentUpdatedAt : updatedAt;
}

export function toThreadShell(thread: Thread): ThreadShell {
  return {
    id: thread.id,
    codexThreadId: thread.codexThreadId,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    error: thread.error,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt ?? null,
    updatedAt: thread.updatedAt,
    isPinned: thread.isPinned ?? false,
    envMode: thread.envMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    associatedWorktreePath: thread.associatedWorktreePath ?? null,
    associatedWorktreeBranch: thread.associatedWorktreeBranch ?? null,
    associatedWorktreeRef: thread.associatedWorktreeRef ?? null,
    createBranchFlowCompleted: thread.createBranchFlowCompleted ?? false,
    parentThreadId: thread.parentThreadId ?? null,
    subagentAgentId: thread.subagentAgentId ?? null,
    subagentNickname: thread.subagentNickname ?? null,
    subagentRole: thread.subagentRole ?? null,
    forkSourceThreadId: thread.forkSourceThreadId ?? null,
    sidechatSourceThreadId: thread.sidechatSourceThreadId ?? null,
    lastKnownPr: thread.lastKnownPr ?? null,
    handoff: thread.handoff ?? null,
    ...(thread.pinnedMessages !== undefined ? { pinnedMessages: thread.pinnedMessages } : {}),
    ...(thread.threadMarkers !== undefined ? { threadMarkers: thread.threadMarkers } : {}),
    ...(thread.notes !== undefined ? { notes: thread.notes } : {}),
    ...(thread.latestUserMessageAt !== undefined
      ? { latestUserMessageAt: thread.latestUserMessageAt }
      : {}),
    ...(thread.hasPendingApprovals !== undefined
      ? { hasPendingApprovals: thread.hasPendingApprovals }
      : {}),
    ...(thread.hasPendingUserInput !== undefined
      ? { hasPendingUserInput: thread.hasPendingUserInput }
      : {}),
    ...(thread.hasActionableProposedPlan !== undefined
      ? { hasActionableProposedPlan: thread.hasActionableProposedPlan }
      : {}),
    ...(thread.lastVisitedAt !== undefined ? { lastVisitedAt: thread.lastVisitedAt } : {}),
  };
}

export function toThreadTurnState(thread: Thread): ThreadTurnState {
  return {
    latestTurn: thread.latestTurn,
    ...(thread.pendingSourceProposedPlan
      ? { pendingSourceProposedPlan: thread.pendingSourceProposedPlan }
      : {}),
  };
}

export function buildMessageSlice(thread: Thread): {
  ids: MessageId[];
  byId: Record<MessageId, ChatMessage>;
} {
  return {
    ids: thread.messages.map((message) => message.id),
    byId: Object.fromEntries(
      thread.messages.map((message) => [message.id, message] as const),
    ) as Record<MessageId, ChatMessage>,
  };
}

export function buildActivitySlice(thread: Thread): {
  ids: string[];
  byId: Record<string, Thread["activities"][number]>;
} {
  const activities = capThreadActivities(dedupeActivitiesById(thread.activities));
  return {
    ids: activities.map((activity) => activity.id),
    byId: Object.fromEntries(
      activities.map((activity) => [activity.id, activity] as const),
    ) as Record<string, Thread["activities"][number]>,
  };
}

export function buildProposedPlanSlice(thread: Thread): {
  ids: string[];
  byId: Record<string, Thread["proposedPlans"][number]>;
} {
  return {
    ids: thread.proposedPlans.map((plan) => plan.id),
    byId: Object.fromEntries(
      thread.proposedPlans.map((plan) => [plan.id, plan] as const),
    ) as Record<string, Thread["proposedPlans"][number]>,
  };
}

export function buildTurnDiffSlice(thread: Thread): {
  ids: TurnId[];
  byId: Record<TurnId, Thread["turnDiffSummaries"][number]>;
} {
  return {
    ids: thread.turnDiffSummaries.map((summary) => summary.turnId),
    byId: Object.fromEntries(
      thread.turnDiffSummaries.map((summary) => [summary.turnId, summary] as const),
    ) as Record<TurnId, Thread["turnDiffSummaries"][number]>,
  };
}
