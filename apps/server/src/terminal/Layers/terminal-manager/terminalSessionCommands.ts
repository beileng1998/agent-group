import fs from "node:fs";

import {
  TerminalAckOutputInput,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalWriteInput,
  type TerminalEvent,
  type TerminalSessionSnapshot,
} from "@agent-group/contracts";
import { consumeTerminalIdentityInput } from "@agent-group/shared/terminalThreads";
import { Schema } from "effect";

import type { TerminalSessionState } from "../../Services/Manager";
import type { TerminalHistoryPersistence } from "./terminalHistoryPersistence";
import type { TerminalOutputFlow } from "./terminalOutputFlow";
import type { TerminalPtyLifecycle } from "./terminalPtyLifecycle";
import type { TerminalSessionRegistry } from "./terminalSessionRegistry";
import type { TerminalSubprocessPolling } from "./terminalSubprocessPolling";
import {
  DEFAULT_OPEN_COLS,
  DEFAULT_OPEN_ROWS,
  type TerminalManagerLogger,
} from "./terminalManagerContracts";
import { normalizedRuntimeEnv } from "./terminalShellEnvironment";
import {
  createEmptyTerminalSession,
  createTerminalSession,
  resetSessionHistory,
  toSessionKey,
} from "./terminalSessionValues";
import type { HistoryLimits } from "../../terminalHistory";

const decodeOpen = Schema.decodeUnknownSync(TerminalOpenInput);
const decodeRestart = Schema.decodeUnknownSync(TerminalRestartInput);
const decodeWrite = Schema.decodeUnknownSync(TerminalWriteInput);
const decodeAck = Schema.decodeUnknownSync(TerminalAckOutputInput);
const decodeResize = Schema.decodeUnknownSync(TerminalResizeInput);
const decodeClear = Schema.decodeUnknownSync(TerminalClearInput);
const decodeClose = Schema.decodeUnknownSync(TerminalCloseInput);

export class TerminalSessionCommands {
  constructor(
    private readonly options: {
      registry: TerminalSessionRegistry;
      history: TerminalHistoryPersistence;
      output: TerminalOutputFlow;
      lifecycle: TerminalPtyLifecycle;
      polling: TerminalSubprocessPolling;
      historyLimits: HistoryLimits;
      logger: TerminalManagerLogger;
      emitEvent: (event: TerminalEvent) => void;
      emitActivity: (session: TerminalSessionState) => void;
      snapshot: (session: TerminalSessionState) => TerminalSessionSnapshot;
      evictInactive: () => void;
    },
  ) {}

  async open(raw: TerminalOpenInput): Promise<TerminalSessionSnapshot> {
    const input = decodeOpen(raw);
    return this.options.registry.withThreadLock(input.threadId, async () => {
      await this.assertValidCwd(input.cwd);
      const existing = this.options.registry.get(input.threadId, input.terminalId);
      if (!existing) {
        await this.options.history.flush(input.threadId, input.terminalId);
        const history = await this.options.history.read(input.threadId, input.terminalId);
        const cols = input.cols ?? DEFAULT_OPEN_COLS;
        const rows = input.rows ?? DEFAULT_OPEN_ROWS;
        const session = createTerminalSession({
          threadId: input.threadId,
          terminalId: input.terminalId,
          cwd: input.cwd,
          cols,
          rows,
          runtimeEnv: normalizedRuntimeEnv(input.env),
          history,
          historyLimits: this.options.historyLimits,
          streamOutput: input.streamOutput ?? true,
        });
        this.options.registry.sessions.set(toSessionKey(input.threadId, input.terminalId), session);
        this.options.evictInactive();
        await this.options.lifecycle.start(session, { ...input, cols, rows }, "started");
        return this.options.snapshot(session);
      }

      if (input.streamOutput !== undefined) existing.streamOutput = input.streamOutput;
      const nextRuntimeEnv = normalizedRuntimeEnv(input.env);
      const targetCols = input.cols ?? existing.cols;
      const targetRows = input.rows ?? existing.rows;
      const runtimeEnvChanged =
        JSON.stringify(existing.runtimeEnv) !== JSON.stringify(nextRuntimeEnv);
      if (existing.process) {
        if (existing.cwd !== input.cwd || runtimeEnvChanged) {
          this.options.logger.warn("ignoring terminal open cwd/env change for running session", {
            threadId: existing.threadId,
            terminalId: existing.terminalId,
            currentCwd: existing.cwd,
            requestedCwd: input.cwd,
            runtimeEnvChanged,
          });
        }
      } else if (existing.cwd !== input.cwd || runtimeEnvChanged) {
        this.options.lifecycle.stop(existing);
        existing.cwd = input.cwd;
        existing.runtimeEnv = nextRuntimeEnv;
        resetSessionHistory(existing);
        await this.options.history.persist(
          existing.threadId,
          existing.terminalId,
          existing.history.toString(),
        );
      } else if (existing.status === "exited" || existing.status === "error") {
        existing.runtimeEnv = nextRuntimeEnv;
        resetSessionHistory(existing);
        await this.options.history.persist(
          existing.threadId,
          existing.terminalId,
          existing.history.toString(),
        );
      } else if (runtimeEnvChanged) {
        existing.runtimeEnv = nextRuntimeEnv;
      }

      if (!existing.process) {
        await this.options.lifecycle.start(
          existing,
          { ...input, cols: targetCols, rows: targetRows },
          "started",
        );
        return this.options.snapshot(existing);
      }
      this.options.output.resetAckTracking(existing);
      if (existing.cols !== targetCols || existing.rows !== targetRows) {
        existing.cols = targetCols;
        existing.rows = targetRows;
        existing.process.resize(targetCols, targetRows);
        existing.modeReplayTracker?.resize(targetCols, targetRows);
        existing.updatedAt = new Date().toISOString();
      }
      this.options.output.flush(existing);
      return this.options.snapshot(existing);
    });
  }

  async write(raw: TerminalWriteInput): Promise<void> {
    const input = decodeWrite(raw);
    const session = this.options.registry.require(input.threadId, input.terminalId);
    if (!session.process || session.status !== "running") {
      if (session.status === "exited") return;
      throw new Error(
        `Terminal is not running for thread: ${input.threadId}, terminal: ${input.terminalId}`,
      );
    }
    const identity = consumeTerminalIdentityInput(session.pendingInputBuffer, input.data);
    session.pendingInputBuffer = identity.buffer;
    if (identity.identity && identity.identity.cliKind !== session.detectedCliKind) {
      session.detectedCliKind = identity.identity.cliKind;
      session.providerDescendantObserved = false;
      this.options.emitActivity(session);
    }
    const submittedPrompt = input.data.includes("\r") || input.data.includes("\n");
    if (submittedPrompt && session.detectedCliKind !== null && !session.hasRunningSubprocess) {
      session.hasRunningSubprocess = true;
      this.options.emitActivity(session);
    }
    session.lastInputAt = Date.now();
    this.options.polling.bump();
    session.process.write(input.data);
  }

  async acknowledge(raw: TerminalAckOutputInput): Promise<void> {
    const input = decodeAck(raw);
    const session = this.options.registry.get(input.threadId, input.terminalId);
    if (session) this.options.output.acknowledge(session, input.bytes);
  }

  async resize(raw: TerminalResizeInput): Promise<void> {
    const input = decodeResize(raw);
    const session = this.options.registry.require(input.threadId, input.terminalId);
    if (!session.process || session.status !== "running") {
      throw new Error(
        `Terminal is not running for thread: ${input.threadId}, terminal: ${input.terminalId}`,
      );
    }
    session.cols = input.cols;
    session.rows = input.rows;
    session.updatedAt = new Date().toISOString();
    session.process.resize(input.cols, input.rows);
    session.modeReplayTracker?.resize(input.cols, input.rows);
  }

  async clear(raw: TerminalClearInput): Promise<void> {
    const input = decodeClear(raw);
    await this.options.registry.withThreadLock(input.threadId, async () => {
      const session = this.options.registry.require(input.threadId, input.terminalId);
      resetSessionHistory(session);
      session.updatedAt = new Date().toISOString();
      await this.options.history.persist(
        input.threadId,
        input.terminalId,
        session.history.toString(),
      );
      this.options.emitEvent({
        type: "cleared",
        threadId: input.threadId,
        terminalId: input.terminalId,
        createdAt: new Date().toISOString(),
      });
    });
  }

  async restart(raw: TerminalRestartInput): Promise<TerminalSessionSnapshot> {
    const input = decodeRestart(raw);
    return this.options.registry.withThreadLock(input.threadId, async () => {
      await this.assertValidCwd(input.cwd);
      let session = this.options.registry.get(input.threadId, input.terminalId);
      if (!session) {
        const cols = input.cols ?? DEFAULT_OPEN_COLS;
        const rows = input.rows ?? DEFAULT_OPEN_ROWS;
        session = createEmptyTerminalSession({
          threadId: input.threadId,
          terminalId: input.terminalId,
          cwd: input.cwd,
          cols,
          rows,
          runtimeEnv: normalizedRuntimeEnv(input.env),
          historyLimits: this.options.historyLimits,
          streamOutput: true,
        });
        this.options.registry.sessions.set(toSessionKey(input.threadId, input.terminalId), session);
        this.options.evictInactive();
      } else {
        this.options.lifecycle.stop(session);
        session.cwd = input.cwd;
        session.runtimeEnv = normalizedRuntimeEnv(input.env);
      }
      const cols = input.cols ?? session.cols;
      const rows = input.rows ?? session.rows;
      resetSessionHistory(session);
      await this.options.history.persist(
        input.threadId,
        input.terminalId,
        session.history.toString(),
      );
      await this.options.lifecycle.start(session, { ...input, cols, rows }, "restarted");
      return this.options.snapshot(session);
    });
  }

  async close(raw: TerminalCloseInput): Promise<void> {
    const input = decodeClose(raw);
    await this.options.registry.withThreadLock(input.threadId, async () => {
      if (input.terminalId) {
        await this.closeSession(input.threadId, input.terminalId, input.deleteHistory === true);
        return;
      }
      const sessions = this.options.registry.forThread(input.threadId);
      for (const session of sessions) {
        this.options.lifecycle.stop(session);
        this.options.registry.sessions.delete(toSessionKey(session.threadId, session.terminalId));
      }
      await Promise.all(
        sessions.map((session) => this.options.history.flush(session.threadId, session.terminalId)),
      );
      if (input.deleteHistory) await this.options.history.deleteAllForThread(input.threadId);
      this.options.polling.update();
    });
  }

  private async closeSession(
    threadId: string,
    terminalId: string,
    deleteHistory: boolean,
  ): Promise<void> {
    const session = this.options.registry.get(threadId, terminalId);
    if (session) {
      this.options.lifecycle.stop(session);
      this.options.registry.sessions.delete(toSessionKey(threadId, terminalId));
    }
    this.options.polling.update();
    await this.options.history.flush(threadId, terminalId);
    if (deleteHistory) await this.options.history.delete(threadId, terminalId);
  }

  private async assertValidCwd(cwd: string): Promise<void> {
    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(cwd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Terminal cwd does not exist: ${cwd}`, { cause: error });
      }
      throw error;
    }
    if (!stats.isDirectory()) throw new Error(`Terminal cwd is not a directory: ${cwd}`);
  }
}
