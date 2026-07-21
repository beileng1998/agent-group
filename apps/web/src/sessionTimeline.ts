// FILE: sessionTimeline.ts
// Purpose: Merge messages, proposed plans, and work entries into one stable transcript timeline.
// Layer: Web session read model

import type { TurnId } from "@agent-group/contracts";
import { stripProposedPlanBlocksFromText } from "./proposedPlan";
import type { TimelineEntry, WorkLogEntry } from "./sessionTypes";
import type { ChatMessage, ProposedPlan, TurnDiffSummary } from "./types";

function compareTimelineEntries(left: TimelineEntry, right: TimelineEntry): number {
  return left.createdAt.localeCompare(right.createdAt);
}

function areTimelineEntriesOrdered(entries: ReadonlyArray<TimelineEntry>): boolean {
  for (let index = 1; index < entries.length; index += 1) {
    if (compareTimelineEntries(entries[index - 1]!, entries[index]!) > 0) {
      return false;
    }
  }
  return true;
}

function sortedTimelineEntries(entries: TimelineEntry[]): TimelineEntry[] {
  return areTimelineEntriesOrdered(entries) ? entries : entries.toSorted(compareTimelineEntries);
}

function mergeTimelineEntries(
  left: ReadonlyArray<TimelineEntry>,
  right: ReadonlyArray<TimelineEntry>,
): TimelineEntry[] {
  if (left.length === 0) return [...right];
  if (right.length === 0) return [...left];

  const merged: TimelineEntry[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftEntry = left[leftIndex]!;
    const rightEntry = right[rightIndex]!;
    if (compareTimelineEntries(leftEntry, rightEntry) <= 0) {
      merged.push(leftEntry);
      leftIndex += 1;
    } else {
      merged.push(rightEntry);
      rightIndex += 1;
    }
  }
  while (leftIndex < left.length) {
    merged.push(left[leftIndex]!);
    leftIndex += 1;
  }
  while (rightIndex < right.length) {
    merged.push(right[rightIndex]!);
    rightIndex += 1;
  }
  return merged;
}

export function deriveTimelineEntries(
  messages: ChatMessage[],
  proposedPlans: ProposedPlan[],
  workEntries: WorkLogEntry[],
): TimelineEntry[] {
  const proposedPlanTurnIds = new Set(
    proposedPlans.flatMap((proposedPlan) => (proposedPlan.turnId ? [proposedPlan.turnId] : [])),
  );
  const messageRows: TimelineEntry[] = messages.flatMap((message) => {
    const displayMessage =
      message.role === "assistant" && message.turnId && proposedPlanTurnIds.has(message.turnId)
        ? { ...message, text: stripProposedPlanBlocksFromText(message.text) }
        : message;
    if (
      displayMessage.role === "assistant" &&
      displayMessage.text.length === 0 &&
      displayMessage.turnId &&
      proposedPlanTurnIds.has(displayMessage.turnId)
    ) {
      return [];
    }
    return [
      {
        id: displayMessage.id,
        kind: "message" as const,
        createdAt: displayMessage.createdAt,
        message: displayMessage,
      },
    ];
  });
  const proposedPlanRows: TimelineEntry[] = proposedPlans.map((proposedPlan) => ({
    id: proposedPlan.id,
    kind: "proposed-plan",
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  }));
  const workRows: TimelineEntry[] = workEntries.map((entry) => ({
    id: entry.id,
    kind: "work",
    createdAt: entry.createdAt,
    entry,
  }));

  return mergeTimelineEntries(
    mergeTimelineEntries(
      sortedTimelineEntries(messageRows),
      sortedTimelineEntries(proposedPlanRows),
    ),
    sortedTimelineEntries(workRows),
  );
}

export function inferCheckpointTurnCountByTurnId(
  summaries: TurnDiffSummary[],
): Record<TurnId, number> {
  const sorted = [...summaries].toSorted((a, b) => a.completedAt.localeCompare(b.completedAt));
  const result: Record<TurnId, number> = {};
  for (let index = 0; index < sorted.length; index += 1) {
    const summary = sorted[index];
    if (!summary) continue;
    result[summary.turnId] = index + 1;
  }
  return result;
}
