import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
  ProjectId,
  ThreadId,
} from "@agent-group/contracts";
import { Cause, Deferred, Effect, Option, PubSub, Ref, Schema, Semaphore, Stream } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../../../persistence/Errors.ts";
import type { OrchestrationEventStoreShape } from "../../../persistence/Services/OrchestrationEventStore.ts";
import type { OrchestrationCommandReceiptRepositoryShape } from "../../../persistence/Services/OrchestrationCommandReceipts.ts";
import {
  OrchestrationCommandInvariantError,
  OrchestrationCommandPreviouslyRejectedError,
  OrchestrationCommandTimeoutError,
  type OrchestrationDispatchError,
} from "../../Errors.ts";
import { decideOrchestrationCommand } from "../../decider.ts";
import type { ProjectMetadataOrchestrationEvent } from "../../projectMetadataProjection.ts";
import { projectEvent } from "../../projector.ts";
import type { OrchestrationProjectionPipelineShape } from "../../Services/ProjectionPipeline.ts";
import {
  makeCommandInternalError,
  makeCommandTimeoutError,
  type CommandEnvelope,
  type CommandReadModelState,
} from "./commandRuntime.ts";

type CommittedCommandResult = {
  readonly committedEvents: OrchestrationEvent[];
  readonly lastSequence: number;
  readonly nextCommandReadModel: OrchestrationReadModel;
};

const commandToAggregateRef = (
  command: OrchestrationCommand,
): {
  readonly aggregateKind: "project" | "thread";
  readonly aggregateId: ProjectId | ThreadId;
} => {
  switch (command.type) {
    case "project.create":
    case "project.meta.update":
    case "project.delete":
      return { aggregateKind: "project", aggregateId: command.projectId };
    default:
      return { aggregateKind: "thread", aggregateId: command.threadId };
  }
};

const isProjectMetadataEvent = (
  event: OrchestrationEvent,
): event is ProjectMetadataOrchestrationEvent =>
  event.type === "project.created" ||
  event.type === "project.meta-updated" ||
  event.type === "project.deleted";

export const makeCommandProcessor = (input: {
  readonly sql: SqlClient;
  readonly eventStore: OrchestrationEventStoreShape;
  readonly commandReceiptRepository: OrchestrationCommandReceiptRepositoryShape;
  readonly projectionPipeline: OrchestrationProjectionPipelineShape;
  readonly eventPubSub: PubSub.PubSub<OrchestrationEvent>;
  readonly maintenanceLock: Semaphore.Semaphore;
  readonly commandReadModel: CommandReadModelState;
  readonly buildDeciderReadModel: (
    command: OrchestrationCommand,
  ) => Effect.Effect<OrchestrationReadModel, OrchestrationDispatchError>;
  readonly projectDeferredEvents: (
    events: ReadonlyArray<OrchestrationEvent>,
  ) => Effect.Effect<void, never>;
}) => {
  const resolveStoredCommandOutcome = (
    command: OrchestrationCommand,
  ): Effect.Effect<{ sequence: number }, OrchestrationDispatchError, never> =>
    Effect.gen(function* () {
      const receiptExit = yield* Effect.exit(
        input.commandReceiptRepository.getByCommandId({ commandId: command.commandId }),
      );
      const existingReceipt = receiptExit._tag === "Success" ? receiptExit.value : Option.none();
      if (Option.isNone(existingReceipt)) return yield* makeCommandTimeoutError(command);
      if (existingReceipt.value.status === "accepted") {
        return { sequence: existingReceipt.value.resultSequence };
      }
      return yield* new OrchestrationCommandPreviouslyRejectedError({
        commandId: command.commandId,
        detail: existingReceipt.value.error ?? "Previously rejected.",
      });
    });

  return (envelope: CommandEnvelope): Effect.Effect<void, never> => {
    const dispatchStartSequence = input.commandReadModel.get().snapshotSequence;
    const remainingBudgetMs = Math.max(0, envelope.deadlineAtMs - Date.now());

    const reconcileAfterDispatchFailure = Effect.gen(function* () {
      const persistedEvents = yield* Stream.runCollect(
        input.eventStore.readFromSequence(dispatchStartSequence),
      ).pipe(Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)));
      if (persistedEvents.length === 0) return;

      let nextModel = input.commandReadModel.get();
      for (const event of persistedEvents) nextModel = yield* projectEvent(nextModel, event);
      input.commandReadModel.set(nextModel);
      for (const event of persistedEvents) yield* PubSub.publish(input.eventPubSub, event);
    });

    const runCommand = Effect.gen(function* () {
      const shouldSkip = yield* Ref.modify(envelope.executionState, (state) =>
        state === "abandoned" ? ([true, state] as const) : ([false, "in-flight"] as const),
      );
      if (shouldSkip) return;
      if (remainingBudgetMs === 0) return yield* makeCommandTimeoutError(envelope.command);

      const existingReceipt = yield* input.commandReceiptRepository.getByCommandId({
        commandId: envelope.command.commandId,
      });
      if (Option.isSome(existingReceipt)) {
        if (existingReceipt.value.status === "accepted") {
          yield* Deferred.succeed(envelope.result, {
            sequence: existingReceipt.value.resultSequence,
          });
        } else {
          yield* Deferred.fail(
            envelope.result,
            new OrchestrationCommandPreviouslyRejectedError({
              commandId: envelope.command.commandId,
              detail: existingReceipt.value.error ?? "Previously rejected.",
            }),
          );
        }
        return;
      }

      const deciderReadModel = yield* input.buildDeciderReadModel(envelope.command);
      const eventBase = yield* decideOrchestrationCommand({
        command: envelope.command,
        readModel: deciderReadModel,
      });
      const eventBases = Array.isArray(eventBase) ? eventBase : [eventBase];
      const transactionalCommit: Effect.Effect<
        CommittedCommandResult,
        OrchestrationDispatchError,
        never
      > = Effect.gen(function* () {
        const committedEvents: OrchestrationEvent[] = [];
        let nextCommandReadModel = input.commandReadModel.get();

        for (const nextEvent of eventBases) {
          const savedEvent = yield* input.eventStore.append(nextEvent);
          nextCommandReadModel = yield* projectEvent(nextCommandReadModel, savedEvent);
          if (isProjectMetadataEvent(savedEvent)) {
            yield* input.projectionPipeline.projectMetadataEvent(savedEvent);
          } else {
            yield* input.projectionPipeline.projectHotEvent(savedEvent);
          }
          committedEvents.push(savedEvent);
        }

        const lastSavedEvent = committedEvents.at(-1) ?? null;
        if (lastSavedEvent === null) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: envelope.command.type,
            detail: "Command produced no events.",
          });
        }

        yield* input.commandReceiptRepository.upsert({
          commandId: envelope.command.commandId,
          aggregateKind: lastSavedEvent.aggregateKind,
          aggregateId: lastSavedEvent.aggregateId,
          acceptedAt: lastSavedEvent.occurredAt,
          resultSequence: lastSavedEvent.sequence,
          status: "accepted",
          error: null,
        });
        return {
          committedEvents,
          lastSequence: lastSavedEvent.sequence,
          nextCommandReadModel,
        } as const;
      }).pipe(
        Effect.catchCause((cause): Effect.Effect<never, OrchestrationDispatchError, never> => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
          return Effect.logError(
            "orchestration command crashed inside persistence transaction",
          ).pipe(
            Effect.annotateLogs({
              commandId: envelope.command.commandId,
              commandType: envelope.command.type,
              cause: Cause.pretty(cause),
            }),
            Effect.flatMap(() =>
              Effect.fail(
                makeCommandInternalError(
                  envelope.command,
                  "The command hit an unexpected internal error before it could be saved.",
                ),
              ),
            ),
          );
        }),
      );

      const committedCommand = yield* input.sql
        .withTransaction(transactionalCommit)
        .pipe(
          Effect.catchTag("SqlError", (sqlError) =>
            Effect.fail(
              toPersistenceSqlError("OrchestrationEngine.processEnvelope:transaction")(sqlError),
            ),
          ),
        );
      input.commandReadModel.set(committedCommand.nextCommandReadModel);
      yield* input.projectDeferredEvents(committedCommand.committedEvents);
      for (const event of committedCommand.committedEvents) {
        yield* PubSub.publish(input.eventPubSub, event);
      }
      yield* Deferred.succeed(envelope.result, { sequence: committedCommand.lastSequence });
    }).pipe(
      Effect.timeoutOption(remainingBudgetMs),
      Effect.flatMap((outcome) =>
        Option.match(outcome, {
          onNone: () => Effect.fail(makeCommandTimeoutError(envelope.command)),
          onSome: Effect.succeed,
        }),
      ),
      Effect.catch((error: OrchestrationDispatchError) =>
        Effect.gen(function* () {
          yield* reconcileAfterDispatchFailure.pipe(
            Effect.catch(() =>
              Effect.logWarning(
                "failed to reconcile orchestration read model after dispatch failure",
              ).pipe(
                Effect.annotateLogs({
                  commandId: envelope.command.commandId,
                  snapshotSequence: input.commandReadModel.get().snapshotSequence,
                }),
              ),
            ),
          );

          if (Schema.is(OrchestrationCommandTimeoutError)(error)) {
            const resolved = yield* resolveStoredCommandOutcome(envelope.command).pipe(
              Effect.match({
                onFailure: (left) => ({ _tag: "Left" as const, left }),
                onSuccess: (right) => ({ _tag: "Right" as const, right }),
              }),
            );
            if (resolved._tag === "Right") {
              yield* Deferred.succeed(envelope.result, resolved.right);
              return;
            }
            error = resolved.left;
          }

          if (Schema.is(OrchestrationCommandInvariantError)(error)) {
            const aggregateRef = commandToAggregateRef(envelope.command);
            yield* input.commandReceiptRepository
              .upsert({
                commandId: envelope.command.commandId,
                aggregateKind: aggregateRef.aggregateKind,
                aggregateId: aggregateRef.aggregateId,
                acceptedAt: new Date().toISOString(),
                resultSequence: input.commandReadModel.get().snapshotSequence,
                status: "rejected",
                error: error.message,
              })
              .pipe(Effect.catch(() => Effect.void));
          }
          yield* Deferred.fail(envelope.result, error);
        }),
      ),
      Effect.catchCause((cause): Effect.Effect<void, never, never> => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
        return Effect.gen(function* () {
          yield* reconcileAfterDispatchFailure.pipe(
            Effect.catch(() =>
              Effect.logWarning(
                "failed to reconcile orchestration read model after unexpected worker failure",
              ).pipe(
                Effect.annotateLogs({
                  commandId: envelope.command.commandId,
                  snapshotSequence: input.commandReadModel.get().snapshotSequence,
                }),
              ),
            ),
          );
          yield* Effect.logError("orchestration worker crashed while processing command").pipe(
            Effect.annotateLogs({
              commandId: envelope.command.commandId,
              commandType: envelope.command.type,
              cause: Cause.pretty(cause),
            }),
          );

          const resolved = yield* resolveStoredCommandOutcome(envelope.command).pipe(
            Effect.match({
              onFailure: (left) => ({ _tag: "Left" as const, left }),
              onSuccess: (right) => ({ _tag: "Right" as const, right }),
            }),
          );
          if (resolved._tag === "Right") {
            yield* Deferred.succeed(envelope.result, resolved.right);
            return;
          }
          yield* Deferred.fail(
            envelope.result,
            Schema.is(OrchestrationCommandTimeoutError)(resolved.left)
              ? makeCommandInternalError(envelope.command)
              : resolved.left,
          );
        });
      }),
    );

    return input.maintenanceLock.withPermits(1)(runCommand);
  };
};
