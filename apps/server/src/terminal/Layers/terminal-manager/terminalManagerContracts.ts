import type { PtyAdapterShape, PtyProcess } from "../../Services/PTY";
import type { ProcessTreeKiller } from "../../processTreeKiller";
import type { TerminalSubprocessChecker } from "./terminalSubprocessInspection";

export const DEFAULT_HISTORY_LINE_LIMIT = 5_000;
export const DEFAULT_PERSIST_DEBOUNCE_MS = 250;
export const DEFAULT_SUBPROCESS_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_PROCESS_KILL_GRACE_MS = 1_000;
export const DEFAULT_MAX_RETAINED_INACTIVE_SESSIONS = 128;
export const DEFAULT_OPEN_COLS = 120;
export const DEFAULT_OPEN_ROWS = 30;
export const SHUTDOWN_ESCALATION_SETTLE_MS = 25;

export interface TerminalManagerLogger {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface TerminalManagerOptions {
  logsDir?: string;
  historyLineLimit?: number;
  historyByteLimit?: number;
  ptyAdapter: PtyAdapterShape;
  shellResolver?: () => string;
  subprocessChecker?: TerminalSubprocessChecker;
  processTreeKiller?: ProcessTreeKiller;
  subprocessPollIntervalMs?: number;
  processKillGraceMs?: number;
  maxRetainedInactiveSessions?: number;
}

export interface KillEscalationHandle {
  timer: ReturnType<typeof setTimeout>;
  unsubscribeExit: (() => void) | null;
  retainAfterRootExit: boolean;
  rootExited: boolean;
}

export type KillEscalationMap = Map<PtyProcess, KillEscalationHandle>;
