import type { AutomationStreamEvent } from "@agent-group/contracts";
import { Effect, Layer, PubSub, Stream } from "effect";

import { GitCore } from "../../git/Services/GitCore.ts";
import { TextGeneration } from "../../git/Services/TextGeneration.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { AutomationRepository } from "../../persistence/Services/AutomationRepository.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { AutomationService, type AutomationServiceShape } from "../Services/AutomationService.ts";
import { makeAutomationCompletionQueue } from "./automation-service/automationCompletionQueue.ts";
import { makeAutomationDefinitionOperations } from "./automation-service/automationDefinitionOperations.ts";
import { makeAutomationRunDispatch } from "./automation-service/automationRunDispatch.ts";
import { makeAutomationRunOperations } from "./automation-service/automationRunOperations.ts";
import { makeAutomationRunReconciliation } from "./automation-service/automationRunReconciliation.ts";
import { makeAutomationScheduler } from "./automation-service/automationScheduler.ts";
import type { AutomationRuntimeDependencies } from "./automation-service/automationServiceTypes.ts";

export const AutomationServiceLive = Layer.effect(
  AutomationService,
  Effect.gen(function* () {
    const automationRepository = yield* AutomationRepository;
    const git = yield* GitCore;
    const textGeneration = yield* TextGeneration;
    const serverSettings = yield* ServerSettingsService;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const projectionTurnRepository = yield* ProjectionTurnRepository;
    const events = yield* PubSub.unbounded<AutomationStreamEvent>();
    const dependencies: AutomationRuntimeDependencies = {
      automationRepository,
      git,
      textGeneration,
      serverSettings,
      orchestrationEngine,
      projectionSnapshotQuery,
      projectionTurnRepository,
    };
    const publish = (event: AutomationStreamEvent) =>
      PubSub.publish(events, event).pipe(Effect.asVoid);

    const definitions = makeAutomationDefinitionOperations({ dependencies, publish });
    const completion = yield* makeAutomationCompletionQueue({
      dependencies,
      publish,
      publishDefinition: definitions.publishDefinition,
      requireProject: definitions.requireProject,
    });
    const dispatch = makeAutomationRunDispatch({
      dependencies,
      publish,
      requireProject: definitions.requireProject,
      validateRiskAcknowledgements: definitions.validateRiskAcknowledgements,
      validateFastIntervalPolicy: definitions.validateFastIntervalPolicy,
      maybeStopLoop: completion.maybeStopLoop,
    });
    const reconciliation = makeAutomationRunReconciliation({
      dependencies,
      publish,
      maybeStopLoop: completion.maybeStopLoop,
      enqueuePendingCompletionEvaluations: completion.enqueuePendingCompletionEvaluations,
    });
    const runs = makeAutomationRunOperations({
      dependencies,
      publish,
      requireDefinition: definitions.requireDefinition,
      validateSchedulePolicy: definitions.validateSchedulePolicy,
      dispatchRun: dispatch.dispatchRun,
      cancelRunById: reconciliation.cancelRunById,
    });
    const scheduler = makeAutomationScheduler({
      dependencies,
      publish,
      publishDefinition: definitions.publishDefinition,
      createPendingRun: runs.createPendingRun,
      heartbeatThreadRunState: runs.heartbeatThreadRunState,
      dispatchRun: dispatch.dispatchRun,
    });

    return {
      list: definitions.list,
      create: definitions.create,
      update: definitions.update,
      delete: runs.deleteAutomation,
      runNow: runs.runNow,
      cancelRun: runs.cancelRun,
      markRunRead: runs.markRunRead,
      archiveRun: runs.archiveRun,
      runDueOnce: scheduler.runDueOnce,
      reconcileThread: reconciliation.reconcileThread,
      reconcileActiveRuns: reconciliation.reconcileActiveRuns,
      recoverPendingRuns: reconciliation.recoverPendingRuns,
      streamEvents: Stream.fromPubSub(events),
    } satisfies AutomationServiceShape;
  }),
);
