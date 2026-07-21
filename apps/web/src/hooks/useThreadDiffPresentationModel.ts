// FILE: useThreadDiffPresentationModel.ts
// Purpose: Derive Turn-scoped and repository diff presentation for one chat.
// Layer: Web chat read model

import { useMemo } from "react";
import type { MessageId, TurnId } from "@agent-group/contracts";

import { resolveActiveTurnLiveDiffState } from "../components/ChatView.logic";
import { buildTurnDiffSummaryByAssistantMessageId } from "../components/chat/MessagesTimeline.logic";
import {
  inferCheckpointTurnCountByTurnId,
  type TimelineEntry,
  type WorkLogEntry,
} from "../session-logic";
import type { ChatMessage, Thread } from "../types";
import { useRepoDiffTotals } from "./useRepoDiffTotals";

const EMPTY_TURN_DIFF_SUMMARIES: Thread["turnDiffSummaries"] = [];

export function useThreadDiffPresentationModel(input: {
  thread: Thread | undefined;
  timelineMessages: ReadonlyArray<ChatMessage>;
  timelineEntries: ReadonlyArray<TimelineEntry>;
  latestTurnId: TurnId | null;
  workLogEntries: ReadonlyArray<WorkLogEntry>;
  gitCwd: string | null;
  isGitRepo: boolean;
  repoRefetchInterval: number | false;
}) {
  const turnDiffSummaries = input.thread?.turnDiffSummaries ?? EMPTY_TURN_DIFF_SUMMARIES;
  const inferredCheckpointTurnCountByTurnId = useMemo(
    () => inferCheckpointTurnCountByTurnId(turnDiffSummaries),
    [turnDiffSummaries],
  );
  const turnDiffSummaryByAssistantMessageId = useMemo(
    () =>
      buildTurnDiffSummaryByAssistantMessageId({
        turnDiffSummaries: turnDiffSummaries.map((summary) => ({
          ...summary,
          checkpointTurnCount:
            summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId],
        })),
        messages: input.timelineMessages.map((message) => ({
          id: message.id,
          role: message.role,
          turnId: message.turnId ?? null,
        })),
      }),
    [inferredCheckpointTurnCountByTurnId, input.timelineMessages, turnDiffSummaries],
  );
  const revertTurnCountByUserMessageId = useMemo(() => {
    const byUserMessageId = new Map<MessageId, number>();
    for (let index = 0; index < input.timelineEntries.length; index += 1) {
      const entry = input.timelineEntries[index];
      if (!entry || entry.kind !== "message" || entry.message.role !== "user") continue;

      for (let nextIndex = index + 1; nextIndex < input.timelineEntries.length; nextIndex += 1) {
        const nextEntry = input.timelineEntries[nextIndex];
        if (!nextEntry || nextEntry.kind !== "message") continue;
        if (nextEntry.message.role === "user") break;
        const summary = turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id);
        if (!summary) continue;
        const turnCount =
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
        if (typeof turnCount !== "number") break;
        byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1));
        break;
      }
    }
    return byUserMessageId;
  }, [
    inferredCheckpointTurnCountByTurnId,
    input.timelineEntries,
    turnDiffSummaryByAssistantMessageId,
  ]);
  const repoDiffTotals = useRepoDiffTotals({
    gitCwd: input.gitCwd,
    isGitRepo: input.isGitRepo,
    refetchInterval: input.repoRefetchInterval,
  });
  const activeTurnLiveDiffState = useMemo(
    () =>
      resolveActiveTurnLiveDiffState({
        latestTurnId: input.latestTurnId,
        turnDiffSummaries,
        workLogEntries: input.workLogEntries,
      }),
    [input.latestTurnId, input.workLogEntries, turnDiffSummaries],
  );

  return {
    turnDiffSummaries,
    inferredCheckpointTurnCountByTurnId,
    turnDiffSummaryByAssistantMessageId,
    revertTurnCountByUserMessageId,
    repoDiffTotals,
    activeTurnLiveDiffState,
  };
}
