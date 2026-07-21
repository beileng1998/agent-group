import { describeErrorMessage } from "@agent-group/shared/errorMessages";
import type { TerminalEvent, TerminalSessionSnapshot } from "@agent-group/contracts";

import type { PtyAdapterShape, PtyExitEvent, PtyProcess } from "../../Services/PTY";
import type { TerminalSessionState, TerminalStartInput } from "../../Services/Manager";
import type { ProcessTreeKiller, TerminalKillSignal } from "../../processTreeKiller";
import {
  cliKindFromRuntimeEnv,
  spawnTerminalProcess,
  type ManagedTerminalWrapperDirs,
} from "./terminalShellEnvironment";
import type { KillEscalationHandle, TerminalManagerLogger } from "./terminalManagerContracts";
import type { TerminalOutputFlow } from "./terminalOutputFlow";

export class TerminalPtyLifecycle {
  private readonly escalations = new Map<PtyProcess, KillEscalationHandle>();

  constructor(
    private readonly options: {
      ptyAdapter: PtyAdapterShape;
      shellResolver: () => string;
      wrappers: ManagedTerminalWrapperDirs;
      processTreeKiller: ProcessTreeKiller;
      processKillGraceMs: number;
      output: TerminalOutputFlow;
      logger: TerminalManagerLogger;
      emitEvent: (event: TerminalEvent) => void;
      emitActivity: (session: TerminalSessionState) => void;
      snapshot: (session: TerminalSessionState) => TerminalSessionSnapshot;
      updatePolling: () => void;
      evictInactive: () => void;
    },
  ) {}

  async start(
    session: TerminalSessionState,
    input: TerminalStartInput,
    eventType: "started" | "restarted",
  ): Promise<void> {
    this.stop(session);
    session.status = "starting";
    session.cwd = input.cwd;
    session.cols = input.cols;
    session.rows = input.rows;
    session.exitCode = null;
    session.exitSignal = null;
    session.hasRunningSubprocess = false;
    session.detectedCliKind = cliKindFromRuntimeEnv(session.runtimeEnv);
    session.providerDescendantObserved = false;
    session.managedAgentRunning = false;
    session.managedAgentState = null;
    session.managedAgentObserved = false;
    session.pendingInputBuffer = "";
    this.options.output.resetBackpressure(session);
    this.options.output.resetModeReplayTracker(session);
    session.lastInputAt = null;
    session.lastOutputAt = null;
    session.lastOutputSignature = null;
    session.updatedAt = new Date().toISOString();

    let ptyProcess: PtyProcess | null = null;
    let startedShell: string | null = null;
    try {
      const spawned = await spawnTerminalProcess({
        ptyAdapter: this.options.ptyAdapter,
        shellResolver: this.options.shellResolver,
        session,
        wrappers: this.options.wrappers,
      });
      ptyProcess = spawned.process;
      startedShell = spawned.shellLabel;
      session.process = ptyProcess;
      session.pid = ptyProcess.pid;
      session.status = "running";
      session.updatedAt = new Date().toISOString();
      this.options.output.ensureModeReplayTracker(session);
      session.unsubscribeData = ptyProcess.onData((data) =>
        this.options.output.onData(session, data),
      );
      session.unsubscribeExit = ptyProcess.onExit((event) => this.onExit(session, event));
      this.options.updatePolling();
      this.options.emitEvent({
        type: eventType,
        threadId: session.threadId,
        terminalId: session.terminalId,
        createdAt: new Date().toISOString(),
        snapshot: this.options.snapshot(session),
      });
      if (session.detectedCliKind) this.options.emitActivity(session);
    } catch (error) {
      if (ptyProcess) this.killWithEscalation(ptyProcess, session.threadId, session.terminalId);
      session.status = "error";
      session.pid = null;
      session.process = null;
      session.hasRunningSubprocess = false;
      session.detectedCliKind = null;
      session.providerDescendantObserved = false;
      session.managedAgentRunning = false;
      session.managedAgentState = null;
      session.managedAgentObserved = false;
      session.updatedAt = new Date().toISOString();
      this.options.evictInactive();
      this.options.updatePolling();
      const message = describeErrorMessage(error, "Terminal start failed");
      this.options.emitEvent({
        type: "error",
        threadId: session.threadId,
        terminalId: session.terminalId,
        createdAt: new Date().toISOString(),
        message,
      });
      this.options.logger.error("failed to start terminal", {
        threadId: session.threadId,
        terminalId: session.terminalId,
        error: message,
        ...(startedShell ? { shell: startedShell } : {}),
      });
    }
  }

  private onExit(session: TerminalSessionState, event: PtyExitEvent): void {
    this.options.output.flush(session);
    this.clearEscalation(session.process, { force: false });
    this.cleanupHandles(session);
    session.process = null;
    session.pid = null;
    session.hasRunningSubprocess = false;
    session.detectedCliKind = null;
    session.providerDescendantObserved = false;
    session.managedAgentRunning = false;
    session.managedAgentState = null;
    session.managedAgentObserved = false;
    session.lastInputAt = null;
    session.lastOutputAt = null;
    session.lastOutputSignature = null;
    this.options.output.resetBackpressure(session);
    this.options.output.resetModeReplayTracker(session);
    session.status = "exited";
    session.pendingHistoryControlSequence = "";
    session.exitCode = Number.isInteger(event.exitCode) ? event.exitCode : null;
    session.exitSignal = Number.isInteger(event.signal) ? event.signal : null;
    session.updatedAt = new Date().toISOString();
    this.options.emitEvent({
      type: "exited",
      threadId: session.threadId,
      terminalId: session.terminalId,
      createdAt: new Date().toISOString(),
      exitCode: session.exitCode,
      exitSignal: session.exitSignal,
    });
    this.options.evictInactive();
    this.options.updatePolling();
  }

  stop(session: TerminalSessionState): void {
    this.options.output.flush(session);
    const process = session.process;
    if (!process) return;
    this.cleanupHandles(session);
    session.process = null;
    session.pid = null;
    session.hasRunningSubprocess = false;
    session.detectedCliKind = null;
    session.providerDescendantObserved = false;
    session.managedAgentRunning = false;
    session.managedAgentState = null;
    session.managedAgentObserved = false;
    session.lastInputAt = null;
    session.lastOutputAt = null;
    session.lastOutputSignature = null;
    this.options.output.resetBackpressure(session);
    this.options.output.resetModeReplayTracker(session);
    session.status = "exited";
    session.pendingHistoryControlSequence = "";
    session.updatedAt = new Date().toISOString();
    this.killWithEscalation(process, session.threadId, session.terminalId);
    this.options.evictInactive();
    this.options.updatePolling();
  }

  private cleanupHandles(session: TerminalSessionState): void {
    session.unsubscribeData?.();
    session.unsubscribeData = null;
    session.unsubscribeExit?.();
    session.unsubscribeExit = null;
  }

  clearEscalation(process: PtyProcess | null, options: { force: boolean } = { force: true }): void {
    if (!process) return;
    const handle = this.escalations.get(process);
    if (!handle || (!options.force && handle.retainAfterRootExit)) return;
    clearTimeout(handle.timer);
    handle.unsubscribeExit?.();
    this.escalations.delete(process);
  }

  private killWithEscalation(process: PtyProcess, threadId: string, terminalId: string): void {
    this.clearEscalation(process);
    const pid = process.pid;
    const tree = this.options.processTreeKiller.capture(pid);
    const retainAfterRootExit = tree.descendants.length > 0;
    const signalProcess = (signal: TerminalKillSignal) => {
      try {
        process.kill(signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ESRCH") return;
        this.options.logger.warn("process signal failed", {
          threadId,
          terminalId,
          pid,
          signal,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    const signalTree = (signal: TerminalKillSignal, includeRootTree?: boolean) => {
      this.options.processTreeKiller.signal({
        rootPid: pid,
        signal,
        tree,
        includeRootTree,
        allowLegacyTreeFallback: true,
        onError: (error, context) => {
          this.options.logger.warn(
            context.source === "windows-tree"
              ? `taskkill ${signal} failed`
              : context.source === "legacy-tree"
                ? `fallback tree-kill ${signal} failed`
                : `${context.source} process ${signal} failed`,
            { threadId, terminalId, pid: context.pid, rootPid: pid, error: error.message },
          );
        },
      });
    };
    signalTree("SIGTERM");
    signalProcess("SIGTERM");
    const unsubscribeExit = process.onExit(() => {
      const handle = this.escalations.get(process);
      if (handle?.retainAfterRootExit) handle.rootExited = true;
      this.clearEscalation(process, { force: false });
    });
    const timer = setTimeout(() => {
      const handle = this.escalations.get(process);
      handle?.unsubscribeExit?.();
      this.escalations.delete(process);
      const rootExited = handle?.rootExited === true;
      signalTree("SIGKILL", !rootExited);
      if (!rootExited) signalProcess("SIGKILL");
    }, this.options.processKillGraceMs);
    timer.unref?.();
    this.escalations.set(process, {
      timer,
      unsubscribeExit,
      retainAfterRootExit,
      rootExited: false,
    });
  }

  clearAllEscalations(): void {
    for (const handle of this.escalations.values()) {
      clearTimeout(handle.timer);
      handle.unsubscribeExit?.();
    }
    this.escalations.clear();
  }

  get pendingEscalationCount(): number {
    return this.escalations.size;
  }
}
