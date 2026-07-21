import { AutomationRun, ProjectId } from "@agent-group/contracts";
import { Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  MarkAutomationRunFailedInput,
  GetAutomationRunInput,
  MarkAutomationRunInterruptedInput,
  MarkAutomationRunResultInput,
  MarkAutomationRunSkippedInput,
  MarkAutomationRunStartedInput,
  MarkAutomationRunSucceededInput,
  MarkAutomationRunWaitingForApprovalInput,
} from "../../Services/AutomationRepository.ts";
import { AutomationRunDbRow, MAX_RUN_LIST_ROWS } from "./rows.ts";

export function makeRunMutationQueries(sql: SqlClient.SqlClient) {
  const insertRun = SqlSchema.void({
    Request: AutomationRunDbRow,
    execute: (run) =>
      sql`
        INSERT OR IGNORE INTO automation_runs (
          run_id,
          automation_id,
          project_id,
          thread_id,
          turn_id,
          trigger_type,
          status,
          scheduled_for,
          claimed_by,
          claimed_at,
          lease_expires_at,
          started_at,
          finished_at,
          thread_create_command_id,
          turn_start_command_id,
          message_id,
          error,
          result_json,
          permission_snapshot_json,
          created_at,
          updated_at
        )
        SELECT
          ${run.id},
          ${run.automationId},
          ${run.projectId},
          ${run.threadId},
          ${run.turnId},
          ${run.triggerType},
          ${run.status},
          ${run.scheduledFor},
          ${run.claimedBy},
          ${run.claimedAt},
          ${run.leaseExpiresAt},
          ${run.startedAt},
          ${run.finishedAt},
          ${run.threadCreateCommandId},
          ${run.turnStartCommandId},
          ${run.messageId},
          ${run.error},
          ${run.result},
          ${run.permissionSnapshot},
          ${run.createdAt},
          ${run.updatedAt}
        WHERE ${run.threadId} IS NULL
           OR NOT EXISTS (
             SELECT 1
             FROM automation_runs
             WHERE thread_id = ${run.threadId}
               AND status IN ('pending', 'claimed', 'running', 'waiting-for-approval')
           )
      `,
  });

  const getRunRowById = SqlSchema.findOneOption({
    Request: GetAutomationRunInput,
    Result: AutomationRunDbRow,
    execute: ({ id }) =>
      sql`
        SELECT
          run_id AS "id",
          automation_id AS "automationId",
          project_id AS "projectId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          trigger_type AS "triggerType",
          status,
          scheduled_for AS "scheduledFor",
          claimed_by AS "claimedBy",
          claimed_at AS "claimedAt",
          lease_expires_at AS "leaseExpiresAt",
          started_at AS "startedAt",
          finished_at AS "finishedAt",
          thread_create_command_id AS "threadCreateCommandId",
          turn_start_command_id AS "turnStartCommandId",
          message_id AS "messageId",
          error,
          result_json AS "result",
          permission_snapshot_json AS "permissionSnapshot",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM automation_runs
        WHERE run_id = ${id}
      `,
  });

  const getRunRowByOccurrence = SqlSchema.findOneOption({
    Request: Schema.Struct({
      automationId: AutomationRun.fields.automationId,
      scheduledFor: AutomationRun.fields.scheduledFor,
    }),
    Result: AutomationRunDbRow,
    execute: ({ automationId, scheduledFor }) =>
      sql`
        SELECT
          run_id AS "id",
          automation_id AS "automationId",
          project_id AS "projectId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          trigger_type AS "triggerType",
          status,
          scheduled_for AS "scheduledFor",
          claimed_by AS "claimedBy",
          claimed_at AS "claimedAt",
          lease_expires_at AS "leaseExpiresAt",
          started_at AS "startedAt",
          finished_at AS "finishedAt",
          thread_create_command_id AS "threadCreateCommandId",
          turn_start_command_id AS "turnStartCommandId",
          message_id AS "messageId",
          error,
          result_json AS "result",
          permission_snapshot_json AS "permissionSnapshot",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM automation_runs
        WHERE automation_id = ${automationId}
          AND scheduled_for = ${scheduledFor}
          AND trigger_type = 'scheduled'
      `,
  });

  const listRunRows = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: Schema.optional(ProjectId),
      includeArchived: Schema.Boolean,
    }),
    Result: AutomationRunDbRow,
    execute: ({ projectId, includeArchived }) =>
      sql`
        SELECT
          runs.run_id AS "id",
          runs.automation_id AS "automationId",
          runs.project_id AS "projectId",
          runs.thread_id AS "threadId",
          runs.turn_id AS "turnId",
          runs.trigger_type AS "triggerType",
          runs.status,
          runs.scheduled_for AS "scheduledFor",
          runs.claimed_by AS "claimedBy",
          runs.claimed_at AS "claimedAt",
          runs.lease_expires_at AS "leaseExpiresAt",
          runs.started_at AS "startedAt",
          runs.finished_at AS "finishedAt",
          runs.thread_create_command_id AS "threadCreateCommandId",
          runs.turn_start_command_id AS "turnStartCommandId",
          runs.message_id AS "messageId",
          runs.error,
          runs.result_json AS "result",
          runs.permission_snapshot_json AS "permissionSnapshot",
          runs.created_at AS "createdAt",
          runs.updated_at AS "updatedAt"
        FROM automation_runs runs
        INNER JOIN automation_definitions definitions
          ON definitions.automation_id = runs.automation_id
        WHERE (${projectId ?? null} IS NULL OR runs.project_id = ${projectId ?? null})
          AND (${includeArchived ? 1 : 0} = 1 OR definitions.archived_at IS NULL)
        ORDER BY runs.scheduled_for DESC, runs.run_id DESC
        LIMIT ${MAX_RUN_LIST_ROWS}
      `,
  });

  const cancelRunRow = SqlSchema.void({
    Request: Schema.Struct({
      id: GetAutomationRunInput.fields.id,
      now: Schema.String,
    }),
    execute: ({ id, now }) =>
      sql`
        UPDATE automation_runs
        SET status = 'cancelled',
            finished_at = ${now},
            updated_at = ${now},
            lease_expires_at = NULL,
            claimed_by = NULL
        WHERE run_id = ${id}
          AND status IN ('pending', 'claimed', 'running', 'waiting-for-approval')
      `,
  });

  const markRunStartedRow = SqlSchema.void({
    Request: MarkAutomationRunStartedInput,
    execute: ({ id, threadId, messageId, threadCreateCommandId, turnStartCommandId, startedAt }) =>
      sql`
        UPDATE automation_runs
        SET status = 'running',
            thread_id = ${threadId},
            message_id = ${messageId},
            thread_create_command_id = ${threadCreateCommandId},
            turn_start_command_id = ${turnStartCommandId},
            started_at = ${startedAt},
            updated_at = ${startedAt}
        WHERE run_id = ${id}
          AND status IN ('pending', 'claimed', 'waiting-for-approval')
      `,
  });

  const markRunFailedRow = SqlSchema.void({
    Request: MarkAutomationRunFailedInput,
    execute: ({ id, error, finishedAt }) =>
      sql`
        UPDATE automation_runs
        SET status = 'failed',
            error = ${error},
            finished_at = ${finishedAt},
            updated_at = ${finishedAt},
            lease_expires_at = NULL,
            claimed_by = NULL
        WHERE run_id = ${id}
          AND status NOT IN ('succeeded', 'failed', 'cancelled', 'interrupted')
      `,
  });

  const markRunSkippedRow = SqlSchema.void({
    Request: MarkAutomationRunSkippedInput,
    execute: ({ id, reason, finishedAt }) =>
      sql`
        UPDATE automation_runs
        SET status = 'skipped',
            error = ${reason},
            finished_at = ${finishedAt},
            updated_at = ${finishedAt},
            lease_expires_at = NULL,
            claimed_by = NULL
        WHERE run_id = ${id}
          AND status IN ('pending', 'claimed')
      `,
  });

  const markRunSucceededRow = SqlSchema.void({
    Request: MarkAutomationRunSucceededInput,
    execute: ({ id, turnId, result, finishedAt }) =>
      sql`
        UPDATE automation_runs
        SET status = 'succeeded',
            turn_id = COALESCE(${turnId}, turn_id),
            result_json = ${result === null ? null : JSON.stringify(result)},
            finished_at = ${finishedAt},
            updated_at = ${finishedAt},
            lease_expires_at = NULL,
            claimed_by = NULL
        WHERE run_id = ${id}
          AND status NOT IN ('succeeded', 'failed', 'cancelled', 'interrupted')
      `,
  });

  const markRunResultRow = SqlSchema.void({
    Request: MarkAutomationRunResultInput,
    execute: ({ id, result, updatedAt }) =>
      sql`
        UPDATE automation_runs
        SET result_json = ${result === null ? null : JSON.stringify(result)},
            updated_at = ${updatedAt}
        WHERE run_id = ${id}
      `,
  });

  // Writes a new result but carries the triage fields (archivedAt/unread) over from the
  // existing row atomically, so a background completion evaluation can never clobber a
  // concurrent user archive/mark-read landing between the run reload and this write.
  // unread is round-tripped through json() so it stays a JSON boolean rather than the
  // 0/1 that json_extract yields.
  const markRunCompletionResultRow = SqlSchema.void({
    Request: MarkAutomationRunResultInput,
    execute: ({ id, result, updatedAt }) =>
      result === null
        ? sql`
            UPDATE automation_runs
            SET result_json = NULL, updated_at = ${updatedAt}
            WHERE run_id = ${id}
          `
        : sql`
            UPDATE automation_runs
            SET result_json = CASE
                  WHEN result_json IS NULL THEN ${JSON.stringify(result)}
                  ELSE json_set(
                    json_set(
                      ${JSON.stringify(result)},
                      '$.archivedAt',
                      json_extract(result_json, '$.archivedAt')
                    ),
                    '$.unread',
                    json(
                      CASE
                        -- Existing row has no boolean unread (legacy/null): fall back to the
                        -- incoming result's value rather than implicitly defaulting to unread.
                        WHEN json_extract(result_json, '$.unread') IS NULL THEN
                          CASE WHEN json_extract(${JSON.stringify(result)}, '$.unread') = 0
                            THEN 'false' ELSE 'true' END
                        WHEN json_extract(result_json, '$.unread') = 0 THEN 'false'
                        ELSE 'true'
                      END
                    )
                  )
                END,
                updated_at = ${updatedAt}
            WHERE run_id = ${id}
          `,
  });

  const markRunInterruptedRow = SqlSchema.void({
    Request: MarkAutomationRunInterruptedInput,
    execute: ({ id, turnId, finishedAt }) =>
      sql`
        UPDATE automation_runs
        SET status = 'interrupted',
            turn_id = COALESCE(${turnId}, turn_id),
            finished_at = ${finishedAt},
            updated_at = ${finishedAt},
            lease_expires_at = NULL,
            claimed_by = NULL
        WHERE run_id = ${id}
          AND status NOT IN ('succeeded', 'failed', 'cancelled', 'interrupted')
      `,
  });

  const markRunWaitingForApprovalRow = SqlSchema.void({
    Request: MarkAutomationRunWaitingForApprovalInput,
    execute: ({ id, turnId, updatedAt }) =>
      sql`
        UPDATE automation_runs
        SET status = 'waiting-for-approval',
            turn_id = COALESCE(${turnId}, turn_id),
            updated_at = ${updatedAt}
        WHERE run_id = ${id}
          AND status IN ('pending', 'claimed', 'running')
      `,
  });
  return {
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
  };
}
