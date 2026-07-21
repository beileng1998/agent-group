import type { OrchestrationLatestTurn, TurnId } from "@agent-group/contracts";
import type { SessionPhase, Thread, ThreadSession } from "./types";

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  if (seconds === 0) return `${minutes}m`;
  if (seconds === 60) return `${minutes + 1}m`;
  return `${minutes}m ${seconds}s`;
}

export function formatClockDuration(durationMs: number): string {
  const elapsedSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function formatClockElapsed(startIso: string, endIso: string | undefined): string | null {
  if (!endIso) return null;
  const startedAt = Date.parse(startIso);
  const endedAt = Date.parse(endIso);
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) {
    return null;
  }
  return formatClockDuration(endedAt - startedAt);
}

export function formatElapsed(startIso: string, endIso: string | undefined): string | null {
  if (!endIso) return null;
  const startedAt = Date.parse(startIso);
  const endedAt = Date.parse(endIso);
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) {
    return null;
  }
  return formatDuration(endedAt - startedAt);
}

type LatestTurnTiming = Pick<
  OrchestrationLatestTurn,
  "turnId" | "state" | "startedAt" | "completedAt"
>;
type SessionActivityState = Pick<ThreadSession, "orchestrationStatus" | "activeTurnId">;

export function isLatestTurnSettled(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
): boolean {
  if (!latestTurn?.startedAt) return false;
  if (!latestTurn.completedAt) return false;
  if (latestTurn.state === "interrupted" || latestTurn.state === "error") {
    return true;
  }
  if (!session) return true;
  if (session.orchestrationStatus === "running") return false;
  return true;
}

export function hasLiveLatestTurn(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
): boolean {
  if (!latestTurn?.startedAt) {
    return false;
  }
  return !isLatestTurnSettled(latestTurn, session);
}

/**
 * Pending approval / user-input requests are only actionable while the session
 * that raised them can still receive the answer. Once the session is closed or
 * errored the request is dead — status surfaces (sidebar pill, kanban column)
 * must not present the thread as awaiting action forever after a provider
 * crash. A thread with no session yet keeps the request actionable: the flag
 * can arrive ahead of the session snapshot.
 */
export function canSessionAnswerPendingRequests(
  session: Pick<ThreadSession, "status"> | null | undefined,
): boolean {
  if (!session) {
    return true;
  }
  return session.status !== "closed" && session.status !== "error";
}

/**
 * Minimal view a session needs to expose to answer "is a turn live?": its status
 * label and its in-flight turn id. Kept structural (not `Pick<ThreadSession>`) so
 * the predicate also accepts the orchestration read-model session, whose status is
 * a wider union and whose `activeTurnId` is `TurnId | null` rather than
 * `TurnId | undefined`. Both shapes satisfy this.
 */
type RunningTurnSessionView = {
  status: string;
  activeTurnId?: TurnId | null | undefined;
};

/**
 * A session is actively running a turn: it reports the `running` status and still
 * has an in-flight `activeTurnId`. This is the single rule for "there is live work
 * on this session right now" — it gates destructive thread lifecycle actions
 * (archive/delete must stop the turn first) and marks the latest turn as running
 * during read-model reconciliation. Centralized so every gate agrees on what
 * "running" means; widening it later (e.g. to also block `starting`) updates every
 * caller at once instead of leaving a stale inline check behind.
 */
export function isSessionRunningTurn<T extends RunningTurnSessionView>(
  session: T | null | undefined,
): session is T & { activeTurnId: TurnId } {
  return session != null && session.status === "running" && session.activeTurnId != null;
}

/** Thread-level form of {@link isSessionRunningTurn}: true while the thread's session has an in-flight turn. */
export function isThreadRunningTurn(thread: Pick<Thread, "session">): boolean {
  return isSessionRunningTurn(thread.session);
}

export function deriveActiveWorkStartedAt(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
  sendStartedAt: string | null,
): string | null {
  const runningTurnId =
    session?.orchestrationStatus === "running" ? (session.activeTurnId ?? null) : null;
  if (runningTurnId !== null && runningTurnId === latestTurn?.turnId) {
    return latestTurn?.startedAt ?? sendStartedAt;
  }
  if (runningTurnId !== null) {
    return sendStartedAt;
  }
  if (!isLatestTurnSettled(latestTurn, session)) {
    return latestTurn?.startedAt ?? sendStartedAt;
  }
  return sendStartedAt;
}

export function derivePhase(session: ThreadSession | null): SessionPhase {
  if (!session || session.status === "closed") return "disconnected";
  if (session.status === "connecting") return "connecting";
  if (session.status === "running") return "running";
  return "ready";
}
