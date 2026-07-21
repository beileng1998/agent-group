import type {
  AutomationDefinition,
  AutomationId,
  AutomationRun,
  AutomationRunStatus,
  AutomationStreamEvent,
  OrchestrationProjectShell,
  ThreadEnvironmentMode,
} from "@agent-group/contracts";
import type { Effect } from "effect";

import type { GitCoreShape } from "../../../git/Services/GitCore.ts";
import type { TextGenerationShape } from "../../../git/Services/TextGeneration.ts";
import type { OrchestrationEngineShape } from "../../../orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { AutomationRepositoryShape } from "../../../persistence/Services/AutomationRepository.ts";
import type { ProjectionTurnRepositoryShape } from "../../../persistence/Services/ProjectionTurns.ts";
import type { ServerSettingsShape } from "../../../serverSettings.ts";
import type { AutomationServiceError } from "../../Errors.ts";

export interface AutomationRuntimeDependencies {
  readonly automationRepository: AutomationRepositoryShape;
  readonly git: GitCoreShape;
  readonly textGeneration: TextGenerationShape;
  readonly serverSettings: ServerSettingsShape;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly projectionTurnRepository: ProjectionTurnRepositoryShape;
}

export type PublishAutomationEvent = (event: AutomationStreamEvent) => Effect.Effect<void, never>;

export type RequireAutomationDefinition = (
  id: AutomationId,
) => Effect.Effect<AutomationDefinition, AutomationServiceError>;

export type RequireAutomationProject = (
  projectId: AutomationDefinition["projectId"],
) => Effect.Effect<OrchestrationProjectShell, AutomationServiceError>;

export type PublishAutomationDefinition = (
  id: AutomationId,
) => Effect.Effect<void, AutomationServiceError>;

export type MaybeStopAutomationLoop = (
  run: AutomationRun,
  status: AutomationRunStatus,
  now: string,
) => Effect.Effect<void, AutomationServiceError>;

export interface AutomationThreadEnvironment {
  readonly envMode: ThreadEnvironmentMode;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly associatedWorktreePath: string | null;
  readonly associatedWorktreeBranch: string | null;
  readonly associatedWorktreeRef: string | null;
}
