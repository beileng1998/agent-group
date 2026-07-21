import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";

import { ProjectionPendingApprovalRepositoryLive } from "../../persistence/Layers/ProjectionPendingApprovals.ts";
import { ProjectionProjectRepositoryLive } from "../../persistence/Layers/ProjectionProjects.ts";
import { ProjectionStateRepositoryLive } from "../../persistence/Layers/ProjectionState.ts";
import { ProjectionThreadActivityRepositoryLive } from "../../persistence/Layers/ProjectionThreadActivities.ts";
import { ProjectionThreadMessageRepositoryLive } from "../../persistence/Layers/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlanRepositoryLive } from "../../persistence/Layers/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSessionRepositoryLive } from "../../persistence/Layers/ProjectionThreadSessions.ts";
import { ProjectionThreadRepositoryLive } from "../../persistence/Layers/ProjectionThreads.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import {
  OrchestrationProjectionPipeline,
  type OrchestrationProjectionPipelineShape,
} from "../Services/ProjectionPipeline.ts";
import { makeProjectionPipelineRuntime } from "./projection-pipeline/pipelineRuntime.ts";
import {
  makeProjectorDefinitions,
  ORCHESTRATION_PROJECTOR_NAMES,
} from "./projection-pipeline/projectorDefinitions.ts";
import { makeProjectThreadProjectors } from "./projection-pipeline/projectThreadProjectors.ts";
import { makeSessionApprovalProjections } from "./projection-pipeline/sessionApprovalProjections.ts";
import { makeThreadMessageProjection } from "./projection-pipeline/threadMessageProjection.ts";
import { makeThreadPlanActivityProjections } from "./projection-pipeline/threadPlanActivityProjections.ts";
import { makeThreadShellSummaryProjection } from "./projection-pipeline/threadShellSummaryProjection.ts";
import { makeThreadTurnProjection } from "./projection-pipeline/threadTurnProjection.ts";

export { ORCHESTRATION_PROJECTOR_NAMES };

const makeOrchestrationProjectionPipeline = Effect.gen(function* () {
  const projectThread = yield* makeProjectThreadProjectors;
  const threadMessages = yield* makeThreadMessageProjection;
  const threadPlanActivity = yield* makeThreadPlanActivityProjections;
  const threadSessionsApprovals = yield* makeSessionApprovalProjections;
  const threadTurns = yield* makeThreadTurnProjection;
  const threadShellSummaries = yield* makeThreadShellSummaryProjection;
  const projectors = makeProjectorDefinitions({
    projects: projectThread.projects,
    threads: projectThread.threads,
    threadShellSummaries,
    threadMessages,
    threadProposedPlans: threadPlanActivity.threadProposedPlans,
    threadActivities: threadPlanActivity.threadActivities,
    threadSessions: threadSessionsApprovals.threadSessions,
    threadTurns,
    pendingApprovals: threadSessionsApprovals.pendingApprovals,
  });
  return yield* makeProjectionPipelineRuntime(projectors);
}).pipe(Effect.map((pipeline) => pipeline satisfies OrchestrationProjectionPipelineShape));

export const OrchestrationProjectionPipelineLive = Layer.effect(
  OrchestrationProjectionPipeline,
  makeOrchestrationProjectionPipeline,
).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(ProjectionProjectRepositoryLive),
  Layer.provideMerge(ProjectionThreadRepositoryLive),
  Layer.provideMerge(ProjectionThreadMessageRepositoryLive),
  Layer.provideMerge(ProjectionThreadProposedPlanRepositoryLive),
  Layer.provideMerge(ProjectionThreadActivityRepositoryLive),
  Layer.provideMerge(ProjectionThreadSessionRepositoryLive),
  Layer.provideMerge(ProjectionTurnRepositoryLive),
  Layer.provideMerge(ProjectionPendingApprovalRepositoryLive),
  Layer.provideMerge(ProjectionStateRepositoryLive),
);
