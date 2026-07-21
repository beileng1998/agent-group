import { Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  CountActiveAutomationRunsByThreadInput,
  CountActiveAutomationRunsInput,
  CountPendingCompletionEvaluationsByThreadInput,
  GetAutomationRunByThreadInput,
  ListActiveAutomationRunsForDefinitionInput,
  ListAutomationRunsNeedingCompletionEvaluationInput,
  ListRecoverableAutomationRunsInput,
} from "../../Services/AutomationRepository.ts";
import { AutomationRunDbRow } from "./rows.ts";

export function makeRunReadQueries(sql: SqlClient.SqlClient) {
  const getRunRowByThread = SqlSchema.findOneOption({
    Request: GetAutomationRunByThreadInput,
    Result: AutomationRunDbRow,
    execute: ({ threadId }) =>
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
        WHERE thread_id = ${threadId}
          AND status IN ('pending', 'claimed', 'running', 'waiting-for-approval')
        ORDER BY created_at DESC, run_id DESC
        LIMIT 1
      `,
  });

  const listRecoverableRunRows = SqlSchema.findAll({
    Request: ListRecoverableAutomationRunsInput,
    Result: AutomationRunDbRow,
    execute: ({ limit }) =>
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
        WHERE status IN ('pending', 'claimed', 'running', 'waiting-for-approval')
        ORDER BY created_at ASC, run_id ASC
        LIMIT ${limit}
      `,
  });

  const listRunsNeedingCompletionEvaluationRows = SqlSchema.findAll({
    Request: ListAutomationRunsNeedingCompletionEvaluationInput,
    Result: AutomationRunDbRow,
    execute: ({ limit }) =>
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
        INNER JOIN automation_pending_completion_evaluations pending
          ON pending.run_id = runs.run_id
        ORDER BY pending.finished_at ASC, pending.run_id ASC
        LIMIT ${limit}
      `,
  });

  const countActiveRunsRow = SqlSchema.findAll({
    Request: CountActiveAutomationRunsInput,
    Result: Schema.Struct({ count: Schema.Number }),
    execute: ({ automationId }) =>
      sql`
        SELECT COUNT(*) AS "count"
        FROM automation_runs
        WHERE automation_id = ${automationId}
          AND status IN ('pending', 'claimed', 'running', 'waiting-for-approval')
      `,
  });

  const countActiveRunsByThreadRow = SqlSchema.findAll({
    Request: CountActiveAutomationRunsByThreadInput,
    Result: Schema.Struct({ count: Schema.Number }),
    execute: ({ threadId }) =>
      sql`
        SELECT COUNT(*) AS "count"
        FROM automation_runs
        WHERE thread_id = ${threadId}
          AND status IN ('pending', 'claimed', 'running', 'waiting-for-approval')
      `,
  });

  const countPendingCompletionEvaluationsByThreadRow = SqlSchema.findAll({
    Request: CountPendingCompletionEvaluationsByThreadInput,
    Result: Schema.Struct({ count: Schema.Number }),
    execute: ({ threadId }) =>
      sql`
        SELECT COUNT(*) AS "count"
        FROM automation_pending_completion_evaluations pending
        WHERE pending.thread_id = ${threadId}
      `,
  });

  const listActiveRunsForDefinitionRows = SqlSchema.findAll({
    Request: ListActiveAutomationRunsForDefinitionInput,
    Result: AutomationRunDbRow,
    execute: ({ automationId }) =>
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
          AND status IN ('pending', 'claimed', 'running', 'waiting-for-approval')
        ORDER BY created_at ASC, run_id ASC
      `,
  });
  return {
    getRunRowByThread,
    listRecoverableRunRows,
    listRunsNeedingCompletionEvaluationRows,
    countActiveRunsRow,
    countActiveRunsByThreadRow,
    countPendingCompletionEvaluationsByThreadRow,
    listActiveRunsForDefinitionRows,
  };
}
