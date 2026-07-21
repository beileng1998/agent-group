// FILE: storeEquality.ts
// Purpose: Preserve stable client references by comparing normalized store values.
// Layer: Web state projection primitives

import type { ProviderKind } from "@agent-group/contracts";
import { normalizeModelSlug } from "@agent-group/shared/model";
import type { ChatMessage, Thread, ThreadSession, ThreadShell, ThreadTurnState } from "../types";

function sourceProposedPlansEqual(
  left: Thread["pendingSourceProposedPlan"],
  right: Thread["pendingSourceProposedPlan"],
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return left.threadId === right.threadId && left.planId === right.planId;
}

export function latestTurnsEqual(left: Thread["latestTurn"], right: Thread["latestTurn"]): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return (
    left.turnId === right.turnId &&
    left.state === right.state &&
    left.requestedAt === right.requestedAt &&
    left.startedAt === right.startedAt &&
    left.completedAt === right.completedAt &&
    left.assistantMessageId === right.assistantMessageId &&
    sourceProposedPlansEqual(left.sourceProposedPlan, right.sourceProposedPlan)
  );
}

export function threadSessionsEqual(
  left: ThreadSession | null | undefined,
  right: ThreadSession | null | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return (
    left.provider === right.provider &&
    left.status === right.status &&
    left.orchestrationStatus === right.orchestrationStatus &&
    left.activeTurnId === right.activeTurnId &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.lastError === right.lastError
  );
}

export function resolveCreateBranchFlowCompletedMerge(input: {
  currentBranch: string | null;
  nextBranch: string | null;
  currentWorktreePath: string | null;
  nextWorktreePath: string | null;
  currentAssociatedWorktreePath: string | null | undefined;
  nextAssociatedWorktreePath: string | null | undefined;
  currentAssociatedWorktreeBranch: string | null | undefined;
  nextAssociatedWorktreeBranch: string | null | undefined;
  currentAssociatedWorktreeRef: string | null | undefined;
  nextAssociatedWorktreeRef: string | null | undefined;
  currentCreateBranchFlowCompleted: boolean | undefined;
  nextCreateBranchFlowCompleted: boolean | undefined;
}): boolean {
  const contextChanged =
    input.currentBranch !== input.nextBranch ||
    input.currentWorktreePath !== input.nextWorktreePath ||
    (input.currentAssociatedWorktreePath ?? null) !== (input.nextAssociatedWorktreePath ?? null) ||
    (input.currentAssociatedWorktreeBranch ?? null) !==
      (input.nextAssociatedWorktreeBranch ?? null) ||
    (input.currentAssociatedWorktreeRef ?? null) !== (input.nextAssociatedWorktreeRef ?? null);
  if (contextChanged) return input.nextCreateBranchFlowCompleted ?? false;
  if (input.nextCreateBranchFlowCompleted === undefined) {
    return input.currentCreateBranchFlowCompleted ?? false;
  }
  if ((input.currentCreateBranchFlowCompleted ?? false) && !input.nextCreateBranchFlowCompleted) {
    return true;
  }
  return input.nextCreateBranchFlowCompleted;
}

export function threadShellsEqual(left: ThreadShell | undefined, right: ThreadShell): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.codexThreadId === right.codexThreadId &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.modelSelection === right.modelSelection &&
    left.runtimeMode === right.runtimeMode &&
    left.interactionMode === right.interactionMode &&
    left.error === right.error &&
    left.createdAt === right.createdAt &&
    (left.archivedAt ?? null) === (right.archivedAt ?? null) &&
    left.updatedAt === right.updatedAt &&
    (left.isPinned ?? false) === (right.isPinned ?? false) &&
    left.envMode === right.envMode &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    (left.associatedWorktreePath ?? null) === (right.associatedWorktreePath ?? null) &&
    (left.associatedWorktreeBranch ?? null) === (right.associatedWorktreeBranch ?? null) &&
    (left.associatedWorktreeRef ?? null) === (right.associatedWorktreeRef ?? null) &&
    (left.createBranchFlowCompleted ?? false) === (right.createBranchFlowCompleted ?? false) &&
    (left.parentThreadId ?? null) === (right.parentThreadId ?? null) &&
    (left.subagentAgentId ?? null) === (right.subagentAgentId ?? null) &&
    (left.subagentNickname ?? null) === (right.subagentNickname ?? null) &&
    (left.subagentRole ?? null) === (right.subagentRole ?? null) &&
    (left.forkSourceThreadId ?? null) === (right.forkSourceThreadId ?? null) &&
    (left.sidechatSourceThreadId ?? null) === (right.sidechatSourceThreadId ?? null) &&
    deepEqualJson(left.lastKnownPr ?? null, right.lastKnownPr ?? null) &&
    (left.handoff ?? null) === (right.handoff ?? null) &&
    deepEqualJson(left.pinnedMessages ?? null, right.pinnedMessages ?? null) &&
    deepEqualJson(left.threadMarkers ?? null, right.threadMarkers ?? null) &&
    (left.notes ?? "") === (right.notes ?? "") &&
    left.latestUserMessageAt === right.latestUserMessageAt &&
    left.hasPendingApprovals === right.hasPendingApprovals &&
    left.hasPendingUserInput === right.hasPendingUserInput &&
    left.hasActionableProposedPlan === right.hasActionableProposedPlan &&
    left.lastVisitedAt === right.lastVisitedAt
  );
}

export function threadTurnStatesEqual(
  left: ThreadTurnState | undefined,
  right: ThreadTurnState,
): boolean {
  return (
    left !== undefined &&
    latestTurnsEqual(left.latestTurn, right.latestTurn) &&
    sourceProposedPlansEqual(left.pendingSourceProposedPlan, right.pendingSourceProposedPlan)
  );
}

export function arraysShallowEqual<T>(
  left: ReadonlyArray<T> | undefined,
  right: ReadonlyArray<T>,
): left is ReadonlyArray<T> {
  if (!left || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

type ComparableProviderReference =
  | NonNullable<ChatMessage["skills"]>[number]
  | NonNullable<ChatMessage["mentions"]>[number];

export function providerReferenceArraysEqual(
  left: ReadonlyArray<ComparableProviderReference> | undefined,
  right: ReadonlyArray<ComparableProviderReference> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftReference = left[index];
    const rightReference = right[index];
    if (!leftReference || !rightReference || leftReference.name !== rightReference.name) {
      return false;
    }
    if ("path" in leftReference && "path" in rightReference) {
      if (leftReference.path !== rightReference.path) return false;
    } else if (
      "sessionId" in leftReference &&
      "sessionId" in rightReference &&
      leftReference.sessionId === rightReference.sessionId
    ) {
      continue;
    } else {
      return false;
    }
  }
  return true;
}

export function recordsShallowEqual<T>(left: Record<string, T>, right: Record<string, T>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!(key in right) || left[key] !== right[key]) return false;
  }
  return true;
}

export function deepEqualJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left == null || right == null || typeof left !== typeof right) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqualJson(left[index], right[index])) return false;
    }
    return true;
  }
  if (typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!(key in rightRecord) || !deepEqualJson(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}

export function normalizeModelSelection<T extends { provider: ProviderKind; model: string }>(
  value: T,
  previous: T | null | undefined,
): T {
  const normalizedModel = normalizeModelSlug(value.model, value.provider) ?? value.model;
  const next = normalizedModel === value.model ? value : { ...value, model: normalizedModel };
  return previous && deepEqualJson(previous, next) ? previous : next;
}
