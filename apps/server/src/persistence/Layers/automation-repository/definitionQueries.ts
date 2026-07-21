import { AutomationDefinition, ProjectId } from "@agent-group/contracts";
import { Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  ArchiveAutomationDefinitionInput,
  DisableAutomationDefinitionIfUnchangedInput,
  DisableAutomationDefinitionInput,
  GetAutomationDefinitionInput,
  GetEarliestAutomationNextRunAtInput,
  IncrementAutomationIterationInput,
  ListDueAutomationDefinitionsInput,
  RestartAutomationDefinitionLoopInput,
  SetAutomationDefinitionNextRunAtInput,
} from "../../Services/AutomationRepository.ts";
import { AutomationDefinitionDbRow } from "./rows.ts";

export function makeDefinitionQueries(sql: SqlClient.SqlClient) {
  const insertDefinition = SqlSchema.void({
    Request: AutomationDefinitionDbRow,
    execute: (definition) =>
      sql`
        INSERT INTO automation_definitions (
          automation_id,
          project_id,
          source_thread_id,
          name,
          prompt,
          schedule_json,
          enabled,
          next_run_at,
          model_selection_json,
          provider_options_json,
          runtime_mode,
          interaction_mode,
          worktree_mode,
          mode,
          target_thread_id,
          max_iterations,
          stop_on_error,
          completion_policy_json,
          completion_policy_version,
          completion_policy_updated_at,
          minimum_interval_seconds,
          max_runtime_seconds,
          retry_policy_json,
          misfire_policy,
          acknowledged_risks_json,
          iteration_count,
          created_at,
          updated_at,
          archived_at
        )
        VALUES (
          ${definition.id},
          ${definition.projectId},
          ${definition.sourceThreadId},
          ${definition.name},
          ${definition.prompt},
          ${definition.schedule},
          ${definition.enabled},
          ${definition.nextRunAt},
          ${definition.modelSelection},
          ${definition.providerOptions},
          ${definition.runtimeMode},
          ${definition.interactionMode},
          ${definition.worktreeMode},
          ${definition.mode},
          ${definition.targetThreadId},
          ${definition.maxIterations},
          ${definition.stopOnError},
          ${definition.completionPolicy},
          ${definition.completionPolicyVersion},
          ${definition.completionPolicyUpdatedAt},
          ${definition.minimumIntervalSeconds},
          ${definition.maxRuntimeSeconds},
          ${definition.retryPolicy},
          ${definition.misfirePolicy},
          ${definition.acknowledgedRisks},
          ${definition.iterationCount},
          ${definition.createdAt},
          ${definition.updatedAt},
          ${definition.archivedAt}
        )
      `,
  });

  const getDefinitionRow = SqlSchema.findOneOption({
    Request: GetAutomationDefinitionInput,
    Result: AutomationDefinitionDbRow,
    execute: ({ id }) =>
      sql`
        SELECT
          automation_id AS "id",
          project_id AS "projectId",
          source_thread_id AS "sourceThreadId",
          name,
          prompt,
          schedule_json AS "schedule",
          enabled,
          next_run_at AS "nextRunAt",
          model_selection_json AS "modelSelection",
          provider_options_json AS "providerOptions",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          worktree_mode AS "worktreeMode",
          mode,
          target_thread_id AS "targetThreadId",
          max_iterations AS "maxIterations",
          stop_on_error AS "stopOnError",
          completion_policy_json AS "completionPolicy",
          completion_policy_version AS "completionPolicyVersion",
          COALESCE(
            completion_policy_updated_at,
            updated_at,
            created_at,
            '1970-01-01T00:00:00.000Z'
          ) AS "completionPolicyUpdatedAt",
          minimum_interval_seconds AS "minimumIntervalSeconds",
          max_runtime_seconds AS "maxRuntimeSeconds",
          retry_policy_json AS "retryPolicy",
          misfire_policy AS "misfirePolicy",
          acknowledged_risks_json AS "acknowledgedRisks",
          iteration_count AS "iterationCount",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt"
        FROM automation_definitions
        WHERE automation_id = ${id}
      `,
  });

  const updateDefinitionRow = SqlSchema.void({
    Request: AutomationDefinitionDbRow,
    execute: (definition) =>
      sql`
        UPDATE automation_definitions
        SET project_id = ${definition.projectId},
            source_thread_id = ${definition.sourceThreadId},
            name = ${definition.name},
            prompt = ${definition.prompt},
            schedule_json = ${definition.schedule},
            enabled = ${definition.enabled},
            next_run_at = ${definition.nextRunAt},
            model_selection_json = ${definition.modelSelection},
            provider_options_json = ${definition.providerOptions},
            runtime_mode = ${definition.runtimeMode},
            interaction_mode = ${definition.interactionMode},
            worktree_mode = ${definition.worktreeMode},
            mode = ${definition.mode},
            target_thread_id = ${definition.targetThreadId},
            max_iterations = ${definition.maxIterations},
            stop_on_error = ${definition.stopOnError},
            completion_policy_json = ${definition.completionPolicy},
            completion_policy_version = ${definition.completionPolicyVersion},
            completion_policy_updated_at = ${definition.completionPolicyUpdatedAt},
            minimum_interval_seconds = ${definition.minimumIntervalSeconds},
            max_runtime_seconds = ${definition.maxRuntimeSeconds},
            retry_policy_json = ${definition.retryPolicy},
            misfire_policy = ${definition.misfirePolicy},
            acknowledged_risks_json = ${definition.acknowledgedRisks},
            updated_at = ${definition.updatedAt},
            archived_at = ${definition.archivedAt}
        WHERE automation_id = ${definition.id}
      `,
  });

  const listDefinitionRows = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: Schema.optional(ProjectId),
      includeArchived: Schema.Boolean,
    }),
    Result: AutomationDefinitionDbRow,
    execute: ({ projectId, includeArchived }) =>
      sql`
        SELECT
          automation_id AS "id",
          project_id AS "projectId",
          source_thread_id AS "sourceThreadId",
          name,
          prompt,
          schedule_json AS "schedule",
          enabled,
          next_run_at AS "nextRunAt",
          model_selection_json AS "modelSelection",
          provider_options_json AS "providerOptions",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          worktree_mode AS "worktreeMode",
          mode,
          target_thread_id AS "targetThreadId",
          max_iterations AS "maxIterations",
          stop_on_error AS "stopOnError",
          completion_policy_json AS "completionPolicy",
          completion_policy_version AS "completionPolicyVersion",
          COALESCE(
            completion_policy_updated_at,
            updated_at,
            created_at,
            '1970-01-01T00:00:00.000Z'
          ) AS "completionPolicyUpdatedAt",
          minimum_interval_seconds AS "minimumIntervalSeconds",
          max_runtime_seconds AS "maxRuntimeSeconds",
          retry_policy_json AS "retryPolicy",
          misfire_policy AS "misfirePolicy",
          acknowledged_risks_json AS "acknowledgedRisks",
          iteration_count AS "iterationCount",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt"
        FROM automation_definitions
        WHERE (${projectId ?? null} IS NULL OR project_id = ${projectId ?? null})
          AND (${includeArchived ? 1 : 0} = 1 OR archived_at IS NULL)
        ORDER BY updated_at DESC, automation_id ASC
      `,
  });

  const listDueDefinitionRows = SqlSchema.findAll({
    Request: ListDueAutomationDefinitionsInput,
    Result: AutomationDefinitionDbRow,
    execute: ({ now, limit }) =>
      sql`
        SELECT
          definitions.automation_id AS "id",
          definitions.project_id AS "projectId",
          definitions.source_thread_id AS "sourceThreadId",
          definitions.name,
          definitions.prompt,
          definitions.schedule_json AS "schedule",
          definitions.enabled,
          definitions.next_run_at AS "nextRunAt",
          definitions.model_selection_json AS "modelSelection",
          definitions.provider_options_json AS "providerOptions",
          definitions.runtime_mode AS "runtimeMode",
          definitions.interaction_mode AS "interactionMode",
          definitions.worktree_mode AS "worktreeMode",
          definitions.mode,
          definitions.target_thread_id AS "targetThreadId",
          definitions.max_iterations AS "maxIterations",
          definitions.stop_on_error AS "stopOnError",
          definitions.completion_policy_json AS "completionPolicy",
          definitions.completion_policy_version AS "completionPolicyVersion",
          COALESCE(
            definitions.completion_policy_updated_at,
            definitions.updated_at,
            definitions.created_at,
            '1970-01-01T00:00:00.000Z'
          ) AS "completionPolicyUpdatedAt",
          definitions.minimum_interval_seconds AS "minimumIntervalSeconds",
          definitions.max_runtime_seconds AS "maxRuntimeSeconds",
          definitions.retry_policy_json AS "retryPolicy",
          definitions.misfire_policy AS "misfirePolicy",
          definitions.acknowledged_risks_json AS "acknowledgedRisks",
          definitions.iteration_count AS "iterationCount",
          definitions.created_at AS "createdAt",
          definitions.updated_at AS "updatedAt",
          definitions.archived_at AS "archivedAt"
        FROM automation_definitions definitions
        WHERE definitions.enabled = 1
          AND definitions.archived_at IS NULL
          AND definitions.next_run_at IS NOT NULL
          AND definitions.next_run_at <= ${now}
          AND NOT (
            definitions.mode = 'heartbeat'
            AND definitions.target_thread_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM automation_pending_completion_evaluations pending
              WHERE pending.thread_id = definitions.target_thread_id
            )
          )
        ORDER BY definitions.next_run_at ASC, definitions.automation_id ASC
        LIMIT ${limit}
      `,
  });

  const setDefinitionNextRunAtRow = SqlSchema.void({
    Request: SetAutomationDefinitionNextRunAtInput,
    execute: ({ id, nextRunAt, updatedAt }) =>
      sql`
        UPDATE automation_definitions
        SET next_run_at = ${nextRunAt},
            updated_at = ${updatedAt}
        WHERE automation_id = ${id}
      `,
  });

  const archiveDefinitionRow = SqlSchema.void({
    Request: ArchiveAutomationDefinitionInput,
    execute: ({ id, archivedAt }) =>
      sql`
        UPDATE automation_definitions
        SET archived_at = ${archivedAt}, updated_at = ${archivedAt}, enabled = 0
        WHERE automation_id = ${id}
      `,
  });

  const getEarliestNextRunAtRow = SqlSchema.findOneOption({
    Request: GetEarliestAutomationNextRunAtInput,
    Result: Schema.Struct({ nextRunAt: AutomationDefinition.fields.nextRunAt }),
    execute: () =>
      sql`
        SELECT definitions.next_run_at AS "nextRunAt"
        FROM automation_definitions definitions
        WHERE definitions.enabled = 1
          AND definitions.archived_at IS NULL
          AND definitions.next_run_at IS NOT NULL
          AND NOT (
            definitions.mode = 'heartbeat'
            AND definitions.target_thread_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM automation_pending_completion_evaluations pending
              WHERE pending.thread_id = definitions.target_thread_id
            )
          )
        ORDER BY definitions.next_run_at ASC, definitions.automation_id ASC
        LIMIT 1
      `,
  });

  const disableDefinitionRow = SqlSchema.void({
    Request: DisableAutomationDefinitionInput,
    execute: ({ id, now }) =>
      sql`
        UPDATE automation_definitions
        SET enabled = 0, next_run_at = NULL, updated_at = ${now}
        WHERE automation_id = ${id}
      `,
  });

  const disableDefinitionIfUnchangedRow = SqlSchema.findAll({
    Request: DisableAutomationDefinitionIfUnchangedInput,
    Result: Schema.Struct({ id: AutomationDefinition.fields.id }),
    execute: ({ id, expectedUpdatedAt, now }) =>
      sql`
        UPDATE automation_definitions
        SET enabled = 0, next_run_at = NULL, updated_at = ${now}
        WHERE automation_id = ${id}
          AND enabled = 1
          AND archived_at IS NULL
          AND updated_at = ${expectedUpdatedAt}
        RETURNING automation_id AS "id"
      `,
  });

  const incrementIterationRow = SqlSchema.void({
    Request: IncrementAutomationIterationInput,
    execute: ({ id, now }) =>
      sql`
        UPDATE automation_definitions
        SET iteration_count = iteration_count + 1, updated_at = ${now}
        WHERE automation_id = ${id}
      `,
  });

  const restartDefinitionLoopRow = SqlSchema.void({
    Request: RestartAutomationDefinitionLoopInput,
    execute: ({ id, enabled, nextRunAt, updatedAt }) =>
      sql`
        UPDATE automation_definitions
        SET enabled = ${enabled ? 1 : 0},
            iteration_count = 0,
            next_run_at = ${nextRunAt},
            updated_at = ${updatedAt}
        WHERE automation_id = ${id}
      `,
  });
  return {
    insertDefinition,
    getDefinitionRow,
    updateDefinitionRow,
    listDefinitionRows,
    listDueDefinitionRows,
    setDefinitionNextRunAtRow,
    archiveDefinitionRow,
    getEarliestNextRunAtRow,
    disableDefinitionRow,
    disableDefinitionIfUnchangedRow,
    incrementIterationRow,
    restartDefinitionLoopRow,
  };
}
