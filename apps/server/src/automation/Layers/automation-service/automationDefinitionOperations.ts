import {
  DEFAULT_AUTOMATION_MINIMUM_INTERVAL_SECONDS,
  type AutomationDefinition,
  type AutomationId,
} from "@agent-group/contracts";
import { Effect, Option } from "effect";

import { AutomationServiceError } from "../../Errors.ts";
import type { AutomationServiceShape } from "../../Services/AutomationService.ts";
import {
  computeAutomationScheduleSpacingSeconds,
  computeNextAutomationRunAt,
} from "../../schedule.ts";
import {
  effectiveMinimumIntervalSeconds,
  fastIntervalPolicyError,
  mergeDefinitionUpdate,
  riskAcknowledgementError,
} from "./automationDefinitionPolicy.ts";
import type {
  AutomationRuntimeDependencies,
  PublishAutomationEvent,
} from "./automationServiceTypes.ts";
import {
  errorMessage,
  isoNow,
  makeAutomationId,
  toServiceError,
} from "./automationServiceValues.ts";

export function makeAutomationDefinitionOperations(input: {
  readonly dependencies: AutomationRuntimeDependencies;
  readonly publish: PublishAutomationEvent;
}) {
  const { automationRepository, projectionSnapshotQuery } = input.dependencies;
  const { publish } = input;

  const requireDefinition = (id: AutomationId) =>
    automationRepository.getDefinitionById({ id }).pipe(
      Effect.mapError(toServiceError("Failed to load automation.")),
      Effect.flatMap((definitionOption) =>
        Option.match(definitionOption, {
          onNone: () =>
            Effect.fail(new AutomationServiceError({ message: "Automation was not found." })),
          onSome: (definition) =>
            definition.archivedAt
              ? Effect.fail(new AutomationServiceError({ message: "Automation has been deleted." }))
              : Effect.succeed(definition),
        }),
      ),
    );

  const publishDefinition = (id: AutomationId) =>
    automationRepository.getDefinitionById({ id }).pipe(
      Effect.mapError(toServiceError("Failed to load automation.")),
      Effect.flatMap((definitionOption) =>
        Option.match(definitionOption, {
          onNone: () => Effect.void,
          onSome: (definition) => publish({ type: "definition-upserted", definition }),
        }),
      ),
    );

  const requireProject = (projectId: AutomationDefinition["projectId"]) =>
    projectionSnapshotQuery.getShellSnapshot().pipe(
      Effect.mapError(toServiceError("Failed to load project snapshot.")),
      Effect.flatMap((snapshot) => {
        const project = snapshot.projects.find((entry) => entry.id === projectId);
        return project
          ? Effect.succeed(project)
          : Effect.fail(
              new AutomationServiceError({ message: "Automation project was not found." }),
            );
      }),
    );

  const validateHeartbeatTarget = (validation: {
    readonly mode: AutomationDefinition["mode"];
    readonly projectId: AutomationDefinition["projectId"];
    readonly targetThreadId: AutomationDefinition["targetThreadId"];
  }) => {
    if (validation.mode !== "heartbeat") return Effect.void;
    if (!validation.targetThreadId) {
      return Effect.fail(
        new AutomationServiceError({ message: "Heartbeat automations require a target thread." }),
      );
    }
    return projectionSnapshotQuery.getThreadShellById(validation.targetThreadId).pipe(
      Effect.mapError(toServiceError("Failed to load heartbeat target thread.")),
      Effect.flatMap((threadOption) =>
        Option.match(threadOption, {
          onNone: () =>
            Effect.fail(
              new AutomationServiceError({ message: "Heartbeat target thread was not found." }),
            ),
          onSome: (thread) =>
            thread.projectId === validation.projectId
              ? Effect.void
              : Effect.fail(
                  new AutomationServiceError({
                    message: "Heartbeat target thread must belong to the automation project.",
                  }),
                ),
        }),
      ),
    );
  };

  const validateSchedulePolicy = (validation: {
    readonly schedule: AutomationDefinition["schedule"];
    readonly enabled: boolean;
    readonly maxIterations: AutomationDefinition["maxIterations"];
    readonly minimumIntervalSeconds: number;
    readonly acknowledgedRisks: readonly string[];
    readonly now: string;
  }) =>
    Effect.try({
      try: () => {
        const spacingSeconds = computeAutomationScheduleSpacingSeconds(
          validation.schedule,
          validation.now,
        );
        const fastIntervalError = fastIntervalPolicyError(validation);
        if (fastIntervalError) throw new Error(fastIntervalError);
        const minimumIntervalSeconds = effectiveMinimumIntervalSeconds(validation);
        if (spacingSeconds !== null && spacingSeconds < minimumIntervalSeconds) {
          throw new Error(
            `Automation schedule must run at least ${minimumIntervalSeconds} seconds apart.`,
          );
        }
        const nextRunAt = computeNextAutomationRunAt(validation.schedule, validation.now);
        if (validation.enabled && validation.schedule.type !== "manual" && nextRunAt === null) {
          throw new Error("Automation schedule must have a future run time.");
        }
      },
      catch: (cause) => new AutomationServiceError({ message: errorMessage(cause), cause }),
    }).pipe(Effect.asVoid);

  const validateExecutionPolicies = (validation: {
    readonly retryPolicy: AutomationDefinition["retryPolicy"];
  }) =>
    validation.retryPolicy.type === "none"
      ? Effect.void
      : Effect.fail(
          new AutomationServiceError({
            message: "Automation retry policies are not supported yet.",
          }),
        );

  const validateRiskAcknowledgements = (validation: {
    readonly runtimeMode: AutomationDefinition["runtimeMode"];
    readonly worktreeMode: AutomationDefinition["worktreeMode"];
    readonly acknowledgedRisks: readonly string[];
  }) => {
    const message = riskAcknowledgementError(validation);
    return message ? Effect.fail(new AutomationServiceError({ message })) : Effect.void;
  };

  const validateFastIntervalPolicy = (validation: {
    readonly schedule: AutomationDefinition["schedule"];
    readonly enabled: boolean;
    readonly maxIterations: AutomationDefinition["maxIterations"];
    readonly acknowledgedRisks: readonly string[];
    readonly now: string;
  }) =>
    Effect.try({
      try: () => fastIntervalPolicyError(validation),
      catch: (cause) => new AutomationServiceError({ message: errorMessage(cause), cause }),
    }).pipe(
      Effect.flatMap((message) =>
        message ? Effect.fail(new AutomationServiceError({ message })) : Effect.void,
      ),
    );

  const normalizeCreatedDefinitionSchedule = (definition: AutomationDefinition, now: string) => {
    const nextRunAt = computeNextAutomationRunAt(definition.schedule, now);
    if (definition.nextRunAt === nextRunAt) return Effect.succeed(definition);
    return automationRepository.saveDefinition({ ...definition, nextRunAt, updatedAt: now });
  };

  const list: AutomationServiceShape["list"] = (listInput = {}) =>
    automationRepository
      .list(listInput)
      .pipe(Effect.mapError(toServiceError("Failed to list automations.")));

  const create: AutomationServiceShape["create"] = (createInput) =>
    Effect.gen(function* () {
      const now = isoNow();
      yield* requireProject(createInput.projectId);
      yield* validateSchedulePolicy({
        schedule: createInput.schedule,
        enabled: createInput.enabled ?? true,
        maxIterations: createInput.maxIterations ?? null,
        minimumIntervalSeconds:
          createInput.minimumIntervalSeconds ?? DEFAULT_AUTOMATION_MINIMUM_INTERVAL_SECONDS,
        acknowledgedRisks: createInput.acknowledgedRisks ?? [],
        now,
      });
      yield* validateExecutionPolicies({
        retryPolicy: createInput.retryPolicy ?? { type: "none" },
      });
      yield* validateRiskAcknowledgements({
        runtimeMode: createInput.runtimeMode ?? "approval-required",
        worktreeMode: createInput.worktreeMode ?? "auto",
        acknowledgedRisks: createInput.acknowledgedRisks ?? [],
      });
      yield* validateHeartbeatTarget({
        mode: createInput.mode ?? "standalone",
        projectId: createInput.projectId,
        targetThreadId: createInput.targetThreadId ?? null,
      });
      const initialNextRunAt = computeNextAutomationRunAt(createInput.schedule, now);
      const definition = yield* automationRepository
        .createDefinition({
          id: makeAutomationId(),
          input: createInput,
          now,
          nextRunAt: initialNextRunAt,
        })
        .pipe(Effect.mapError(toServiceError("Failed to create automation.")));
      const normalized = yield* normalizeCreatedDefinitionSchedule(definition, now).pipe(
        Effect.mapError(toServiceError("Failed to initialize automation schedule.")),
      );
      yield* publish({ type: "definition-upserted", definition: normalized });
      return normalized;
    });

  const update: AutomationServiceShape["update"] = (updateInput) =>
    Effect.gen(function* () {
      const now = isoNow();
      const current = yield* requireDefinition(updateInput.id);
      const updated = mergeDefinitionUpdate(current, updateInput, now);
      yield* requireProject(updated.projectId);
      yield* validateSchedulePolicy({
        schedule: updated.schedule,
        enabled: updated.enabled,
        maxIterations: updated.maxIterations,
        minimumIntervalSeconds: updated.minimumIntervalSeconds,
        acknowledgedRisks: updated.acknowledgedRisks,
        now,
      });
      yield* validateExecutionPolicies({ retryPolicy: updated.retryPolicy });
      yield* validateRiskAcknowledgements({
        runtimeMode: updated.runtimeMode,
        worktreeMode: updated.worktreeMode,
        acknowledgedRisks: updated.acknowledgedRisks,
      });
      yield* validateHeartbeatTarget(updated);
      const saved = yield* automationRepository
        .saveDefinition(updated)
        .pipe(Effect.mapError(toServiceError("Failed to update automation.")));
      yield* publish({ type: "definition-upserted", definition: saved });
      return saved;
    });

  return {
    requireDefinition,
    publishDefinition,
    requireProject,
    validateSchedulePolicy,
    validateRiskAcknowledgements,
    validateFastIntervalPolicy,
    list,
    create,
    update,
  };
}
