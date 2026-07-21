// FILE: useThreadActivityController.ts
// Purpose: Own visible worklog, subagent enrichment, activity details, and active tasks.
// Layer: Web thread presentation controller

import { type TurnId } from "@agent-group/contracts";
import { useEffect, useMemo, useState } from "react";

import { createRelevantWorkLogThreadsSelector } from "../components/ChatView.selectors";
import { enrichSubagentWorkEntries } from "../components/ChatView.logic";
import { deriveAgentActivityTimelineState } from "../components/chat/agentActivity.logic";
import {
  deriveActiveBackgroundTasksState,
  deriveActiveTaskListState,
  deriveWorkLogEntries,
  type ActiveTaskListState,
} from "../session-logic";
import { useStore } from "../store";
import type { Thread } from "../types";

export function useThreadActivityController(input: {
  activeThread: Thread | undefined;
  latestTurn: Thread["latestTurn"] | null;
  threadActivities: Thread["activities"];
  latestTurnSettled: boolean;
  showDebugTaskBanner: boolean;
}) {
  const visibleTurnIds = useMemo(() => {
    const turnIds = new Set<TurnId>();
    for (const message of input.activeThread?.messages ?? []) {
      if (message.turnId) turnIds.add(message.turnId);
    }
    if (input.latestTurn?.turnId) turnIds.add(input.latestTurn.turnId);
    return turnIds;
  }, [input.activeThread?.messages, input.latestTurn?.turnId]);
  const rawWorkLogEntries = useMemo(
    () =>
      deriveWorkLogEntries(input.threadActivities, input.latestTurn?.turnId ?? undefined, {
        visibleTurnIds,
      }),
    [input.latestTurn?.turnId, input.threadActivities, visibleTurnIds],
  );
  const hasSubagents = useMemo(
    () => rawWorkLogEntries.some((entry) => (entry.subagents?.length ?? 0) > 0),
    [rawWorkLogEntries],
  );
  const relevantThreads = useStore(
    useMemo(
      () =>
        createRelevantWorkLogThreadsSelector({
          workEntries: rawWorkLogEntries,
          parentThreadId: input.activeThread?.id ?? null,
          enabled: hasSubagents,
        }),
      [hasSubagents, input.activeThread?.id, rawWorkLogEntries],
    ),
  );
  const workLogEntries = useMemo(
    () =>
      hasSubagents
        ? enrichSubagentWorkEntries(
            rawWorkLogEntries,
            relevantThreads,
            input.activeThread?.id ?? null,
          )
        : rawWorkLogEntries,
    [hasSubagents, input.activeThread?.id, rawWorkLogEntries, relevantThreads],
  );
  const [openActivityId, setOpenActivityId] = useState<string | null>(null);
  const timelineState = useMemo(
    () => deriveAgentActivityTimelineState(workLogEntries),
    [workLogEntries],
  );
  const openActivityDetail = openActivityId
    ? (timelineState.detailById.get(openActivityId) ?? null)
    : null;
  useEffect(() => setOpenActivityId(null), [input.activeThread?.id]);
  useEffect(() => {
    if (openActivityId && !timelineState.detailById.has(openActivityId)) {
      setOpenActivityId(null);
    }
  }, [openActivityId, timelineState.detailById]);

  const [activeTaskListCompact, setActiveTaskListCompact] = useState(false);
  const activeTaskList = useMemo((): ActiveTaskListState | null => {
    if (input.showDebugTaskBanner) {
      return {
        createdAt: new Date().toISOString(),
        turnId: input.latestTurn?.turnId ?? null,
        tasks: [
          {
            task: "Inspect banner layout without overlapping transcript text",
            status: "inProgress",
          },
          { task: "Confirm compact task banner width", status: "pending" },
          { task: "Verify sidebar task controls", status: "completed" },
        ],
      };
    }
    return input.latestTurnSettled
      ? null
      : deriveActiveTaskListState(input.threadActivities, input.latestTurn?.turnId);
  }, [
    input.latestTurn?.turnId,
    input.latestTurnSettled,
    input.showDebugTaskBanner,
    input.threadActivities,
  ]);
  const activeBackgroundTasks = useMemo(
    () =>
      input.latestTurnSettled
        ? null
        : deriveActiveBackgroundTasksState(
            input.threadActivities,
            input.latestTurn?.turnId ?? undefined,
          ),
    [input.latestTurn?.turnId, input.latestTurnSettled, input.threadActivities],
  );

  return {
    activeBackgroundTasks,
    activeTaskList,
    activeTaskListCompact,
    agentActivityTimelineState: timelineState,
    openAgentActivityDetail: openActivityDetail,
    rawWorkLogEntries,
    setActiveTaskListCompact,
    setOpenAgentActivityId: setOpenActivityId,
  };
}
