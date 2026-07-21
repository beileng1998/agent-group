// FILE: MessagesTimeline.turnDiffs.ts
// Purpose: Anchors and merges turn diff summaries onto visible assistant responses.
// Layer: Web chat presentation helpers

import type { MessageId } from "@agent-group/contracts";
import type { TurnDiffSummary } from "../../types";
import type { TimelineDiffMessage } from "./MessagesTimeline.types";

// Builds the "Files changed" lookup keyed by the last assistant row in the
// user-visible response segment. Provider mini-turns can emit diffs before the
// final answer, so the card follows the segment tail instead of the raw turn.
export function buildTurnDiffSummaryByAssistantMessageId(input: {
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  messages: ReadonlyArray<TimelineDiffMessage>;
}): Map<MessageId, TurnDiffSummary> {
  const byMessageId = new Map<MessageId, TurnDiffSummary>();
  if (input.turnDiffSummaries.length === 0) return byMessageId;

  const summaryByTurnId = new Map<string, TurnDiffSummary>();
  for (const summary of input.turnDiffSummaries) {
    summaryByTurnId.set(summary.turnId, summary);
  }

  const messageIndexByTurnId = new Map<string, number>();
  for (let index = 0; index < input.messages.length; index += 1) {
    const message = input.messages[index]!;
    if (message.role !== "assistant" || !message.turnId) continue;
    messageIndexByTurnId.set(message.turnId, index);
  }

  for (const [turnId, summary] of summaryByTurnId) {
    const anchorIndex = messageIndexByTurnId.get(turnId);
    if (anchorIndex === undefined) continue;
    let terminalAssistantMessageId: MessageId | null = null;
    for (let index = anchorIndex; index < input.messages.length; index += 1) {
      const message = input.messages[index]!;
      if (index > anchorIndex && message.role === "user") break;
      if (message.role === "assistant") {
        terminalAssistantMessageId = message.id;
      }
    }
    if (!terminalAssistantMessageId) continue;

    byMessageId.set(
      terminalAssistantMessageId,
      mergeTurnDiffSummaries(byMessageId.get(terminalAssistantMessageId), summary),
    );
  }
  return byMessageId;
}

// Keeps multi-turn provider responses from losing earlier "Files changed" rows
// when several turn-diff summaries anchor to the same final assistant message.
export function mergeTurnDiffSummaries(
  existing: TurnDiffSummary | undefined,
  next: TurnDiffSummary,
): TurnDiffSummary {
  const checkpointTurnCountsFor = (summary: TurnDiffSummary): number[] => {
    if (
      summary.files.length === 0 ||
      summary.status === "missing" ||
      summary.status === "error" ||
      summary.checkpointRef === undefined ||
      summary.checkpointRef.startsWith("provider-diff:")
    ) {
      return [];
    }
    return (
      summary.checkpointTurnCounts ??
      (summary.checkpointTurnCount === undefined ? [] : [summary.checkpointTurnCount])
    );
  };
  if (!existing) {
    const checkpointTurnCounts = checkpointTurnCountsFor(next);
    return { ...next, checkpointTurnCounts };
  }

  const filesByPath = new Map(existing.files.map((file) => [file.path, file]));
  for (const file of next.files) {
    filesByPath.set(file.path, file);
  }
  const checkpointTurnCounts = new Set([
    ...checkpointTurnCountsFor(existing),
    ...checkpointTurnCountsFor(next),
  ]);
  const undoMetadata =
    checkpointTurnCountsFor(next).length > 0
      ? next
      : checkpointTurnCountsFor(existing).length > 0
        ? existing
        : next;
  const allDisplayedFilesUndoable = [existing, next].every(
    (summary) => summary.files.length === 0 || checkpointTurnCountsFor(summary).length > 0,
  );

  return {
    ...next,
    files: [...filesByPath.values()],
    checkpointRef: undoMetadata.checkpointRef,
    status: undoMetadata.status,
    checkpointTurnCount: undoMetadata.checkpointTurnCount,
    checkpointTurnCounts: allDisplayedFilesUndoable
      ? [...checkpointTurnCounts].toSorted((left, right) => left - right)
      : [],
  };
}
