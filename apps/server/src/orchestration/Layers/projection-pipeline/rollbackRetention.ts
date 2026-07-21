import type { ProjectionThreadActivity } from "../../../persistence/Services/ProjectionThreadActivities.ts";
import type { ProjectionThreadMessage } from "../../../persistence/Services/ProjectionThreadMessages.ts";
import type { ProjectionThreadProposedPlan } from "../../../persistence/Services/ProjectionThreadProposedPlans.ts";
import type { ProjectionTurn } from "../../../persistence/Services/ProjectionTurns.ts";

function retainedTurnIdsAtCheckpoint(
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): Set<string> {
  return new Set(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );
}

export function retainProjectionMessagesAfterRevert(
  messages: ReadonlyArray<ProjectionThreadMessage>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadMessage> {
  const retainedMessageIds = new Set<string>();
  const retainedTurnIds = retainedTurnIdsAtCheckpoint(turns, turnCount);
  for (const turn of turns) {
    if (
      turn.turnId === null ||
      turn.checkpointTurnCount === null ||
      turn.checkpointTurnCount > turnCount
    ) {
      continue;
    }
    if (turn.pendingMessageId !== null) retainedMessageIds.add(turn.pendingMessageId);
    if (turn.assistantMessageId !== null) retainedMessageIds.add(turn.assistantMessageId);
  }
  for (const message of messages) {
    if (message.role === "system") retainedMessageIds.add(message.messageId);
    else if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.messageId);
    }
  }

  const addFallbackMessages = (role: "user" | "assistant") => {
    const retainedCount = messages.filter(
      (message) => message.role === role && retainedMessageIds.has(message.messageId),
    ).length;
    const missingCount = Math.max(0, turnCount - retainedCount);
    if (missingCount === 0) return;
    const fallbackMessages = messages
      .filter(
        (message) =>
          message.role === role &&
          !retainedMessageIds.has(message.messageId) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.messageId.localeCompare(right.messageId),
      )
      .slice(0, missingCount);
    for (const message of fallbackMessages) retainedMessageIds.add(message.messageId);
  };
  addFallbackMessages("user");
  addFallbackMessages("assistant");
  return messages.filter((message) => retainedMessageIds.has(message.messageId));
}

export function retainProjectionActivitiesAfterRevert(
  activities: ReadonlyArray<ProjectionThreadActivity>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadActivity> {
  const retainedTurnIds = retainedTurnIdsAtCheckpoint(turns, turnCount);
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

export function retainProjectionProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<ProjectionThreadProposedPlan>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadProposedPlan> {
  const retainedTurnIds = retainedTurnIdsAtCheckpoint(turns, turnCount);
  return proposedPlans.filter((plan) => plan.turnId === null || retainedTurnIds.has(plan.turnId));
}

export function rollbackProjectionMessagesFromMessage(
  messages: ReadonlyArray<ProjectionThreadMessage>,
  messageId: string,
): {
  readonly keptRows: ReadonlyArray<ProjectionThreadMessage>;
  readonly removedTurnIds: ReadonlySet<string>;
  readonly changed: boolean;
} {
  const targetIndex = messages.findIndex((message) => message.messageId === messageId);
  if (targetIndex < 0) {
    return { keptRows: messages, removedTurnIds: new Set(), changed: false };
  }
  const removedRows = messages.slice(targetIndex);
  return {
    keptRows: messages.slice(0, targetIndex),
    removedTurnIds: new Set(
      removedRows.flatMap((message) => (message.turnId === null ? [] : [message.turnId])),
    ),
    changed: true,
  };
}

export function retainProjectionTurnsAfterConversationRollback(
  turns: ReadonlyArray<ProjectionTurn>,
  removedTurnIds: ReadonlySet<string>,
): ReadonlyArray<ProjectionTurn> {
  if (removedTurnIds.size === 0) return turns;
  return turns.filter((turn) => turn.turnId === null || !removedTurnIds.has(turn.turnId));
}

export function retainProjectionActivitiesAfterConversationRollback(
  activities: ReadonlyArray<ProjectionThreadActivity>,
  removedTurnIds: ReadonlySet<string>,
): ReadonlyArray<ProjectionThreadActivity> {
  return activities.filter(
    (activity) => activity.turnId === null || !removedTurnIds.has(activity.turnId),
  );
}

export function retainProjectionProposedPlansAfterConversationRollback(
  plans: ReadonlyArray<ProjectionThreadProposedPlan>,
  removedTurnIds: ReadonlySet<string>,
): ReadonlyArray<ProjectionThreadProposedPlan> {
  return plans.filter((plan) => plan.turnId === null || !removedTurnIds.has(plan.turnId));
}
