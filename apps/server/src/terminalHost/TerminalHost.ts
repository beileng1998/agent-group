import { randomUUID } from "node:crypto";

import type { PtyProcess, PtySpawnInput } from "../terminal/Services/PTY";
import { defaultProcessTreeKiller, type ProcessTreeKiller } from "../terminal/processTreeKiller";
import {
  defaultTerminalProcessGroupController,
  disabledTerminalProcessGroupController,
  type TerminalProcessGroupController,
} from "../terminal/terminalProcessGroup";
import { HeadlessEmulator } from "./headless-emulator";
import type { TerminalSnapshot } from "./terminal-snapshot";
import {
  TerminalHostSessionNotFoundError,
  TerminalHostStaleGenerationError,
  TerminalHostTeardownError,
  type TerminalHostAttachResult,
  type TerminalHostClientSubscription,
  type TerminalHostDependencies,
  type TerminalHostExit,
  type TerminalHostGeneration,
  type TerminalHostOutput,
  type TerminalHostSession,
  type TerminalHostSpawnInput,
} from "./TerminalHostTypes";
import {
  refreshTerminalSessionTree,
  teardownTerminalSession,
  teardownTerminalSessions,
} from "./terminalHostTeardown";
import {
  enqueueTerminalEmulatorTask,
  enqueueTerminalSnapshot,
} from "./terminalHostEmulatorQueue";
import { waitForTerminalSessionExit } from "./terminalHostExitWait";
import { assertTerminalHostGeneration } from "./terminalHostGeneration";
import { TerminalHostSnapshotTooLargeError } from "./terminalHostSnapshotBudget";
import { makeTerminalHostSessionState } from "./terminalHostSessionState";
import { TerminalHostStartupBuffer } from "./terminalHostStartupBuffer";
import { markKilledTombstone } from "./terminalHostTombstones";

export {
  TerminalHostSessionNotFoundError,
  TerminalHostStaleGenerationError,
  TerminalHostTeardownError,
  TerminalHostSnapshotTooLargeError,
};
export type {
  TerminalHostAttachResult,
  TerminalHostClientSubscription,
  TerminalHostDependencies,
  TerminalHostExit,
  TerminalHostGeneration,
  TerminalHostOutput,
  TerminalHostSpawnInput,
};
const DEFAULT_KILL_GRACE_MS = 1_000;

export class TerminalHost {
  private readonly sessions = new Map<string, TerminalHostSession>();
  private readonly pendingCreates = new Map<string, Promise<TerminalHostAttachResult>>();
  private readonly pendingKills = new Map<string, Promise<void>>();
  private readonly killedTombstones = new Set<string>();
  private readonly spawnPty: (input: PtySpawnInput) => Promise<PtyProcess>;
  private readonly processTreeKiller: ProcessTreeKiller;
  private readonly processGroupController: TerminalProcessGroupController;
  private readonly requireProcessGroupOwnership: boolean;
  private readonly killGraceMs: number;
  private readonly maxSnapshotBytes: number | undefined;
  private readonly platform: NodeJS.Platform;
  private disposed = false;

  constructor(deps: TerminalHostDependencies) {
    this.spawnPty = deps.spawnPty;
    this.processTreeKiller = deps.processTreeKiller ?? defaultProcessTreeKiller;
    this.processGroupController =
      deps.processGroupController ??
      (deps.processTreeKiller
        ? disabledTerminalProcessGroupController
        : defaultTerminalProcessGroupController);
    this.requireProcessGroupOwnership =
      deps.requireProcessGroupOwnership ?? deps.processTreeKiller === undefined;
    this.killGraceMs = deps.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.maxSnapshotBytes = deps.maxSnapshotBytes;
    this.platform = deps.platform ?? process.platform;
  }

  async createOrAttach(input: TerminalHostSpawnInput): Promise<TerminalHostAttachResult> {
    if (this.disposed) {
      throw new Error("Terminal host is disposed");
    }
    const existing = this.sessions.get(input.sessionId);
    if (existing?.isAlive && !this.pendingKills.has(input.sessionId)) {
      return this.attachResult(existing, false);
    }
    if (this.pendingKills.has(input.sessionId)) {
      throw new TerminalHostSessionNotFoundError(input.sessionId);
    }
    if (existing) {
      await this.runTeardown(input.sessionId);
    }
    const pending = this.pendingCreates.get(input.sessionId);
    if (pending) {
      await pending;
      return this.attach(input.sessionId);
    }

    const create = this.createSession(input);
    this.pendingCreates.set(input.sessionId, create);
    try {
      return await create;
    } finally {
      if (this.pendingCreates.get(input.sessionId) === create) {
        this.pendingCreates.delete(input.sessionId);
      }
    }
  }

  private async createSession(input: TerminalHostSpawnInput): Promise<TerminalHostAttachResult> {
    this.killedTombstones.delete(input.sessionId);
    const generation = randomUUID();
    let session: TerminalHostSession | undefined;
    const emulator = new HeadlessEmulator({
      cols: input.cols,
      rows: input.rows,
      onQueryReply: (reply) => {
        if (!session?.isAlive || this.sessions.get(input.sessionId) !== session) return;
        try {
          session.pty.write(reply);
        } catch (cause) {
          session.emulatorError ??= cause;
          void this.runTeardown(input.sessionId).catch(() => {});
        }
      },
    });
    let ptyProcess: PtyProcess;
    try {
      ptyProcess = await this.spawnPty({
        shell: input.command,
        args: [...(input.args ?? [])],
        cwd: input.cwd,
        cols: input.cols,
        rows: input.rows,
        env: input.env ?? process.env,
      });
    } catch (cause) {
      emulator.dispose();
      throw cause;
    }
    session = makeTerminalHostSessionState({
      sessionId: input.sessionId,
      generation,
      pty: ptyProcess,
      emulator,
      processGroupIdentity: null,
    });
    this.sessions.set(input.sessionId, session);
    const startupBuffer = new TerminalHostStartupBuffer(
      ptyProcess,
      (data) => this.handleData(session!, data),
      ({ exitCode, signal }) =>
        this.handleExit(session!, exitCode, signal ?? undefined),
    );
    try {
      session.disposePtyData = ptyProcess.onData(startupBuffer.onData);
      session.disposePtyExit = ptyProcess.onExit(startupBuffer.onExit);
    } catch (cause) {
      startupBuffer.discard();
      try {
        await this.kill(input.sessionId);
      } catch {
        // Preserve the listener-registration failure.
      }
      throw cause;
    }
    try {
      session.processGroupIdentity =
        this.platform === "win32"
          ? null
          : this.processGroupController.capture(ptyProcess.pid);
      if (
        this.requireProcessGroupOwnership &&
        this.platform !== "win32" &&
        session.processGroupIdentity === null
      ) {
        throw new Error(`Terminal process ${ptyProcess.pid} has no verified process group.`);
      }
      refreshTerminalSessionTree({
        owner: session,
        processTreeKiller: this.processTreeKiller,
      });
      session.lastTreeCaptureAt = 0;
      startupBuffer.promote();
    } catch (cause) {
      // Never expose an unowned PTY as attachable. Retain its host record when
      // stable tree cleanup cannot be proven so stop/dispose can retry.
      startupBuffer.discard();
      session.isAlive = false;
      try {
        await this.runTeardown(input.sessionId);
      } catch (teardownCause) {
        throw new TerminalHostTeardownError(
          input.sessionId,
          `process-group capture failed: ${
            cause instanceof Error ? cause.message : String(cause)
          }; ${teardownCause instanceof Error ? teardownCause.message : String(teardownCause)}`,
        );
      }
      throw cause;
    }
    if (!session.isAlive) {
      session.disposePtyData();
      session.disposePtyExit();
      throw new TerminalHostSessionNotFoundError(input.sessionId);
    }
    if (this.disposed) {
      await this.kill(input.sessionId);
      throw new Error("Terminal host is disposed");
    }
    return {
      isNew: true,
      generation,
      pid: ptyProcess.pid,
      processGroupIdentity: session.processGroupIdentity,
      snapshot: null,
    };
  }

  async attach(sessionId: string): Promise<TerminalHostAttachResult> {
    const session = this.getAliveSession(sessionId);
    return this.attachResult(session, false);
  }

  async attachClient(
    sessionId: string,
    listeners: {
      readonly onOutput: (output: TerminalHostOutput) => void;
      readonly onExit: (exit: TerminalHostExit) => void;
    },
    signal?: AbortSignal,
  ): Promise<TerminalHostClientSubscription> {
    const session = this.getAliveSession(sessionId);
    session.outputListeners.add(listeners.onOutput);
    session.exitListeners.add(listeners.onExit);
    const unsubscribe = () => {
      session.outputListeners.delete(listeners.onOutput);
      session.exitListeners.delete(listeners.onExit);
    };
    const abort = () => unsubscribe();
    if (signal?.aborted) {
      abort();
      throw new Error("Terminal client attach was interrupted.");
    }
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const subscription = {
        attached: await this.attachResult(session, false),
        unsubscribe,
      };
      if (signal?.aborted) {
        throw new Error("Terminal client attach was interrupted.");
      }
      return subscription;
    } catch (cause) {
      unsubscribe();
      throw cause;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  write(sessionId: string, data: string, generation: TerminalHostGeneration): void {
    const session = this.getAliveSession(sessionId);
    assertTerminalHostGeneration(session, generation);
    session.pty.write(data);
  }

  resize(
    sessionId: string,
    cols: number,
    rows: number,
    generation: TerminalHostGeneration,
  ): void {
    const session = this.getAliveSession(sessionId);
    assertTerminalHostGeneration(session, generation);
    session.pty.resize(cols, rows);
    enqueueTerminalEmulatorTask({
      session,
      task: () => session.emulator.resize(cols, rows),
    });
  }

  async getSnapshot(
    sessionId: string,
    opts: { scrollbackRows?: number } = {},
  ): Promise<TerminalSnapshot | null> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isAlive) {
      return null;
    }
    return this.enqueueSnapshot(session, opts);
  }

  onOutput(sessionId: string, listener: (output: TerminalHostOutput) => void): () => void {
    const session = this.getAliveSession(sessionId);
    session.outputListeners.add(listener);
    return () => session.outputListeners.delete(listener);
  }

  onExit(sessionId: string, listener: (exit: TerminalHostExit) => void): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new TerminalHostSessionNotFoundError(sessionId);
    }
    session.exitListeners.add(listener);
    return () => session.exitListeners.delete(listener);
  }

  isKilled(sessionId: string): boolean {
    return this.killedTombstones.has(sessionId);
  }

  isAlive(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isAlive === true;
  }

  generationOf(sessionId: string): TerminalHostGeneration | null {
    const session = this.sessions.get(sessionId);
    return session?.isAlive ? session.generation : null;
  }
  async kill(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) {
      markKilledTombstone(this.killedTombstones, sessionId);
    }
    return this.runTeardown(sessionId);
  }

  private async runTeardown(sessionId: string): Promise<void> {
    const pending = this.pendingKills.get(sessionId);
    if (pending) {
      return pending;
    }
    const kill = Promise.resolve().then(() => this.killSession(sessionId));
    this.pendingKills.set(sessionId, kill);
    try {
      await kill;
    } finally {
      if (this.pendingKills.get(sessionId) === kill) {
        this.pendingKills.delete(sessionId);
      }
    }
  }

  private async killSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    await teardownTerminalSession({
      owner: session,
      processTreeKiller: this.processTreeKiller,
      killGraceMs: this.killGraceMs,
      platform: this.platform,
      processGroupController: this.processGroupController,
      waitForExit: (timeoutMs) => waitForTerminalSessionExit(session, timeoutMs),
    });
    this.removeSession(session);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await Promise.allSettled([...this.pendingCreates.values()]);
    await teardownTerminalSessions({
      sessionIds: [...this.sessions.keys()],
      teardown: (sessionId) => this.kill(sessionId),
    });
  }

  private handleData(session: TerminalHostSession, data: string): void {
    if (!session.isAlive || session.emulatorError !== null) {
      return;
    }
    const byteLength = Buffer.byteLength(data);
    const queued = enqueueTerminalEmulatorTask({
      session,
      task: () => session.emulator.write(data, { forwardQueryReplies: true }),
      queuedBytes: byteLength,
    });
    if (!queued) {
      void this.runTeardown(session.sessionId).catch(() => {
        // Keep the owner record so create/dispose can retry unverified cleanup.
      });
      return;
    }
    session.seq += 1;
    const output: TerminalHostOutput = {
      seq: session.seq,
      data,
      generation: session.generation,
    };
    for (const listener of session.outputListeners) {
      try {
        listener(output);
      } catch {
        // One detached/failed transport must not stop PTY draining or prevent
        // other attached views from receiving output.
      }
    }
  }

  private handleExit(
    session: TerminalHostSession,
    exitCode: number,
    signal: number | undefined,
  ): void {
    if (!session.isAlive) return;
    refreshTerminalSessionTree({
      owner: session,
      processTreeKiller: this.processTreeKiller,
      force: true,
    });
    session.isAlive = false;
    session.exitCode = exitCode;
    const exit: TerminalHostExit = {
      exitCode,
      ...(signal !== undefined ? { signal } : {}),
      generation: session.generation,
    };
    for (const listener of session.exitListeners) {
      try {
        listener(exit);
      } catch {
        // Exit cleanup is host-owned and must not depend on consumers.
      }
    }
    if (!this.pendingKills.has(session.sessionId)) {
      void this.runTeardown(session.sessionId).catch(() => {
        // Keep the owner record so create/dispose can retry unverified cleanup.
      });
    }
  }

  private removeSession(session: TerminalHostSession): void {
    if (this.sessions.get(session.sessionId) !== session) {
      return;
    }
    this.sessions.delete(session.sessionId);
    session.disposePtyData();
    session.disposePtyExit();
    session.outputListeners.clear();
    session.exitListeners.clear();
    void session.emulatorQueue.then(
      () => session.emulator.dispose(),
      () => session.emulator.dispose(),
    );
  }

  private async attachResult(
    session: TerminalHostSession,
    isNew: boolean,
  ): Promise<TerminalHostAttachResult> {
    const snapshot = await this.enqueueSnapshot(session);
    return {
      isNew,
      generation: session.generation,
      pid: session.pty.pid,
      processGroupIdentity: session.processGroupIdentity,
      snapshot,
    };
  }

  private async enqueueSnapshot(
    session: TerminalHostSession,
    opts: { scrollbackRows?: number } = {},
  ): Promise<TerminalSnapshot> {
    return enqueueTerminalSnapshot({
      session,
      ...opts,
      ...(this.maxSnapshotBytes !== undefined
        ? { maxBytes: this.maxSnapshotBytes }
        : {}),
    });
  }

  private getAliveSession(sessionId: string): TerminalHostSession {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isAlive) {
      throw new TerminalHostSessionNotFoundError(sessionId);
    }
    return session;
  }
}
