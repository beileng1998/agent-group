// FILE: goalCompletion.ts
// Purpose: Detect completed persistent goals and build one final notification.
// Layer: Notification logic

import type { Thread } from "../types";

export interface CompletedGoalCandidate {
  threadId: Thread["id"];
  projectId: Thread["projectId"];
  title: string;
  goal: string;
  achievedAt: string;
}

function achievementKey(achievement: NonNullable<Thread["goalAchievements"]>[number]): string {
  return `${achievement.achievedAt}:${achievement.turnId ?? ""}:${achievement.goal}`;
}

export function hasActivePersistentGoal(thread: Thread | undefined): boolean {
  return Boolean(thread?.goal?.trim()) && thread?.goalPausedAt == null;
}

export function collectCompletedGoalCandidates(
  previousThreads: readonly Thread[],
  nextThreads: readonly Thread[],
): CompletedGoalCandidate[] {
  const previousById = new Map(previousThreads.map((thread) => [thread.id, thread] as const));
  const candidates: CompletedGoalCandidate[] = [];
  for (const thread of nextThreads) {
    const previous = previousById.get(thread.id);
    if (!previous) continue;
    const previousKeys = new Set((previous.goalAchievements ?? []).map(achievementKey));
    for (const achievement of thread.goalAchievements ?? []) {
      if (previousKeys.has(achievementKey(achievement))) continue;
      candidates.push({
        threadId: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        goal: achievement.goal,
        achievedAt: achievement.achievedAt,
      });
    }
  }
  return candidates.toSorted((left, right) => left.achievedAt.localeCompare(right.achievedAt));
}

export function buildGoalCompletionCopy(candidate: CompletedGoalCandidate): {
  title: string;
  body: string;
} {
  const title = candidate.title.trim() || "Untitled thread";
  const normalizedGoal = candidate.goal.trim().replace(/\s+/g, " ");
  const goal = normalizedGoal.length <= 140 ? normalizedGoal : `${normalizedGoal.slice(0, 137)}...`;
  return { title, body: goal ? `Goal completed: ${goal}` : "Goal completed." };
}

export function completedGoalNotificationKey(candidate: CompletedGoalCandidate): string {
  return `${candidate.threadId}:${candidate.achievedAt}:${candidate.goal}`;
}
