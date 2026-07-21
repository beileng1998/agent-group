import type { TerminalEvent } from "@agent-group/contracts";

import type { TerminalSessionState } from "../../Services/Manager";
import { createTerminalModeReplayTracker } from "../../terminalModeReplay";
import { sanitizeTerminalHistoryChunk } from "./terminalHistorySanitizer";
import { agentStateFromHookEvent } from "./terminalSessionValues";
import type { TerminalManagerLogger } from "./terminalManagerContracts";

const OUTPUT_BATCH_INTERVAL_MS = 16;
const OUTPUT_BATCH_SIZE_LIMIT = 131_072;
const OUTPUT_BUFFER_HIGH_WATERMARK = 1_048_576;
const OUTPUT_ACK_HIGH_WATERMARK = 100_000;
const OUTPUT_ACK_LOW_WATERMARK = 5_000;
const OUTPUT_ACK_RESUME_TIMEOUT_MS = 10_000;

function normalizeProviderOutputSignature(visibleText: string): string {
  return visibleText
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b[P^_].*?(?:\u001b\\|\u0007|\u009c)/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-256);
}

export class TerminalOutputFlow {
  constructor(
    private readonly options: {
      logger: TerminalManagerLogger;
      emitEvent: (event: TerminalEvent) => void;
      emitActivity: (session: TerminalSessionState) => void;
      queuePersist: (session: TerminalSessionState) => void;
      bumpSubprocessPolling: () => void;
    },
  ) {}

  onData(session: TerminalSessionState, data: string): void {
    session.pendingOutputChunks.push(data);
    session.pendingOutputLength += Buffer.byteLength(data, "utf8");
    if (
      !session.outputBufferPauseRequested &&
      session.pendingOutputLength >= OUTPUT_BUFFER_HIGH_WATERMARK
    ) {
      session.outputBufferPauseRequested = true;
      this.syncReadPause(session);
    }
    if (session.pendingOutputLength >= OUTPUT_BATCH_SIZE_LIMIT) {
      this.flush(session);
    } else if (session.outputFlushTimer === null) {
      session.outputFlushTimer = setTimeout(() => this.flush(session), OUTPUT_BATCH_INTERVAL_MS);
    }
  }

  private processBatch(session: TerminalSessionState, data: string): void {
    this.feedModeReplayTracker(session, data);
    const sanitized = sanitizeTerminalHistoryChunk(session.pendingHistoryControlSequence, data);
    session.pendingHistoryControlSequence = sanitized.pendingControlSequence;
    const latestHookEvent = sanitized.hookEvents.at(-1) ?? null;
    if (latestHookEvent) {
      session.managedAgentObserved = true;
      const running = latestHookEvent !== "Stop";
      const state = agentStateFromHookEvent(latestHookEvent);
      const cliKind = latestHookEvent === "Stop" ? null : session.detectedCliKind;
      const descendantObserved =
        latestHookEvent === "Stop" ? false : session.providerDescendantObserved;
      if (
        session.managedAgentRunning !== running ||
        session.managedAgentState !== state ||
        session.detectedCliKind !== cliKind ||
        session.providerDescendantObserved !== descendantObserved
      ) {
        session.managedAgentRunning = running;
        session.managedAgentState = state;
        session.detectedCliKind = cliKind;
        session.providerDescendantObserved = descendantObserved;
        session.hasRunningSubprocess = running;
        this.options.emitActivity(session);
      }
    }
    if (sanitized.visibleText.length > 0) {
      session.history.append(sanitized.visibleText);
      this.options.queuePersist(session);
      const signature = normalizeProviderOutputSignature(sanitized.visibleText);
      if (signature.length > 0 && signature !== session.lastOutputSignature) {
        session.lastOutputAt = Date.now();
        session.lastOutputSignature = signature;
        this.options.bumpSubprocessPolling();
      }
    }
    session.updatedAt = new Date().toISOString();
  }

  flush(session: TerminalSessionState): void {
    if (session.outputFlushTimer !== null) {
      clearTimeout(session.outputFlushTimer);
      session.outputFlushTimer = null;
    }
    if (session.pendingOutputChunks.length === 0) return;
    const data = session.pendingOutputChunks.join("");
    const byteLength = session.pendingOutputLength;
    session.pendingOutputChunks = [];
    session.pendingOutputLength = 0;
    session.outputBufferPauseRequested = false;
    this.processBatch(session, data);
    if (session.streamOutput) {
      this.options.emitEvent({
        type: "output",
        threadId: session.threadId,
        terminalId: session.terminalId,
        createdAt: new Date().toISOString(),
        data,
        byteLength,
      });
    }
    if (session.outputAckObserved) {
      session.outputUnackedBytes += byteLength;
      if (session.outputUnackedBytes >= OUTPUT_ACK_HIGH_WATERMARK) {
        session.outputAckPauseRequested = true;
      }
    }
    this.syncReadPause(session);
  }

  acknowledge(session: TerminalSessionState, bytes: number): void {
    session.outputAckObserved = true;
    session.outputUnackedBytes = Math.max(0, session.outputUnackedBytes - bytes);
    if (session.outputUnackedBytes <= OUTPUT_ACK_LOW_WATERMARK) {
      session.outputAckPauseRequested = false;
    }
    this.clearAckResumeTimer(session);
    this.syncReadPause(session);
  }

  private syncReadPause(session: TerminalSessionState): void {
    const shouldPause = session.outputBufferPauseRequested || session.outputAckPauseRequested;
    if (shouldPause !== session.outputPaused) {
      if (shouldPause) session.process?.pause();
      else session.process?.resume();
      session.outputPaused = shouldPause;
    }
    this.syncAckResumeWatchdog(session);
  }

  private syncAckResumeWatchdog(session: TerminalSessionState): void {
    if (session.outputPaused && session.outputAckPauseRequested) {
      if (session.outputAckResumeTimer !== null) return;
      const timer = setTimeout(() => {
        session.outputAckResumeTimer = null;
        if (!session.outputAckPauseRequested) return;
        session.outputAckPauseRequested = false;
        session.outputUnackedBytes = 0;
        this.options.logger.warn("terminal output force-resumed by ack watchdog", {
          threadId: session.threadId,
          terminalId: session.terminalId,
        });
        this.syncReadPause(session);
      }, OUTPUT_ACK_RESUME_TIMEOUT_MS);
      timer.unref?.();
      session.outputAckResumeTimer = timer;
    } else {
      this.clearAckResumeTimer(session);
    }
  }

  private clearAckResumeTimer(session: TerminalSessionState): void {
    if (session.outputAckResumeTimer === null) return;
    clearTimeout(session.outputAckResumeTimer);
    session.outputAckResumeTimer = null;
  }

  resetAckTracking(session: TerminalSessionState): void {
    session.outputAckObserved = false;
    session.outputUnackedBytes = 0;
    session.outputAckPauseRequested = false;
    this.clearAckResumeTimer(session);
    this.syncReadPause(session);
  }

  resetBackpressure(session: TerminalSessionState): void {
    session.pendingOutputChunks = [];
    session.pendingOutputLength = 0;
    session.outputBufferPauseRequested = false;
    session.outputAckPauseRequested = false;
    session.outputAckObserved = false;
    session.outputUnackedBytes = 0;
    this.clearAckResumeTimer(session);
    if (session.outputPaused) session.process?.resume();
    session.outputPaused = false;
  }

  ensureModeReplayTracker(session: TerminalSessionState): void {
    try {
      session.modeReplayTracker = createTerminalModeReplayTracker(session.cols, session.rows);
    } catch (error) {
      session.modeReplayTracker = null;
      this.options.logger.warn("terminal mode replay tracker unavailable", {
        threadId: session.threadId,
        terminalId: session.terminalId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  resetModeReplayTracker(session: TerminalSessionState): void {
    session.modeReplayTracker?.dispose();
    session.modeReplayTracker = null;
  }

  private feedModeReplayTracker(session: TerminalSessionState, data: string): void {
    const tracker = session.modeReplayTracker;
    if (!tracker) return;
    try {
      tracker.feed(data);
    } catch (error) {
      this.options.logger.warn("terminal mode replay tracker feed failed", {
        threadId: session.threadId,
        terminalId: session.terminalId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.resetModeReplayTracker(session);
    }
  }

  buildModeReplayPreamble(session: TerminalSessionState): string {
    if (session.status !== "running" || !session.modeReplayTracker) return "";
    try {
      return session.modeReplayTracker.buildPreamble();
    } catch (error) {
      this.options.logger.warn("terminal mode replay preamble failed", {
        threadId: session.threadId,
        terminalId: session.terminalId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.resetModeReplayTracker(session);
      return "";
    }
  }
}
