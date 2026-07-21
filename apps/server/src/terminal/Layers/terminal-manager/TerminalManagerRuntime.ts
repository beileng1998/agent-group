import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

import type {
  TerminalAckOutputInput,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "@agent-group/contracts";

import { createLogger } from "../../../logger";
import { defaultProcessTreeKiller } from "../../processTreeKiller";
import { DEFAULT_HISTORY_BYTE_LIMIT, type HistoryLimits } from "../../terminalHistory";
import type { TerminalSessionState } from "../../Services/Manager";
import {
  DEFAULT_HISTORY_LINE_LIMIT,
  DEFAULT_MAX_RETAINED_INACTIVE_SESSIONS,
  DEFAULT_PROCESS_KILL_GRACE_MS,
  DEFAULT_SUBPROCESS_POLL_INTERVAL_MS,
  SHUTDOWN_ESCALATION_SETTLE_MS,
  type TerminalManagerOptions,
} from "./terminalManagerContracts";
import { TerminalHistoryPersistence } from "./terminalHistoryPersistence";
import { TerminalOutputFlow } from "./terminalOutputFlow";
import { TerminalPtyLifecycle } from "./terminalPtyLifecycle";
import { TerminalSessionCommands } from "./terminalSessionCommands";
import { TerminalSessionRegistry } from "./terminalSessionRegistry";
import { makeActivityEvent } from "./terminalSessionValues";
import { defaultShellResolver, prepareManagedWrapperDirs } from "./terminalShellEnvironment";
import { defaultSubprocessChecker } from "./terminalSubprocessInspection";
import { TerminalSubprocessPolling } from "./terminalSubprocessPolling";

interface TerminalManagerEvents {
  event: [event: TerminalEvent];
}

export class TerminalManagerRuntime extends EventEmitter<TerminalManagerEvents> {
  private readonly registry: TerminalSessionRegistry;
  /** Kept as a direct field for the existing diagnostic/test seam. */
  private readonly sessions: Map<string, TerminalSessionState>;
  private readonly history: TerminalHistoryPersistence;
  private readonly output: TerminalOutputFlow;
  private readonly polling: TerminalSubprocessPolling;
  private readonly lifecycle: TerminalPtyLifecycle;
  private readonly commands: TerminalSessionCommands;
  private readonly logger = createLogger("terminal");
  private readonly processKillGraceMs: number;

  constructor(options: TerminalManagerOptions) {
    super();
    const logsDir = options.logsDir ?? path.resolve(process.cwd(), ".logs", "terminals");
    const historyLimits: HistoryLimits = {
      maxLines: options.historyLineLimit ?? DEFAULT_HISTORY_LINE_LIMIT,
      maxBytes: options.historyByteLimit ?? DEFAULT_HISTORY_BYTE_LIMIT,
    };
    this.processKillGraceMs = options.processKillGraceMs ?? DEFAULT_PROCESS_KILL_GRACE_MS;
    fs.mkdirSync(logsDir, { recursive: true });
    const wrappers = prepareManagedWrapperDirs(logsDir, this.logger);

    this.registry = new TerminalSessionRegistry(
      options.maxRetainedInactiveSessions ?? DEFAULT_MAX_RETAINED_INACTIVE_SESSIONS,
    );
    this.sessions = this.registry.sessions;
    this.history = new TerminalHistoryPersistence({
      logsDir,
      limits: historyLimits,
      logger: this.logger,
    });
    this.polling = new TerminalSubprocessPolling({
      sessions: this.sessions,
      checker: options.subprocessChecker ?? defaultSubprocessChecker,
      useDefaultChecker: options.subprocessChecker === undefined,
      intervalMs: options.subprocessPollIntervalMs ?? DEFAULT_SUBPROCESS_POLL_INTERVAL_MS,
      logger: this.logger,
      emitActivity: (session) => this.emitActivity(session),
    });
    this.output = new TerminalOutputFlow({
      logger: this.logger,
      emitEvent: (event) => this.emitEvent(event),
      emitActivity: (session) => this.emitActivity(session),
      queuePersist: (session) => this.history.queue(session),
      bumpSubprocessPolling: () => this.polling.bump(),
    });
    this.lifecycle = new TerminalPtyLifecycle({
      ptyAdapter: options.ptyAdapter,
      shellResolver: options.shellResolver ?? defaultShellResolver,
      wrappers,
      processTreeKiller: options.processTreeKiller ?? defaultProcessTreeKiller,
      processKillGraceMs: this.processKillGraceMs,
      output: this.output,
      logger: this.logger,
      emitEvent: (event) => this.emitEvent(event),
      emitActivity: (session) => this.emitActivity(session),
      snapshot: (session) => this.snapshot(session),
      updatePolling: () => this.polling.update(),
      evictInactive: () => this.evictInactive(),
    });
    this.commands = new TerminalSessionCommands({
      registry: this.registry,
      history: this.history,
      output: this.output,
      lifecycle: this.lifecycle,
      polling: this.polling,
      historyLimits,
      logger: this.logger,
      emitEvent: (event) => this.emitEvent(event),
      emitActivity: (session) => this.emitActivity(session),
      snapshot: (session) => this.snapshot(session),
      evictInactive: () => this.evictInactive(),
    });
  }

  open(input: TerminalOpenInput): Promise<TerminalSessionSnapshot> {
    return this.commands.open(input);
  }

  write(input: TerminalWriteInput): Promise<void> {
    return this.commands.write(input);
  }

  ackOutput(input: TerminalAckOutputInput): Promise<void> {
    return this.commands.acknowledge(input);
  }

  resize(input: TerminalResizeInput): Promise<void> {
    return this.commands.resize(input);
  }

  clear(input: TerminalClearInput): Promise<void> {
    return this.commands.clear(input);
  }

  restart(input: TerminalRestartInput): Promise<TerminalSessionSnapshot> {
    return this.commands.restart(input);
  }

  close(input: TerminalCloseInput): Promise<void> {
    return this.commands.close(input);
  }

  dispose(): void {
    this.disposeInternal({ keepEscalationTimers: false });
  }

  async disposeForShutdown(): Promise<void> {
    const pendingEscalations = this.disposeInternal({ keepEscalationTimers: true });
    if (pendingEscalations > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.processKillGraceMs + SHUTDOWN_ESCALATION_SETTLE_MS),
      );
    }
    this.lifecycle.clearAllEscalations();
  }

  private disposeInternal(options: { keepEscalationTimers: boolean }): number {
    this.polling.stop();
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) {
      this.output.flush(session);
      this.lifecycle.stop(session);
    }
    this.history.dispose();
    if (!options.keepEscalationTimers) this.lifecycle.clearAllEscalations();
    this.registry.clearLocks();
    return this.lifecycle.pendingEscalationCount;
  }

  private snapshot(session: TerminalSessionState): TerminalSessionSnapshot {
    const replayPreamble = this.output.buildModeReplayPreamble(session);
    return {
      threadId: session.threadId,
      terminalId: session.terminalId,
      cwd: session.cwd,
      status: session.status,
      pid: session.pid,
      history: session.history.toString(),
      ...(replayPreamble.length > 0 ? { replayPreamble } : {}),
      exitCode: session.exitCode,
      exitSignal: session.exitSignal,
      updatedAt: session.updatedAt,
    };
  }

  private evictInactive(): void {
    this.registry.evictInactive({
      output: this.output,
      history: this.history,
      lifecycle: this.lifecycle,
    });
  }

  private emitActivity(session: TerminalSessionState): void {
    this.emitEvent(makeActivityEvent(session));
  }

  private emitEvent(event: TerminalEvent): void {
    this.emit("event", event);
  }
}
