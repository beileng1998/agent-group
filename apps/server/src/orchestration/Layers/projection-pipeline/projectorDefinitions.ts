import type { OrchestrationEvent } from "@agent-group/contracts";
import { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../../persistence/Errors.ts";
import { PROJECT_METADATA_SNAPSHOT_PROJECTORS } from "../../projectMetadataProjection.ts";
import {
  shouldApplyThreadsProjection,
  shouldRefreshThreadShellSummary,
} from "../../threadShellEvents.ts";

export const ORCHESTRATION_PROJECTOR_NAMES = {
  hot: "projection.hot",
  projects: "projection.projects",
  threads: "projection.threads",
  threadShellSummaries: "projection.thread-shell-summaries",
  threadMessages: "projection.thread-messages",
  threadProposedPlans: "projection.thread-proposed-plans",
  threadActivities: "projection.thread-activities",
  threadSessions: "projection.thread-sessions",
  threadTurns: "projection.thread-turns",
  checkpoints: "projection.checkpoints",
  pendingApprovals: "projection.pending-approvals",
} as const;

export type ProjectorName =
  (typeof ORCHESTRATION_PROJECTOR_NAMES)[keyof typeof ORCHESTRATION_PROJECTOR_NAMES];

export interface AttachmentSideEffects {
  readonly deletedThreadIds: Set<string>;
  readonly prunedThreadRelativePaths: Map<string, Set<string>>;
}

export interface ProjectorDefinition {
  readonly name: ProjectorName;
  readonly phase: "hot" | "deferred";
  readonly shouldApply?: (event: OrchestrationEvent) => boolean;
  readonly apply: (
    event: OrchestrationEvent,
    attachmentSideEffects: AttachmentSideEffects,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export const REQUIRED_SNAPSHOT_PROJECTORS = PROJECT_METADATA_SNAPSHOT_PROJECTORS;

const PROJECT_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "project.created",
  "project.meta-updated",
  "project.deleted",
]);

const THREAD_MESSAGE_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "thread.message-sent",
  "thread.reverted",
  "thread.conversation-rolled-back",
]);

const THREAD_PROPOSED_PLAN_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "thread.proposed-plan-upserted",
  "thread.reverted",
  "thread.conversation-rolled-back",
]);

const THREAD_ACTIVITY_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "thread.activity-appended",
  "thread.reverted",
  "thread.conversation-rolled-back",
]);

const THREAD_TURN_EVENT_TYPES = new Set<OrchestrationEvent["type"]>([
  "thread.turn-start-requested",
  "thread.session-set",
  "thread.turn-diff-completed",
  "thread.reverted",
  "thread.conversation-rolled-back",
]);

export function shouldApplyThreadTurnsProjection(event: OrchestrationEvent): boolean {
  if (THREAD_TURN_EVENT_TYPES.has(event.type)) return true;
  return (
    event.type === "thread.message-sent" &&
    event.payload.role === "assistant" &&
    event.payload.turnId !== null
  );
}

export function shouldApplyPendingApprovalsProjection(event: OrchestrationEvent): boolean {
  if (event.type === "thread.approval-response-requested") return true;
  return (
    event.type === "thread.activity-appended" &&
    (event.payload.activity.kind === "approval.requested" ||
      event.payload.activity.kind === "approval.resolved" ||
      event.payload.activity.kind === "provider.approval.respond.failed")
  );
}

export interface ProjectorImplementations {
  readonly projects: ProjectorDefinition["apply"];
  readonly threads: ProjectorDefinition["apply"];
  readonly threadShellSummaries: ProjectorDefinition["apply"];
  readonly threadMessages: ProjectorDefinition["apply"];
  readonly threadProposedPlans: ProjectorDefinition["apply"];
  readonly threadActivities: ProjectorDefinition["apply"];
  readonly threadSessions: ProjectorDefinition["apply"];
  readonly threadTurns: ProjectorDefinition["apply"];
  readonly pendingApprovals: ProjectorDefinition["apply"];
}

export function makeProjectorDefinitions(
  implementations: ProjectorImplementations,
): ReadonlyArray<ProjectorDefinition> {
  return [
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.projects,
      phase: "hot",
      shouldApply: (event) => PROJECT_EVENT_TYPES.has(event.type),
      apply: implementations.projects,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
      phase: "hot",
      shouldApply: (event) => THREAD_MESSAGE_EVENT_TYPES.has(event.type),
      apply: implementations.threadMessages,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
      phase: "hot",
      shouldApply: (event) => THREAD_PROPOSED_PLAN_EVENT_TYPES.has(event.type),
      apply: implementations.threadProposedPlans,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
      phase: "hot",
      shouldApply: (event) => THREAD_ACTIVITY_EVENT_TYPES.has(event.type),
      apply: implementations.threadActivities,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
      phase: "hot",
      shouldApply: (event) => event.type === "thread.session-set",
      apply: implementations.threadSessions,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadTurns,
      phase: "hot",
      shouldApply: shouldApplyThreadTurnsProjection,
      apply: implementations.threadTurns,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
      phase: "hot",
      shouldApply: () => false,
      apply: () => Effect.void,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.pendingApprovals,
      phase: "hot",
      shouldApply: shouldApplyPendingApprovalsProjection,
      apply: implementations.pendingApprovals,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threads,
      phase: "hot",
      shouldApply: shouldApplyThreadsProjection,
      apply: implementations.threads,
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries,
      phase: "deferred",
      shouldApply: shouldRefreshThreadShellSummary,
      apply: implementations.threadShellSummaries,
    },
  ];
}

export function selectProjectorsForEvent(
  projectors: ReadonlyArray<ProjectorDefinition>,
  event: OrchestrationEvent,
  phase?: ProjectorDefinition["phase"],
): ReadonlyArray<ProjectorDefinition> {
  const filterProjectors = (candidates: ReadonlyArray<ProjectorDefinition>) =>
    candidates.filter(
      (projector) =>
        (phase === undefined || projector.phase === phase) &&
        (projector.shouldApply?.(event) ?? true),
    );
  switch (event.type) {
    case "project.created":
    case "project.meta-updated":
    case "project.deleted": {
      const projectsProjector = projectors.find(
        (projector) => projector.name === ORCHESTRATION_PROJECTOR_NAMES.projects,
      );
      return projectsProjector
        ? filterProjectors([projectsProjector]).length > 0
          ? [projectsProjector]
          : []
        : filterProjectors(projectors);
    }
    default:
      return filterProjectors(projectors);
  }
}
