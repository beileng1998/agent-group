import { Effect, Option } from "effect";

import {
  type ProjectionTurn,
  ProjectionTurnRepository,
} from "../../../persistence/Services/ProjectionTurns.ts";
import type { ProjectorDefinition } from "./projectorDefinitions.ts";
import { retainProjectionTurnsAfterConversationRollback } from "./rollbackRetention.ts";

function finalizeTurnStateFromSessionStatus(
  status: "starting" | "running" | "ready" | "interrupted" | "stopped" | "error",
  existingState: ProjectionTurn["state"],
): ProjectionTurn["state"] {
  switch (status) {
    case "error":
      return "error";
    case "interrupted":
      return "interrupted";
    case "ready":
    case "stopped":
      return existingState === "error"
        ? "error"
        : existingState === "interrupted"
          ? "interrupted"
          : "completed";
    case "starting":
    case "running":
      return "running";
  }
}

export const makeThreadTurnProjection = Effect.gen(function* () {
  const repository = yield* ProjectionTurnRepository;
  const apply: ProjectorDefinition["apply"] = (event) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.turn-start-requested":
          yield* repository.replacePendingTurnStart({
            threadId: event.payload.threadId,
            messageId: event.payload.messageId,
            sourceProposedPlanThreadId: event.payload.sourceProposedPlan?.threadId ?? null,
            sourceProposedPlanId: event.payload.sourceProposedPlan?.planId ?? null,
            requestedAt: event.payload.createdAt,
          });
          return;

        case "thread.session-set": {
          const turnId = event.payload.session.activeTurnId;
          if (event.payload.session.status !== "running" || turnId === null) {
            if (
              event.payload.session.activeTurnId === null &&
              (event.payload.session.status === "ready" ||
                event.payload.session.status === "error" ||
                event.payload.session.status === "interrupted" ||
                event.payload.session.status === "stopped")
            ) {
              const turnToFinalize = (yield* repository.listByThreadId({
                threadId: event.payload.threadId,
              }))
                .filter(
                  (
                    row,
                  ): row is ProjectionTurn & {
                    turnId: Exclude<ProjectionTurn["turnId"], null>;
                  } => row.turnId !== null && row.completedAt === null,
                )
                .toSorted(
                  (left, right) =>
                    right.requestedAt.localeCompare(left.requestedAt) ||
                    right.turnId.localeCompare(left.turnId),
                )
                .at(0);
              if (turnToFinalize) {
                yield* repository.upsertByTurnId({
                  ...turnToFinalize,
                  state: finalizeTurnStateFromSessionStatus(
                    event.payload.session.status,
                    turnToFinalize.state,
                  ),
                  startedAt: turnToFinalize.startedAt ?? event.payload.session.updatedAt,
                  requestedAt: turnToFinalize.requestedAt ?? event.payload.session.updatedAt,
                  completedAt: event.payload.session.updatedAt,
                });
              }
            }
            return;
          }

          const existingTurn = yield* repository.getByTurnId({
            threadId: event.payload.threadId,
            turnId,
          });
          const pendingTurnStart = yield* repository.getPendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          if (Option.isSome(existingTurn)) {
            const nextState =
              existingTurn.value.state === "completed" || existingTurn.value.state === "error"
                ? existingTurn.value.state
                : "running";
            yield* repository.upsertByTurnId({
              ...existingTurn.value,
              state: nextState,
              pendingMessageId:
                existingTurn.value.pendingMessageId ??
                (Option.isSome(pendingTurnStart) ? pendingTurnStart.value.messageId : null),
              sourceProposedPlanThreadId:
                existingTurn.value.sourceProposedPlanThreadId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanThreadId
                  : null),
              sourceProposedPlanId:
                existingTurn.value.sourceProposedPlanId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanId
                  : null),
              startedAt:
                existingTurn.value.startedAt ?? event.payload.session.updatedAt ?? event.occurredAt,
              requestedAt:
                existingTurn.value.requestedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.occurredAt),
            });
          } else {
            yield* repository.upsertByTurnId({
              turnId,
              threadId: event.payload.threadId,
              pendingMessageId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.messageId
                : null,
              sourceProposedPlanThreadId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.sourceProposedPlanThreadId
                : null,
              sourceProposedPlanId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.sourceProposedPlanId
                : null,
              assistantMessageId: null,
              state: "running",
              requestedAt: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.requestedAt
                : event.occurredAt,
              startedAt: event.payload.session.updatedAt ?? event.occurredAt,
              completedAt: null,
              checkpointTurnCount: null,
              checkpointRef: null,
              checkpointStatus: null,
              checkpointFiles: [],
            });
          }
          yield* repository.deletePendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          return;
        }

        case "thread.message-sent": {
          if (event.payload.turnId === null || event.payload.role !== "assistant") return;
          const existingTurn = yield* repository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          if (Option.isSome(existingTurn)) {
            const existingIsTerminal =
              existingTurn.value.state === "completed" ||
              existingTurn.value.state === "error" ||
              existingTurn.value.state === "interrupted";
            yield* repository.upsertByTurnId({
              ...existingTurn.value,
              assistantMessageId: event.payload.messageId,
              state:
                event.payload.streaming && !existingIsTerminal
                  ? "running"
                  : existingTurn.value.state,
              completedAt:
                event.payload.streaming && !existingIsTerminal
                  ? null
                  : existingTurn.value.completedAt,
              startedAt: existingTurn.value.startedAt ?? event.payload.createdAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.createdAt,
            });
            return;
          }
          yield* repository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,
            sourceProposedPlanThreadId: null,
            sourceProposedPlanId: null,
            assistantMessageId: event.payload.messageId,
            state: "running",
            requestedAt: event.payload.createdAt,
            startedAt: event.payload.createdAt,
            completedAt: null,
            checkpointTurnCount: null,
            checkpointRef: null,
            checkpointStatus: null,
            checkpointFiles: [],
          });
          return;
        }

        case "thread.turn-interrupt-requested":
          return;

        case "thread.turn-diff-completed": {
          const existingTurn = yield* repository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          const isProviderDiffPlaceholder =
            event.payload.status === "missing" &&
            event.payload.checkpointRef.startsWith("provider-diff:");
          const nextState = isProviderDiffPlaceholder
            ? Option.match(existingTurn, {
                onNone: () => "running" as const,
                onSome: (turn) => turn.state,
              })
            : event.payload.status === "error"
              ? "error"
              : "completed";
          yield* repository.clearCheckpointTurnConflict({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
            checkpointTurnCount: event.payload.checkpointTurnCount,
          });
          if (Option.isSome(existingTurn)) {
            yield* repository.upsertByTurnId({
              ...existingTurn.value,
              assistantMessageId:
                event.payload.assistantMessageId ?? existingTurn.value.assistantMessageId,
              state: nextState,
              checkpointTurnCount: event.payload.checkpointTurnCount,
              checkpointRef: event.payload.checkpointRef,
              checkpointStatus: event.payload.status,
              checkpointFiles: event.payload.files,
              startedAt: existingTurn.value.startedAt ?? event.payload.completedAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.completedAt,
              completedAt: isProviderDiffPlaceholder
                ? existingTurn.value.completedAt
                : event.payload.completedAt,
            });
          } else {
            yield* repository.upsertByTurnId({
              turnId: event.payload.turnId,
              threadId: event.payload.threadId,
              pendingMessageId: null,
              sourceProposedPlanThreadId: null,
              sourceProposedPlanId: null,
              assistantMessageId: event.payload.assistantMessageId,
              state: nextState,
              requestedAt: event.payload.completedAt,
              startedAt: event.payload.completedAt,
              completedAt: isProviderDiffPlaceholder ? null : event.payload.completedAt,
              checkpointTurnCount: event.payload.checkpointTurnCount,
              checkpointRef: event.payload.checkpointRef,
              checkpointStatus: event.payload.status,
              checkpointFiles: event.payload.files,
            });
          }
          return;
        }

        case "thread.reverted": {
          const existingTurns = yield* repository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptTurns = existingTurns.filter(
            (turn) =>
              turn.turnId !== null &&
              turn.checkpointTurnCount !== null &&
              turn.checkpointTurnCount <= event.payload.turnCount,
          );
          yield* repository.deleteByThreadId({ threadId: event.payload.threadId });
          yield* Effect.forEach(
            keptTurns,
            (turn) =>
              turn.turnId === null
                ? Effect.void
                : repository.upsertByTurnId({ ...turn, turnId: turn.turnId }),
            { concurrency: 1 },
          ).pipe(Effect.asVoid);
          return;
        }

        case "thread.conversation-rolled-back": {
          const existingTurns = yield* repository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptTurns = retainProjectionTurnsAfterConversationRollback(
            existingTurns,
            new Set(event.payload.removedTurnIds ?? []),
          );
          if (keptTurns.length === existingTurns.length) return;
          yield* repository.deleteByThreadId({ threadId: event.payload.threadId });
          yield* Effect.forEach(
            keptTurns,
            (turn) =>
              turn.turnId === null
                ? turn.pendingMessageId === null ||
                  turn.state !== "pending" ||
                  turn.checkpointTurnCount !== null
                  ? Effect.void
                  : repository.replacePendingTurnStart({
                      threadId: turn.threadId,
                      messageId: turn.pendingMessageId,
                      sourceProposedPlanThreadId: turn.sourceProposedPlanThreadId,
                      sourceProposedPlanId: turn.sourceProposedPlanId,
                      requestedAt: turn.requestedAt,
                    })
                : repository.upsertByTurnId({ ...turn, turnId: turn.turnId }),
            { concurrency: 1 },
          ).pipe(Effect.asVoid);
          return;
        }
        default:
          return;
      }
    });
  return apply;
});
