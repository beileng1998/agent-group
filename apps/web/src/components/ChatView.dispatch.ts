import { ProjectId, type ThreadId } from "@agent-group/contracts";
import { buildAgentGroupBranchName } from "@agent-group/shared/git";
import { Schema } from "effect";

import type {
  SessionPhase,
  Thread,
  TurnDiffSummary,
  WorktreeSetupSnapshot,
  WorktreeSetupStepId,
} from "../types";
import { isProviderFileEditWorkLogEntry, type WorkLogEntry } from "../session-logic";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "agent-group:last-invoked-script-by-project";
export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

export interface PendingFileUndo {
  readonly threadId: ThreadId;
  readonly turnCount: number;
  readonly existingFailureActivityIds: readonly string[];
}

export function hasFileUndoSettled(input: {
  readonly pending: PendingFileUndo;
  readonly thread: Pick<Thread, "id" | "turnDiffSummaries" | "activities"> | null;
}): boolean {
  if (!input.thread || input.thread.id !== input.pending.threadId) {
    return false;
  }

  const targetSummary = input.thread.turnDiffSummaries.find(
    (summary) => summary.checkpointTurnCount === input.pending.turnCount,
  );
  if (targetSummary?.files.length === 0) {
    return true;
  }

  return input.thread.activities.some((activity) => {
    if (
      activity.kind !== "checkpoint.revert.failed" ||
      input.pending.existingFailureActivityIds.includes(activity.id) ||
      typeof activity.payload !== "object" ||
      activity.payload === null ||
      !("turnCount" in activity.payload)
    ) {
      return false;
    }
    return activity.payload.turnCount === input.pending.turnCount;
  });
}

// The composer live strip prefers the turn's computed diff (the
// `thread.turn-diff-completed` event) so it can show real per-file +/- stats.
// Before that lands, it falls back to mid-turn file-edit work-log activity so
// the strip can appear while the turn is running, but without a reviewable
// turn id. Once a turn diff exists, its empty file list is authoritative and
// must not be overwritten by tool metadata.
export function resolveActiveTurnLiveDiffState(input: {
  latestTurnId: TurnDiffSummary["turnId"] | null | undefined;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  workLogEntries?: ReadonlyArray<
    Pick<WorkLogEntry, "changedFiles" | "itemType" | "requestKind" | "turnId">
  >;
}): {
  turnId: TurnDiffSummary["turnId"] | null;
  fileCount: number | null;
  additions: number;
  deletions: number;
  hasChanges: boolean;
} {
  const summary = input.latestTurnId
    ? (input.turnDiffSummaries.find((entry) => entry.turnId === input.latestTurnId) ?? null)
    : null;
  const files = summary?.files ?? [];
  if (summary && files.length > 0) {
    return {
      turnId: summary.turnId,
      fileCount: files.length,
      additions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
      deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0),
      hasChanges: true,
    };
  }
  if (summary) {
    return {
      turnId: null,
      fileCount: 0,
      additions: 0,
      deletions: 0,
      hasChanges: false,
    };
  }

  // No diff totals yet: keep the strip visible from in-turn file-edit work so it
  // does not vanish between the first edit and the turn-diff-completed event.
  const workLogFilePaths = new Set<string>();
  let hasFileEditWork = false;
  if (input.latestTurnId) {
    for (const entry of input.workLogEntries ?? []) {
      if (entry.turnId !== input.latestTurnId || !isProviderFileEditWorkLogEntry(entry)) {
        continue;
      }
      hasFileEditWork = true;
      for (const filePath of entry.changedFiles ?? []) {
        workLogFilePaths.add(filePath);
      }
    }
  }

  if (hasFileEditWork && input.latestTurnId) {
    return {
      turnId: null,
      fileCount: workLogFilePaths.size > 0 ? workLogFilePaths.size : null,
      additions: 0,
      deletions: 0,
      hasChanges: true,
    };
  }

  return {
    turnId: null,
    fileCount: 0,
    additions: 0,
    deletions: 0,
    hasChanges: false,
  };
}

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

// Ordered client-side phases of the "New worktree" first-send setup. The
// labels surface verbatim in the transcript's transient setup row.
export const WORKTREE_SETUP_STEP_DEFINITIONS: ReadonlyArray<{
  id: WorktreeSetupStepId;
  label: string;
}> = [
  { id: "create-worktree", label: "Creating branch and worktree" },
  { id: "prepare-thread", label: "Linking thread workspace" },
  { id: "start-session", label: "Starting session" },
];

export interface WorktreeSetupSnapshotOptions {
  setupScriptName?: string | null;
}

export interface WorktreeSetupDispatchOptions extends WorktreeSetupSnapshotOptions {
  worktreeSetupStepId?: WorktreeSetupStepId;
}

function worktreeSetupStepDefinitions(
  activeStepId: WorktreeSetupStepId,
  options?: WorktreeSetupSnapshotOptions,
): ReadonlyArray<{ id: WorktreeSetupStepId; label: string }> {
  const setupScriptName = options?.setupScriptName?.trim();
  const includeSetupStep = activeStepId === "run-setup-action" || Boolean(setupScriptName);
  if (!includeSetupStep) {
    return WORKTREE_SETUP_STEP_DEFINITIONS;
  }
  return [
    { id: "create-worktree", label: "Creating branch and worktree" },
    { id: "prepare-thread", label: "Linking thread workspace" },
    {
      id: "run-setup-action",
      label: setupScriptName ? `Running setup action: ${setupScriptName}` : "Running setup action",
    },
    { id: "start-session", label: "Starting session" },
  ];
}

// How long a failed setup step stays visible before the row is dismissed, so
// the error state can paint instead of being batched away with the reset.
export const WORKTREE_SETUP_ERROR_HOLD_MS = 1200;

export function createWorktreeSetupSnapshot(
  activeStepId: WorktreeSetupStepId,
  options?: WorktreeSetupSnapshotOptions,
): WorktreeSetupSnapshot {
  const stepDefinitions = worktreeSetupStepDefinitions(activeStepId, options);
  const activeIndex = stepDefinitions.findIndex((step) => step.id === activeStepId);
  return {
    steps: stepDefinitions.map((step, index) => ({
      ...step,
      status: index < activeIndex ? "done" : index === activeIndex ? "active" : "pending",
    })),
  };
}

export function failWorktreeSetupSnapshot(snapshot: WorktreeSetupSnapshot): WorktreeSetupSnapshot {
  if (!snapshot.steps.some((step) => step.status === "active")) {
    return snapshot;
  }
  return {
    steps: snapshot.steps.map((step) =>
      step.status === "active" ? { ...step, status: "error" } : step,
    ),
  };
}

export function worktreeSetupHasError(snapshot: WorktreeSetupSnapshot | null): boolean {
  return snapshot?.steps.some((step) => step.status === "error") ?? false;
}

export interface LocalDispatchSnapshot {
  startedAt: string;
  worktreeSetup: WorktreeSetupSnapshot | null;
  latestTurnTurnId: Thread["latestTurn"] extends infer T
    ? T extends { turnId: infer U }
      ? U | null
      : null
    : null;
  latestTurnRequestedAt: string | null;
  latestTurnStartedAt: string | null;
  latestTurnCompletedAt: string | null;
  sessionOrchestrationStatus: Thread["session"] extends infer T
    ? T extends { orchestrationStatus: infer U }
      ? U | null
      : null
    : null;
  sessionUpdatedAt: string | null;
}

export function createLocalDispatchSnapshot(
  activeThread: Thread | undefined,
  options?: WorktreeSetupDispatchOptions,
): LocalDispatchSnapshot {
  const latestTurn = activeThread?.latestTurn ?? null;
  const session = activeThread?.session ?? null;
  return {
    startedAt: new Date().toISOString(),
    worktreeSetup: options?.worktreeSetupStepId
      ? createWorktreeSetupSnapshot(options.worktreeSetupStepId, options)
      : null,
    latestTurnTurnId: latestTurn?.turnId ?? null,
    latestTurnRequestedAt: latestTurn?.requestedAt ?? null,
    latestTurnStartedAt: latestTurn?.startedAt ?? null,
    latestTurnCompletedAt: latestTurn?.completedAt ?? null,
    sessionOrchestrationStatus: session?.orchestrationStatus ?? null,
    sessionUpdatedAt: session?.updatedAt ?? null,
  };
}

// Computes the next client-side dispatch marker while preserving in-flight setup
// progress and dropping failed setup rows that are only being held for display.
export function resolveNextLocalDispatchSnapshot(input: {
  current: LocalDispatchSnapshot | null;
  activeThread: Thread | undefined;
  options?: WorktreeSetupDispatchOptions;
}): LocalDispatchSnapshot {
  const worktreeSetupStepId = input.options?.worktreeSetupStepId;
  if (!input.current || worktreeSetupHasError(input.current.worktreeSetup)) {
    return createLocalDispatchSnapshot(input.activeThread, input.options);
  }

  if (!worktreeSetupStepId) {
    return input.current;
  }

  const alreadyActive = input.current.worktreeSetup?.steps.some(
    (step) => step.id === worktreeSetupStepId && step.status === "active",
  );
  return alreadyActive
    ? input.current
    : {
        ...input.current,
        worktreeSetup: createWorktreeSetupSnapshot(worktreeSetupStepId, input.options),
      };
}

export function hasServerAcknowledgedLocalDispatch(input: {
  localDispatch: LocalDispatchSnapshot | null;
  phase: SessionPhase;
  latestTurn: Thread["latestTurn"] | null;
  session: Thread["session"] | null;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  threadError: string | null | undefined;
}): boolean {
  if (!input.localDispatch) {
    return false;
  }
  if (
    input.phase === "running" ||
    input.hasPendingApproval ||
    input.hasPendingUserInput ||
    Boolean(input.threadError)
  ) {
    return true;
  }

  const latestTurn = input.latestTurn ?? null;
  const session = input.session ?? null;
  const nextSessionOrchestrationStatus = session?.orchestrationStatus ?? null;
  const latestTurnChanged =
    input.localDispatch.latestTurnTurnId !== (latestTurn?.turnId ?? null) ||
    input.localDispatch.latestTurnRequestedAt !== (latestTurn?.requestedAt ?? null) ||
    input.localDispatch.latestTurnStartedAt !== (latestTurn?.startedAt ?? null) ||
    input.localDispatch.latestTurnCompletedAt !== (latestTurn?.completedAt ?? null);

  if (latestTurnChanged) {
    return true;
  }

  if (input.localDispatch.sessionOrchestrationStatus !== nextSessionOrchestrationStatus) {
    if (
      input.localDispatch.sessionOrchestrationStatus === null &&
      nextSessionOrchestrationStatus === "ready"
    ) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Steering a non-Codex provider interrupts the live turn and lets the server
 * re-dispatch the steer text as a fresh turn. Between the abort and the
 * steered turn's start the thread briefly looks idle, which would otherwise
 * let the queued-composer auto-dispatch race the steered turn (and fire every
 * queued message at once). The gate holds auto-dispatch through that gap.
 */
export interface QueuedSteerGate {
  /** The abort gap has been observed (phase left "running" after the steer). */
  sawInterruptGap: boolean;
  /** Epoch ms when the gap started; null while the original turn still runs. */
  gapStartedAt: number | null;
}

/** Recovery bound: a healthy interrupt→steered-turn handoff takes ~1-2s. */
export const QUEUED_STEER_GATE_TIMEOUT_MS = 15_000;

export type QueuedSteerGateTransition =
  | { kind: "clear" }
  | { kind: "hold"; gate: QueuedSteerGate; expiresInMs: number | null };

export function resolveQueuedSteerGateTransition(input: {
  gate: QueuedSteerGate;
  phase: SessionPhase;
  sessionErrored: boolean;
  now: number;
}): QueuedSteerGateTransition {
  if (input.phase === "disconnected" || input.sessionErrored) {
    // The steer will not produce a follow-up turn; release the queue.
    return { kind: "clear" };
  }
  if (input.phase === "running") {
    if (input.gate.sawInterruptGap) {
      // The steered turn is live; normal live-turn guards take over from here.
      return { kind: "clear" };
    }
    // Original turn still running (interrupt not processed yet): keep holding.
    return {
      kind: "hold",
      gate: { sawInterruptGap: false, gapStartedAt: null },
      expiresInMs: null,
    };
  }
  const gapStartedAt = input.gate.gapStartedAt ?? input.now;
  const expiresInMs = QUEUED_STEER_GATE_TIMEOUT_MS - (input.now - gapStartedAt);
  if (expiresInMs <= 0) {
    // The steered turn never started (lost interrupt, provider failure that
    // didn't surface as a session error). Fail open so the queue can't stall.
    return { kind: "clear" };
  }
  return {
    kind: "hold",
    gate: { sawInterruptGap: true, gapStartedAt },
    expiresInMs,
  };
}

export const ACTIVE_TURN_LAYOUT_SETTLE_DELAY_MS = 180;

export function shouldStartActiveTurnLayoutGrace(options: {
  previousTurnLayoutLive: boolean;
  currentTurnLayoutLive: boolean;
  latestTurnStartedAt: string | null;
}): boolean {
  return (
    options.previousTurnLayoutLive &&
    !options.currentTurnLayoutLive &&
    options.latestTurnStartedAt !== null
  );
}

export function buildSuggestedWorktreeName(input: {
  associatedWorktreeBranch?: string | null;
  title?: string | null;
}): string {
  return buildAgentGroupBranchName(input.associatedWorktreeBranch ?? input.title);
}
