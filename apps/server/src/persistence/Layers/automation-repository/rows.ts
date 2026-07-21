import {
  AutomationCompletionPolicy,
  AutomationDefinition,
  AutomationPermissionSnapshot,
  AutomationRun,
  AutomationSchedule,
  ModelSelection,
  ProviderStartOptions,
  TurnId,
} from "@agent-group/contracts";
import { Effect, Schema } from "effect";

import { toPersistenceDecodeError } from "../../Errors.ts";

export const AutomationDefinitionDbRow = Schema.Struct({
  id: AutomationDefinition.fields.id,
  projectId: AutomationDefinition.fields.projectId,
  sourceThreadId: AutomationDefinition.fields.sourceThreadId,
  name: AutomationDefinition.fields.name,
  prompt: AutomationDefinition.fields.prompt,
  schedule: Schema.fromJsonString(AutomationSchedule),
  enabled: Schema.Number,
  nextRunAt: AutomationDefinition.fields.nextRunAt,
  modelSelection: Schema.fromJsonString(ModelSelection),
  providerOptions: Schema.NullOr(Schema.fromJsonString(ProviderStartOptions)),
  runtimeMode: AutomationDefinition.fields.runtimeMode,
  interactionMode: AutomationDefinition.fields.interactionMode,
  worktreeMode: AutomationDefinition.fields.worktreeMode,
  mode: AutomationDefinition.fields.mode,
  targetThreadId: AutomationDefinition.fields.targetThreadId,
  maxIterations: AutomationDefinition.fields.maxIterations,
  stopOnError: Schema.Number,
  completionPolicy: Schema.fromJsonString(AutomationCompletionPolicy),
  completionPolicyVersion: AutomationDefinition.fields.completionPolicyVersion,
  completionPolicyUpdatedAt: AutomationDefinition.fields.completionPolicyUpdatedAt,
  minimumIntervalSeconds: AutomationDefinition.fields.minimumIntervalSeconds,
  maxRuntimeSeconds: AutomationDefinition.fields.maxRuntimeSeconds,
  retryPolicy: Schema.fromJsonString(AutomationDefinition.fields.retryPolicy),
  misfirePolicy: AutomationDefinition.fields.misfirePolicy,
  acknowledgedRisks: Schema.fromJsonString(AutomationDefinition.fields.acknowledgedRisks),
  iterationCount: AutomationDefinition.fields.iterationCount,
  createdAt: AutomationDefinition.fields.createdAt,
  updatedAt: AutomationDefinition.fields.updatedAt,
  archivedAt: AutomationDefinition.fields.archivedAt,
});
export type AutomationDefinitionDbRow = typeof AutomationDefinitionDbRow.Type;

export const AutomationRunDbRow = Schema.Struct({
  id: AutomationRun.fields.id,
  automationId: AutomationRun.fields.automationId,
  projectId: AutomationRun.fields.projectId,
  threadId: AutomationRun.fields.threadId,
  turnId: Schema.NullOr(TurnId),
  triggerType: Schema.Literals(["manual", "scheduled"]),
  status: AutomationRun.fields.status,
  scheduledFor: AutomationRun.fields.scheduledFor,
  claimedBy: AutomationRun.fields.claimedBy,
  claimedAt: AutomationRun.fields.claimedAt,
  leaseExpiresAt: AutomationRun.fields.leaseExpiresAt,
  startedAt: AutomationRun.fields.startedAt,
  finishedAt: AutomationRun.fields.finishedAt,
  threadCreateCommandId: AutomationRun.fields.threadCreateCommandId,
  turnStartCommandId: AutomationRun.fields.turnStartCommandId,
  messageId: AutomationRun.fields.messageId,
  error: AutomationRun.fields.error,
  result: Schema.NullOr(Schema.fromJsonString(AutomationRun.fields.result)),
  permissionSnapshot: Schema.fromJsonString(AutomationPermissionSnapshot),
  createdAt: AutomationRun.fields.createdAt,
  updatedAt: AutomationRun.fields.updatedAt,
});
export type AutomationRunDbRow = typeof AutomationRunDbRow.Type;

/** Upper bound on how many run rows the list query returns to a client snapshot. */
export const MAX_RUN_LIST_ROWS = 500;

const decodeDefinition = Schema.decodeUnknownEffect(AutomationDefinition);
const decodeRun = Schema.decodeUnknownEffect(AutomationRun);

export function withResultDefaults(run: AutomationRun): NonNullable<AutomationRun["result"]> {
  return (
    run.result ?? {
      outcome: "unknown",
      summary: null,
      unread: true,
      archivedAt: null,
    }
  );
}

export function toDefinition(row: AutomationDefinitionDbRow) {
  return decodeDefinition({
    ...row,
    enabled: row.enabled === 1,
    stopOnError: row.stopOnError === 1,
    providerOptions: row.providerOptions ?? undefined,
  }).pipe(Effect.mapError(toPersistenceDecodeError("AutomationRepository.definitionRowToDomain")));
}

export function toRun(row: AutomationRunDbRow) {
  return decodeRun({
    ...row,
    trigger: { type: row.triggerType },
    turnId: row.turnId,
  }).pipe(Effect.mapError(toPersistenceDecodeError("AutomationRepository.runRowToDomain")));
}
