import { AutomationRun } from "@agent-group/contracts";
import { Effect, Option } from "effect";

import { toPersistenceDecodeCauseError, toPersistenceSqlError } from "../../Errors.ts";
import type { AutomationRepositoryShape } from "../../Services/AutomationRepository.ts";
import type { makeRunMutationQueries } from "./runMutationQueries.ts";
import type { makeRunReadQueries } from "./runReadQueries.ts";
import { type AutomationRunDbRow, toRun, withResultDefaults } from "./rows.ts";

export function makeRunOperations(
  mutationQueries: ReturnType<typeof makeRunMutationQueries>,
  readQueries: ReturnType<typeof makeRunReadQueries>,
) {
  const {
    insertRun,
    getRunRowById,
    getRunRowByOccurrence,
    listRunRows,
    cancelRunRow,
    markRunStartedRow,
    markRunFailedRow,
    markRunSkippedRow,
    markRunSucceededRow,
    markRunResultRow,
    markRunCompletionResultRow,
    markRunInterruptedRow,
    markRunWaitingForApprovalRow,
  } = mutationQueries;
  const {
    getRunRowByThread,
    listRecoverableRunRows,
    listRunsNeedingCompletionEvaluationRows,
    countActiveRunsRow,
    countActiveRunsByThreadRow,
    countPendingCompletionEvaluationsByThreadRow,
    listActiveRunsForDefinitionRows,
  } = readQueries;
  const createRun: AutomationRepositoryShape["createRun"] = (input) => {
    const run: AutomationRun = {
      id: input.id,
      automationId: input.automationId,
      projectId: input.projectId,
      threadId: input.threadId,
      trigger: input.trigger,
      status: "pending",
      scheduledFor: input.scheduledFor,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      startedAt: null,
      finishedAt: null,
      threadCreateCommandId: input.threadCreateCommandId ?? null,
      turnStartCommandId: input.turnStartCommandId ?? null,
      messageId: input.messageId ?? null,
      error: null,
      result: null,
      permissionSnapshot: input.permissionSnapshot,
      createdAt: input.now,
      updatedAt: input.now,
    };
    const decodeInserted = (rowOption: Option.Option<AutomationRunDbRow>) =>
      Option.match(rowOption, {
        onNone: () =>
          Effect.fail(
            toPersistenceDecodeCauseError("AutomationRepository.createRun:missingRow")(
              new Error("Automation run was not inserted or found."),
            ),
          ),
        onSome: toRun,
      });
    const decodeInsertedOrActiveThread = (rowOption: Option.Option<AutomationRunDbRow>) =>
      Option.match(rowOption, {
        onSome: toRun,
        onNone: () =>
          input.threadId
            ? getRunRowByThread({ threadId: input.threadId }).pipe(
                Effect.mapError(
                  toPersistenceSqlError("AutomationRepository.createRun:selectActiveThread"),
                ),
                Effect.flatMap(decodeInserted),
              )
            : decodeInserted(rowOption),
      });
    const inserted = insertRun({
      ...run,
      turnId: null,
      triggerType: run.trigger.type,
    }).pipe(Effect.mapError(toPersistenceSqlError("AutomationRepository.createRun:insert")));
    // Scheduled runs dedupe on (automationId, scheduledFor) via INSERT OR IGNORE +
    // the partial unique index, so a re-run of the same occurrence returns the existing
    // row. Manual runs are never deduped and are read back by their own run id.
    if (run.trigger.type === "scheduled") {
      return inserted.pipe(
        Effect.flatMap(() =>
          getRunRowByOccurrence({
            automationId: input.automationId,
            scheduledFor: input.scheduledFor,
          }).pipe(
            Effect.mapError(toPersistenceSqlError("AutomationRepository.createRun:select")),
            Effect.flatMap(decodeInsertedOrActiveThread),
          ),
        ),
      );
    }
    return inserted.pipe(
      Effect.flatMap(() =>
        getRunRowById({ id: input.id }).pipe(
          Effect.mapError(toPersistenceSqlError("AutomationRepository.createRun:select")),
          Effect.flatMap(decodeInsertedOrActiveThread),
        ),
      ),
    );
  };

  const getRunById: AutomationRepositoryShape["getRunById"] = (input) =>
    getRunRowById(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.getRunById:query")),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) => toRun(row).pipe(Effect.map(Option.some)),
        }),
      ),
    );

  const requireRunById = (id: AutomationRunDbRow["id"], operation: string) =>
    getRunById({ id }).pipe(
      Effect.flatMap((runOption) =>
        Option.match(runOption, {
          onNone: () =>
            Effect.fail(
              toPersistenceSqlError(`${operation}:missingRow`)(
                new Error("Automation run was not found after update."),
              ),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

  const markRunStarted: AutomationRepositoryShape["markRunStarted"] = (input) =>
    markRunStartedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.markRunStarted:update")),
      Effect.flatMap(() => requireRunById(input.id, "AutomationRepository.markRunStarted")),
    );

  const markRunFailed: AutomationRepositoryShape["markRunFailed"] = (input) =>
    markRunFailedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.markRunFailed:update")),
      Effect.flatMap(() => requireRunById(input.id, "AutomationRepository.markRunFailed")),
    );

  const markRunSkipped: AutomationRepositoryShape["markRunSkipped"] = (input) =>
    markRunSkippedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.markRunSkipped:update")),
      Effect.flatMap(() => requireRunById(input.id, "AutomationRepository.markRunSkipped")),
    );

  const markRunSucceeded: AutomationRepositoryShape["markRunSucceeded"] = (input) =>
    markRunSucceededRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.markRunSucceeded:update")),
      Effect.flatMap(() => requireRunById(input.id, "AutomationRepository.markRunSucceeded")),
    );

  const markRunResult: AutomationRepositoryShape["markRunResult"] = (input) =>
    markRunResultRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.markRunResult:update")),
      Effect.flatMap(() => requireRunById(input.id, "AutomationRepository.markRunResult")),
    );

  const markRunCompletionResult: AutomationRepositoryShape["markRunCompletionResult"] = (input) =>
    markRunCompletionResultRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.markRunCompletionResult:update")),
      Effect.flatMap(() =>
        requireRunById(input.id, "AutomationRepository.markRunCompletionResult"),
      ),
    );

  const markRunInterrupted: AutomationRepositoryShape["markRunInterrupted"] = (input) =>
    markRunInterruptedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.markRunInterrupted:update")),
      Effect.flatMap(() => requireRunById(input.id, "AutomationRepository.markRunInterrupted")),
    );

  const markRunWaitingForApproval: AutomationRepositoryShape["markRunWaitingForApproval"] = (
    input,
  ) =>
    markRunWaitingForApprovalRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("AutomationRepository.markRunWaitingForApproval:update"),
      ),
      Effect.flatMap(() =>
        requireRunById(input.id, "AutomationRepository.markRunWaitingForApproval"),
      ),
    );

  const cancelRun: AutomationRepositoryShape["cancelRun"] = ({ runId, now }) =>
    cancelRunRow({ id: runId, now }).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.cancelRun:update")),
      Effect.flatMap(() => requireRunById(runId, "AutomationRepository.cancelRun")),
    );

  const getRunByThreadId: AutomationRepositoryShape["getRunByThreadId"] = (input) =>
    getRunRowByThread(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.getRunByThreadId:query")),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) => toRun(row).pipe(Effect.map(Option.some)),
        }),
      ),
    );

  const listRecoverableRuns: AutomationRepositoryShape["listRecoverableRuns"] = (input) =>
    listRecoverableRunRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.listRecoverableRuns:query")),
      Effect.flatMap((rows) => Effect.forEach(rows, toRun, { concurrency: "unbounded" })),
    );

  const listRunsNeedingCompletionEvaluation: AutomationRepositoryShape["listRunsNeedingCompletionEvaluation"] =
    (input) =>
      listRunsNeedingCompletionEvaluationRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("AutomationRepository.listRunsNeedingCompletionEvaluation:query"),
        ),
        Effect.flatMap((rows) => Effect.forEach(rows, toRun, { concurrency: "unbounded" })),
      );

  const countActiveRunsForDefinition: AutomationRepositoryShape["countActiveRunsForDefinition"] = (
    input,
  ) =>
    countActiveRunsRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("AutomationRepository.countActiveRunsForDefinition:query"),
      ),
      Effect.map((rows) => rows[0]?.count ?? 0),
    );

  const countActiveRunsForThread: AutomationRepositoryShape["countActiveRunsForThread"] = (input) =>
    countActiveRunsByThreadRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.countActiveRunsForThread:query")),
      Effect.map((rows) => rows[0]?.count ?? 0),
    );

  const countPendingCompletionEvaluationsForThread: AutomationRepositoryShape["countPendingCompletionEvaluationsForThread"] =
    (input) =>
      countPendingCompletionEvaluationsByThreadRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "AutomationRepository.countPendingCompletionEvaluationsForThread:query",
          ),
        ),
        Effect.map((rows) => rows[0]?.count ?? 0),
      );

  const listActiveRunsForDefinition: AutomationRepositoryShape["listActiveRunsForDefinition"] = (
    input,
  ) =>
    listActiveRunsForDefinitionRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("AutomationRepository.listActiveRunsForDefinition:query"),
      ),
      Effect.flatMap((rows) => Effect.forEach(rows, toRun, { concurrency: "unbounded" })),
    );

  const markRunRead: AutomationRepositoryShape["markRunRead"] = ({ runId, unread, now }) =>
    requireRunById(runId, "AutomationRepository.markRunRead:load").pipe(
      Effect.flatMap((run) =>
        markRunResult({
          id: run.id,
          result: { ...withResultDefaults(run), unread },
          updatedAt: now,
        }),
      ),
    );

  const archiveRun: AutomationRepositoryShape["archiveRun"] = ({ runId, archived, now }) =>
    requireRunById(runId, "AutomationRepository.archiveRun:load").pipe(
      Effect.flatMap((run) =>
        markRunResult({
          id: run.id,
          result: {
            ...withResultDefaults(run),
            unread: archived ? false : withResultDefaults(run).unread,
            archivedAt: archived ? now : null,
          },
          updatedAt: now,
        }),
      ),
    );
  return {
    createRun,
    getRunById,
    markRunStarted,
    markRunFailed,
    markRunSkipped,
    markRunSucceeded,
    markRunResult,
    markRunCompletionResult,
    markRunInterrupted,
    markRunWaitingForApproval,
    cancelRun,
    getRunByThreadId,
    listRecoverableRuns,
    listRunsNeedingCompletionEvaluation,
    countActiveRunsForDefinition,
    countActiveRunsForThread,
    countPendingCompletionEvaluationsForThread,
    listActiveRunsForDefinition,
    markRunRead,
    archiveRun,
    listRunRows,
  };
}
