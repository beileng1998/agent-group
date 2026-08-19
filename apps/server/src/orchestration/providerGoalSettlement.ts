import type { ProviderRuntimeEvent, ThreadId, TurnId } from "@agent-group/contracts";
import { Effect } from "effect";

import { activeThreadGoal, goalSettlementFromAssistantText } from "../provider/providerGoalMode.ts";
import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import { providerCommandId, runtimeTurnState } from "./providerRuntimeIngestionValues.ts";

export function settleThreadGoalAfterTerminal(input: {
  readonly orchestrationEngine: Pick<OrchestrationEngineShape, "dispatch" | "getReadModel">;
  readonly event: ProviderRuntimeEvent;
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
}) {
  return Effect.gen(function* () {
    const thread = (yield* input.orchestrationEngine.getReadModel()).threads.find(
      (candidate) => candidate.id === input.threadId,
    );
    if (
      !thread ||
      thread.deletedAt != null ||
      thread.archivedAt != null ||
      thread.parentThreadId != null ||
      !activeThreadGoal(thread)
    ) {
      return;
    }

    const completed =
      input.event.type === "turn.completed" && runtimeTurnState(input.event) === "completed";
    if (!completed) {
      yield* input.orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: providerCommandId(input.event, "goal-auto-pause"),
        threadId: thread.id,
        goalPaused: true,
      });
      return;
    }

    const settlementTurnId = input.turnId ?? thread.latestTurn?.turnId ?? undefined;
    const goalStartedMs = Date.parse(thread.goalStartedAt ?? "");
    const latestAssistant = thread.messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          message.streaming === false &&
          (settlementTurnId === undefined || message.turnId === settlementTurnId) &&
          (!Number.isFinite(goalStartedMs) || Date.parse(message.updatedAt) >= goalStartedMs),
      )
      .toSorted(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
      )[0];
    const settlement = goalSettlementFromAssistantText(latestAssistant?.text ?? "");
    if (settlement !== null) {
      yield* input.orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: providerCommandId(input.event, `goal-${settlement}`),
        threadId: thread.id,
        ...(settlement === "achieved" ? { goalAchieved: true } : { goalPaused: true }),
      });
      return;
    }

    yield* input.orchestrationEngine.dispatch({
      type: "thread.goal.continue",
      commandId: providerCommandId(input.event, "goal-continue"),
      threadId: thread.id,
      goalStartedAt: thread.goalStartedAt ?? null,
      trigger: "turn-completed",
      ...(input.turnId !== undefined ? { sourceTurnId: input.turnId } : {}),
      createdAt: input.event.createdAt,
    });
  });
}
