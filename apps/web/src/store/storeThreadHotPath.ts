// FILE: storeThreadHotPath.ts
// Purpose: Merge lagging read-model snapshots with newer live Turn and assistant state.
// Layer: Web state hot-path projection

import { ThreadId } from "@agent-group/contracts";
import type { Thread, ThreadSession } from "../types";
import { mergeReadModelMessagesWithLiveHotPath } from "./storeMessageProjection";
import type { ReadModelThread } from "./storeState";

function hasLiveAssistantIntro(previousThread: Thread | undefined): boolean {
  if (!previousThread) return false;
  const latestTurn = previousThread.latestTurn;
  if (!latestTurn || latestTurn.state !== "running") return false;
  if (previousThread.session?.orchestrationStatus !== "running") return false;
  return previousThread.messages.some(
    (message) =>
      message.role === "assistant" &&
      message.turnId === latestTurn.turnId &&
      (message.streaming || message.id === latestTurn.assistantMessageId),
  );
}

function shouldPreserveRunningTurn(
  previousThread: Thread | undefined,
  incoming: ReadModelThread,
): boolean {
  if (!hasLiveAssistantIntro(previousThread)) return false;
  const previousTurnId = previousThread?.latestTurn?.turnId;
  if (!previousTurnId) return false;
  if (incoming.latestTurn?.turnId !== previousTurnId) return true;
  return !incoming.latestTurn.completedAt;
}

function readModelSessionFromThreadSession(
  previousSession: ThreadSession,
  previousThread: Thread | undefined,
  incomingSession: ReadModelThread["session"],
): NonNullable<ReadModelThread["session"]> {
  return {
    threadId: previousThread?.id ?? incomingSession?.threadId ?? ThreadId.makeUnsafe("unknown"),
    status: previousSession.orchestrationStatus,
    providerName: previousSession.provider,
    runtimeMode: previousThread?.runtimeMode ?? incomingSession?.runtimeMode ?? "full-access",
    activeTurnId: previousSession.activeTurnId ?? null,
    lastError: previousSession.lastError ?? null,
    updatedAt: previousSession.updatedAt,
  };
}

function mergeReadModelSessionWithLiveHotPath(
  incomingSession: ReadModelThread["session"],
  previousThread: Thread | undefined,
  options: {
    preserveRunningTurn: boolean;
    incomingLatestTurn: ReadModelThread["latestTurn"];
  },
): ReadModelThread["session"] {
  const previousSession = previousThread?.session;
  if (!previousSession || !options.preserveRunningTurn) return incomingSession;
  if (!incomingSession) {
    return previousSession.orchestrationStatus === "running"
      ? readModelSessionFromThreadSession(previousSession, previousThread, incomingSession)
      : incomingSession;
  }
  if (previousSession.updatedAt > incomingSession.updatedAt) {
    const nextSession = readModelSessionFromThreadSession(
      previousSession,
      previousThread,
      incomingSession,
    );
    return {
      ...nextSession,
      providerName: incomingSession.providerName,
      runtimeMode: incomingSession.runtimeMode,
      activeTurnId: previousSession.activeTurnId ?? incomingSession.activeTurnId,
      lastError: previousSession.lastError ?? incomingSession.lastError,
    };
  }
  const supersededByTerminalTurn =
    incomingSession.updatedAt > previousSession.updatedAt &&
    options.incomingLatestTurn != null &&
    options.incomingLatestTurn.completedAt != null &&
    options.incomingLatestTurn.turnId !== previousThread?.latestTurn?.turnId;
  if (
    previousSession.orchestrationStatus === "running" &&
    incomingSession.status !== "running" &&
    incomingSession.status !== "error" &&
    previousSession.activeTurnId !== undefined &&
    !supersededByTerminalTurn
  ) {
    return {
      ...incomingSession,
      status: "running",
      activeTurnId: previousSession.activeTurnId,
      lastError: previousSession.lastError ?? incomingSession.lastError,
      updatedAt:
        previousSession.updatedAt >= incomingSession.updatedAt
          ? previousSession.updatedAt
          : incomingSession.updatedAt,
    };
  }
  return incomingSession;
}

function mergeReadModelLatestTurnWithLiveHotPath(
  incomingLatestTurn: ReadModelThread["latestTurn"],
  previousThread: Thread | undefined,
  options: { preserveRunningTurn: boolean },
): ReadModelThread["latestTurn"] {
  const previousLatestTurn = previousThread?.latestTurn;
  if (!previousLatestTurn) return incomingLatestTurn;
  if (options.preserveRunningTurn) {
    if (incomingLatestTurn === null || incomingLatestTurn.turnId === previousLatestTurn.turnId) {
      return {
        ...(incomingLatestTurn ?? previousLatestTurn),
        turnId: previousLatestTurn.turnId,
        state: "running",
        requestedAt: incomingLatestTurn?.requestedAt ?? previousLatestTurn.requestedAt,
        startedAt: incomingLatestTurn?.startedAt ?? previousLatestTurn.startedAt,
        completedAt: null,
        assistantMessageId:
          previousLatestTurn.assistantMessageId ?? incomingLatestTurn?.assistantMessageId ?? null,
        ...((incomingLatestTurn?.sourceProposedPlan ?? previousLatestTurn.sourceProposedPlan)
          ? {
              sourceProposedPlan:
                incomingLatestTurn?.sourceProposedPlan ?? previousLatestTurn.sourceProposedPlan,
            }
          : {}),
      };
    }
    return incomingLatestTurn;
  }
  if (incomingLatestTurn === null || incomingLatestTurn.turnId !== previousLatestTurn.turnId) {
    return incomingLatestTurn;
  }
  if (
    previousLatestTurn.assistantMessageId === undefined ||
    incomingLatestTurn.assistantMessageId === previousLatestTurn.assistantMessageId
  ) {
    return incomingLatestTurn;
  }
  return { ...incomingLatestTurn, assistantMessageId: previousLatestTurn.assistantMessageId };
}

export function mergeReadModelThreadDetailWithLiveHotPath(
  incoming: ReadModelThread,
  previousThread: Thread | undefined,
): ReadModelThread {
  if (!previousThread) return incoming;
  const preserveRunningTurn = shouldPreserveRunningTurn(previousThread, incoming);
  const messages = mergeReadModelMessagesWithLiveHotPath(incoming.messages, previousThread);
  const session = mergeReadModelSessionWithLiveHotPath(incoming.session, previousThread, {
    preserveRunningTurn,
    incomingLatestTurn: incoming.latestTurn,
  });
  const latestTurn = mergeReadModelLatestTurnWithLiveHotPath(incoming.latestTurn, previousThread, {
    preserveRunningTurn,
  });
  if (
    messages === incoming.messages &&
    session === incoming.session &&
    latestTurn === incoming.latestTurn
  ) {
    return incoming;
  }
  return { ...incoming, messages, session, latestTurn };
}
