import type {
  OrchestrationCheckpointSummary,
  OrchestrationLatestTurn,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationSession,
  OrchestrationThreadActivity,
} from "@agent-group/contracts";

import { ORCHESTRATION_PROJECTOR_NAMES } from "../ProjectionPipeline.ts";
import {
  toProjectedActivity,
  toProjectedCheckpoint,
  toProjectedLatestTurn,
  toProjectedMessage,
  toProjectedProposedPlan,
  toProjectedSession,
} from "./projectionSnapshotProjection.ts";
import type {
  ProjectionCheckpointDbRow,
  ProjectionLatestTurnDbRow,
  ProjectionProjectDbRow,
  ProjectionStateDbRow,
  ProjectionThreadActivityDbRow,
  ProjectionThreadMessageDbRow,
  ProjectionThreadProposedPlanDbRow,
  ProjectionThreadSessionDbRow,
} from "./projectionSnapshotRows.ts";

const REQUIRED_SNAPSHOT_PROJECTORS = [
  ORCHESTRATION_PROJECTOR_NAMES.hot,
  ORCHESTRATION_PROJECTOR_NAMES.threadShellSummaries,
] as const;

function maxIso(left: string | null, right: string): string {
  if (left === null) return right;
  return left > right ? left : right;
}

export function maxOptionalIso(
  left: string | null,
  right: string | null | undefined,
): string | null {
  return right ? maxIso(left, right) : left;
}

function pushGrouped<T>(map: Map<string, T[]>, threadId: string, value: T): void {
  const existing = map.get(threadId);
  if (existing) {
    existing.push(value);
    return;
  }
  map.set(threadId, [value]);
}

export function collectBaseUpdatedAt(input: {
  readonly projectRows: ReadonlyArray<ProjectionProjectDbRow>;
  readonly threadRows: ReadonlyArray<{ readonly updatedAt: string }>;
  readonly stateRows: ReadonlyArray<ProjectionStateDbRow>;
}): string | null {
  let updatedAt: string | null = null;
  for (const row of input.projectRows) updatedAt = maxIso(updatedAt, row.updatedAt);
  for (const row of input.threadRows) updatedAt = maxIso(updatedAt, row.updatedAt);
  for (const row of input.stateRows) updatedAt = maxIso(updatedAt, row.updatedAt);
  return updatedAt;
}

export function collectProjectedMessages(rows: ReadonlyArray<ProjectionThreadMessageDbRow>): {
  readonly byThread: Map<string, Array<OrchestrationMessage>>;
  readonly updatedAt: string | null;
} {
  const byThread = new Map<string, Array<OrchestrationMessage>>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    updatedAt = maxIso(updatedAt, row.updatedAt);
    pushGrouped(byThread, row.threadId, toProjectedMessage(row));
  }
  return { byThread, updatedAt };
}

export function collectProjectedProposedPlans(
  rows: ReadonlyArray<ProjectionThreadProposedPlanDbRow>,
): {
  readonly byThread: Map<string, Array<OrchestrationProposedPlan>>;
  readonly updatedAt: string | null;
} {
  const byThread = new Map<string, Array<OrchestrationProposedPlan>>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    updatedAt = maxIso(updatedAt, row.updatedAt);
    pushGrouped(byThread, row.threadId, toProjectedProposedPlan(row));
  }
  return { byThread, updatedAt };
}

export function collectProjectedActivities(rows: ReadonlyArray<ProjectionThreadActivityDbRow>): {
  readonly byThread: Map<string, Array<OrchestrationThreadActivity>>;
  readonly updatedAt: string | null;
} {
  const byThread = new Map<string, Array<OrchestrationThreadActivity>>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    updatedAt = maxIso(updatedAt, row.createdAt);
    pushGrouped(byThread, row.threadId, toProjectedActivity(row));
  }
  return { byThread, updatedAt };
}

export function collectProjectedCheckpoints(rows: ReadonlyArray<ProjectionCheckpointDbRow>): {
  readonly byThread: Map<string, Array<OrchestrationCheckpointSummary>>;
  readonly updatedAt: string | null;
} {
  const byThread = new Map<string, Array<OrchestrationCheckpointSummary>>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    updatedAt = maxIso(updatedAt, row.completedAt);
    pushGrouped(byThread, row.threadId, toProjectedCheckpoint(row));
  }
  return { byThread, updatedAt };
}

export function collectProjectedLatestTurns(rows: ReadonlyArray<ProjectionLatestTurnDbRow>): {
  readonly byThread: Map<string, OrchestrationLatestTurn>;
  readonly updatedAt: string | null;
} {
  const byThread = new Map<string, OrchestrationLatestTurn>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    updatedAt = maxIso(updatedAt, row.requestedAt);
    updatedAt = maxOptionalIso(updatedAt, row.startedAt);
    updatedAt = maxOptionalIso(updatedAt, row.completedAt);
    if (byThread.has(row.threadId)) continue;
    byThread.set(row.threadId, toProjectedLatestTurn(row));
  }
  return { byThread, updatedAt };
}

export function collectProjectedSessions(rows: ReadonlyArray<ProjectionThreadSessionDbRow>): {
  readonly byThread: Map<string, OrchestrationSession>;
  readonly updatedAt: string | null;
} {
  const byThread = new Map<string, OrchestrationSession>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    updatedAt = maxIso(updatedAt, row.updatedAt);
    byThread.set(row.threadId, toProjectedSession(row));
  }
  return { byThread, updatedAt };
}

export function computeSnapshotSequence(stateRows: ReadonlyArray<ProjectionStateDbRow>): number {
  if (stateRows.length === 0) return 0;
  const sequenceByProjector = new Map(
    stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
  );
  let minSequence = Number.POSITIVE_INFINITY;
  for (const projector of REQUIRED_SNAPSHOT_PROJECTORS) {
    const sequence = sequenceByProjector.get(projector);
    if (sequence === undefined) return 0;
    if (sequence < minSequence) minSequence = sequence;
  }
  return Number.isFinite(minSequence) ? minSequence : 0;
}
