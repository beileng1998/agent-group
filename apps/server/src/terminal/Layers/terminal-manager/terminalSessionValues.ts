import { Encoding } from "effect";
import type { TerminalEvent } from "@agent-group/contracts";
import type {
  TerminalActivityState,
  TerminalAgentHookEventType,
} from "@agent-group/shared/terminalThreads";

import type { TerminalSessionState } from "../../Services/Manager";
import { TerminalHistoryBuffer, type HistoryLimits } from "../../terminalHistory";
import { cliKindFromRuntimeEnv } from "./terminalShellEnvironment";

export function legacySafeThreadId(threadId: string): string {
  return threadId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function toSafeThreadId(threadId: string): string {
  return `terminal_${Encoding.encodeBase64Url(threadId)}`;
}

export function toSafeTerminalId(terminalId: string): string {
  return Encoding.encodeBase64Url(terminalId);
}

export function toSessionKey(threadId: string, terminalId: string): string {
  return `${threadId}\u0000${terminalId}`;
}

export function resetSessionHistory(session: TerminalSessionState): void {
  session.history.reset();
  session.pendingHistoryControlSequence = "";
  session.pendingInputBuffer = "";
  session.managedAgentRunning = false;
  session.managedAgentState = null;
  session.managedAgentObserved = false;
  session.providerDescendantObserved = false;
}

export function deriveActivityAgentState(
  session: TerminalSessionState,
): TerminalActivityState | null {
  if (session.managedAgentState !== null) return session.managedAgentState;
  return session.hasRunningSubprocess && session.detectedCliKind !== null ? "running" : null;
}

export function agentStateFromHookEvent(
  eventType: TerminalAgentHookEventType,
): TerminalActivityState {
  switch (eventType) {
    case "PermissionRequest":
      return "attention";
    case "Stop":
      return "review";
    case "Start":
      return "running";
  }
}

export function makeActivityEvent(session: TerminalSessionState): TerminalEvent {
  return {
    type: "activity",
    threadId: session.threadId,
    terminalId: session.terminalId,
    createdAt: new Date().toISOString(),
    hasRunningSubprocess: session.hasRunningSubprocess,
    cliKind: session.detectedCliKind,
    agentState: deriveActivityAgentState(session),
  };
}

export function createTerminalSession(input: {
  threadId: string;
  terminalId: string;
  cwd: string;
  cols: number;
  rows: number;
  runtimeEnv: Record<string, string> | null;
  history: string;
  historyLimits: HistoryLimits;
  streamOutput: boolean;
}): TerminalSessionState {
  return {
    threadId: input.threadId,
    terminalId: input.terminalId,
    cwd: input.cwd,
    status: "starting",
    pid: null,
    history: TerminalHistoryBuffer.fromString(input.history, input.historyLimits),
    pendingHistoryControlSequence: "",
    exitCode: null,
    exitSignal: null,
    updatedAt: new Date().toISOString(),
    cols: input.cols,
    rows: input.rows,
    process: null,
    unsubscribeData: null,
    unsubscribeExit: null,
    hasRunningSubprocess: false,
    detectedCliKind: cliKindFromRuntimeEnv(input.runtimeEnv),
    providerDescendantObserved: false,
    managedAgentRunning: false,
    managedAgentState: null,
    managedAgentObserved: false,
    runtimeEnv: input.runtimeEnv,
    pendingInputBuffer: "",
    modeReplayTracker: null,
    pendingOutputChunks: [],
    pendingOutputLength: 0,
    outputFlushTimer: null,
    streamOutput: input.streamOutput,
    outputPaused: false,
    outputBufferPauseRequested: false,
    outputAckPauseRequested: false,
    outputAckObserved: false,
    outputUnackedBytes: 0,
    outputAckResumeTimer: null,
    lastInputAt: null,
    lastOutputAt: null,
    lastOutputSignature: null,
  };
}

export function createEmptyTerminalSession(
  input: Omit<Parameters<typeof createTerminalSession>[0], "history">,
): TerminalSessionState {
  return createTerminalSession({ ...input, history: "" });
}
