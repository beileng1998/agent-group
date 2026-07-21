import { AutomationDefinition, DEFAULT_AUTOMATION_RUNTIME_MODE } from "@agent-group/contracts";
import { Effect, Option } from "effect";

import { toPersistenceSqlError } from "../../Errors.ts";
import type { AutomationRepositoryShape } from "../../Services/AutomationRepository.ts";
import type { makeDefinitionQueries } from "./definitionQueries.ts";
import { toDefinition } from "./rows.ts";

type DefinitionOperationName =
  | "createDefinition"
  | "saveDefinition"
  | "getDefinitionById"
  | "getEarliestNextRunAt"
  | "listDueDefinitions"
  | "setDefinitionNextRunAt"
  | "archiveDefinition"
  | "disableDefinition"
  | "disableDefinitionIfUnchanged"
  | "incrementDefinitionIterationCount"
  | "restartDefinitionLoop";

export function makeDefinitionOperations(
  queries: ReturnType<typeof makeDefinitionQueries>,
): Pick<AutomationRepositoryShape, DefinitionOperationName> {
  const {
    insertDefinition,
    getDefinitionRow,
    updateDefinitionRow,
    listDueDefinitionRows,
    setDefinitionNextRunAtRow,
    archiveDefinitionRow,
    getEarliestNextRunAtRow,
    disableDefinitionRow,
    disableDefinitionIfUnchangedRow,
    incrementIterationRow,
    restartDefinitionLoopRow,
  } = queries;
  const createDefinition: AutomationRepositoryShape["createDefinition"] = (request) => {
    const { id, input, now } = request;
    const initialNextRunAt = Object.hasOwn(request, "nextRunAt")
      ? (request.nextRunAt ?? null)
      : input.schedule.type === "manual"
        ? null
        : now;
    const mode = input.mode ?? "standalone";
    const completionPolicy =
      mode === "standalone"
        ? { type: "none" as const }
        : (input.completionPolicy ?? { type: "none" as const });
    const definition: AutomationDefinition = {
      id,
      projectId: input.projectId,
      sourceThreadId: input.sourceThreadId ?? null,
      name: input.name,
      prompt: input.prompt,
      schedule: input.schedule,
      enabled: input.enabled ?? true,
      nextRunAt: initialNextRunAt,
      modelSelection: input.modelSelection,
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      runtimeMode: input.runtimeMode ?? DEFAULT_AUTOMATION_RUNTIME_MODE,
      interactionMode: input.interactionMode ?? "default",
      worktreeMode: input.worktreeMode ?? "auto",
      mode,
      targetThreadId: mode === "heartbeat" ? (input.targetThreadId ?? null) : null,
      maxIterations: input.maxIterations ?? null,
      stopOnError: input.stopOnError ?? true,
      completionPolicy,
      completionPolicyVersion: 1,
      completionPolicyUpdatedAt: now,
      minimumIntervalSeconds: input.minimumIntervalSeconds ?? 60,
      maxRuntimeSeconds: input.maxRuntimeSeconds === undefined ? 60 * 60 : input.maxRuntimeSeconds,
      retryPolicy: input.retryPolicy ?? { type: "none" },
      misfirePolicy: input.misfirePolicy ?? "coalesce",
      acknowledgedRisks: input.acknowledgedRisks ?? [],
      iterationCount: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    return insertDefinition({
      ...definition,
      enabled: definition.enabled ? 1 : 0,
      stopOnError: definition.stopOnError ? 1 : 0,
      providerOptions: definition.providerOptions ?? null,
      completionPolicy: definition.completionPolicy ?? { type: "none" },
      completionPolicyVersion: definition.completionPolicyVersion ?? 1,
      completionPolicyUpdatedAt: definition.completionPolicyUpdatedAt ?? definition.createdAt,
    }).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.createDefinition:query")),
      Effect.as(definition),
    );
  };

  const saveDefinition: AutomationRepositoryShape["saveDefinition"] = (definition) =>
    updateDefinitionRow({
      ...definition,
      enabled: definition.enabled ? 1 : 0,
      stopOnError: definition.stopOnError ? 1 : 0,
      providerOptions: definition.providerOptions ?? null,
      completionPolicy: definition.completionPolicy ?? { type: "none" },
      completionPolicyVersion: definition.completionPolicyVersion ?? 1,
      completionPolicyUpdatedAt: definition.completionPolicyUpdatedAt ?? definition.createdAt,
    }).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.saveDefinition:update")),
      Effect.as(definition),
    );

  const getDefinitionById: AutomationRepositoryShape["getDefinitionById"] = (input) =>
    getDefinitionRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.getDefinitionById:query")),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) => toDefinition(row).pipe(Effect.map(Option.some)),
        }),
      ),
    );

  const listDueDefinitions: AutomationRepositoryShape["listDueDefinitions"] = (input) =>
    listDueDefinitionRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.listDueDefinitions:query")),
      Effect.flatMap((rows) => Effect.forEach(rows, toDefinition, { concurrency: "unbounded" })),
    );

  const setDefinitionNextRunAt: AutomationRepositoryShape["setDefinitionNextRunAt"] = (input) =>
    setDefinitionNextRunAtRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.setDefinitionNextRunAt:update")),
    );

  const archiveDefinition: AutomationRepositoryShape["archiveDefinition"] = (input) =>
    archiveDefinitionRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.archiveDefinition:query")),
    );

  const getEarliestNextRunAt: AutomationRepositoryShape["getEarliestNextRunAt"] = (input = {}) =>
    getEarliestNextRunAtRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.getEarliestNextRunAt:query")),
      Effect.map((rowOption) =>
        Option.match(rowOption, {
          onNone: () => null,
          onSome: (row) => row.nextRunAt,
        }),
      ),
    );

  const disableDefinition: AutomationRepositoryShape["disableDefinition"] = (input) =>
    disableDefinitionRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.disableDefinition:update")),
    );

  const disableDefinitionIfUnchanged: AutomationRepositoryShape["disableDefinitionIfUnchanged"] = (
    input,
  ) =>
    disableDefinitionIfUnchangedRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("AutomationRepository.disableDefinitionIfUnchanged:update"),
      ),
      Effect.map((rows) => rows.length > 0),
    );

  const incrementDefinitionIterationCount: AutomationRepositoryShape["incrementDefinitionIterationCount"] =
    (input) =>
      incrementIterationRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("AutomationRepository.incrementDefinitionIterationCount:update"),
        ),
      );

  const restartDefinitionLoop: AutomationRepositoryShape["restartDefinitionLoop"] = (input) =>
    restartDefinitionLoopRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.restartDefinitionLoop:update")),
    );
  return {
    createDefinition,
    saveDefinition,
    getDefinitionById,
    listDueDefinitions,
    setDefinitionNextRunAt,
    archiveDefinition,
    getEarliestNextRunAt,
    disableDefinition,
    disableDefinitionIfUnchanged,
    incrementDefinitionIterationCount,
    restartDefinitionLoop,
  };
}
