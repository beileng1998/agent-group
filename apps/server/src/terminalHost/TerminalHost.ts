// FILE: TerminalHost.ts
// Purpose: Host-owned managed-agent PTY sessions — create-or-attach identity,
// generation epochs, monotonic output sequencing, snapshot restore, and
// process-group teardown. Rendering/screen state lives entirely in
// headless-emulator (xterm public addons); this class owns only the PTY
// lifecycle and the attach contract.
// Layer: Server terminal host (managed agent runtime substrate)

import { randomUUID } from "node:crypto";

import type { PtyProcess, PtySpawnInput } from "../terminal/Services/PTY";
import {
  defaultProcessTreeKiller,
  type ProcessTreeKiller,
} from "../terminal/processTreeKiller";
import { HeadlessEmulator } from "./headless-emulator";
import type { TerminalSnapshot } from "./terminal-snapshot";

export type TerminalHostGeneration = string;

export interface TerminalHostSpawnInput {
  readonly sessionId: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly env?: Record<string, string>;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalHostAttachResult {
  readonly isNew: boolean;
  readonly generation: TerminalHostGeneration;
  readonly pid: number;
  /** Null on a fresh spawn; on reattach carries outputSequence for seq dedupe. */
  readonly snapshot: TerminalSnapshot | null;
}

export interface TerminalHostOutput {
  readonly seq: number;
  readonly data: string;
  readonly generation: TerminalHostGeneration;
}

export interface TerminalHostExit {
  readonly exitCode: number;
  readonly signal?: number;
  readonly generation: TerminalHostGeneration;
}

export class TerminalHostSessionNotFoundError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Terminal host session not found: ${sessionId}`);
    this.name = "TerminalHostSessionNotFoundError";
    this.sessionId = sessionId;
  }
}

export class TerminalHostStaleGenerationError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Stale generation for terminal host session: ${sessionId}`);
    this.name = "TerminalHostStaleGenerationError";
    this.sessionId = sessionId;
  }
}

interface HostSession {
  readonly sessionId: string;
  readonly generation: TerminalHostGeneration;
  readonly pty: PtyProcess;
  readonly emulator: HeadlessEmulator;
  readonly outputListeners: Set<(output: TerminalHostOutput) => void>;
  readonly exitListeners: Set<(exit: TerminalHostExit) => void>;
  seq: number;
  isAlive: boolean;
  exitCode: number | null;
  /** Serializes emulator ingestion so snapshots never capture a half-parsed stream. */
  emulatorQueue: Promise<void>;
}

export interface TerminalHostDependencies {
  /** Spawn effect bridge — the service layer wires PtyAdapter through this (orca's spawnSubprocess seam). */
  readonly spawnPty: (input: PtySpawnInput) => Promise<PtyProcess>;
  readonly processTreeKiller?: ProcessTreeKiller;
  /** Grace period between SIGTERM and the SIGKILL descendant sweep. */
  readonly killGraceMs?: number;
}

const DEFAULT_KILL_GRACE_MS = 1_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class TerminalHost {
  private readonly sessions = new Map<string, HostSession>();
  private readonly killing = new Set<string>();
  private readonly killedTombstones = new Set<string>();
  private readonly spawnPty: (input: PtySpawnInput) => Promise<PtyProcess>;
  private readonly processTreeKiller: ProcessTreeKiller;
  private readonly killGraceMs: number;
  private disposed = false;

  constructor(deps: TerminalHostDependencies) {
    this.spawnPty = deps.spawnPty;
    this.processTreeKiller = deps.processTreeKiller ?? defaultProcessTreeKiller;
    this.killGraceMs = deps.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  }

  async createOrAttach(input: TerminalHostSpawnInput): Promise<TerminalHostAttachResult> {
    if (this.disposed) {
      throw new Error("Terminal host is disposed");
    }
    const existing = this.sessions.get(input.sessionId);
    if (existing?.isAlive && !this.killing.has(input.sessionId)) {
      return this.attachResult(existing, false);
    }
    // Why: attaching a session whose teardown is in flight could hand the
    // caller a doomed generation (orca: teardown fence before create).
    if (this.killing.has(input.sessionId)) {
      throw new TerminalHostSessionNotFoundError(input.sessionId);
    }
    this.killedTombstones.delete(input.sessionId);

    const generation = randomUUID();
    const ptyProcess = await this.spawnPty({
      shell: input.command,
      args: [...(input.args ?? [])],
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
      env: input.env ?? process.env,
    });
    const session: HostSession = {
      sessionId: input.sessionId,
      generation,
      pty: ptyProcess,
      emulator: new HeadlessEmulator({ cols: input.cols, rows: input.rows }),
      outputListeners: new Set(),
      exitListeners: new Set(),
      seq: 0,
      isAlive: true,
      exitCode: null,
      emulatorQueue: Promise.resolve(),
    };
    ptyProcess.onData((data) => this.handleData(session, data));
    ptyProcess.onExit(({ exitCode, signal }) =>
      this.handleExit(session, exitCode, signal ?? undefined),
    );
    this.sessions.set(input.sessionId, session);
    return { isNew: true, generation, pid: ptyProcess.pid, snapshot: null };
  }

  /** Attach to an existing live session; never spawns. */
  async attach(sessionId: string): Promise<TerminalHostAttachResult> {
    const session = this.getAliveSession(sessionId);
    return this.attachResult(session, false);
  }

  write(sessionId: string, data: string, generation?: TerminalHostGeneration): void {
    const session = this.getAliveSession(sessionId);
    this.assertGeneration(session, generation);
    session.pty.write(data);
  }

  resize(
    sessionId: string,
    cols: number,
    rows: number,
    generation?: TerminalHostGeneration,
  ): void {
    const session = this.getAliveSession(sessionId);
    this.assertGeneration(session, generation);
    session.pty.resize(cols, rows);
    session.emulator.resize(cols, rows);
  }

  /** Snapshot of the current screen after the emulator has fully drained. */
  async getSnapshot(
    sessionId: string,
    opts: { scrollbackRows?: number } = {},
  ): Promise<TerminalSnapshot | null> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isAlive) {
      return null;
    }
    await session.emulatorQueue;
    return session.emulator.getSnapshot({ ...opts, outputSequence: session.seq });
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
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    if (this.killing.has(sessionId)) {
      return;
    }
    this.killing.add(sessionId);
    this.killedTombstones.add(sessionId);
    try {
      if (session.isAlive) {
        const tree = this.processTreeKiller.capture(session.pty.pid);
        session.pty.kill("SIGTERM");
        const exited = await Promise.race([
          this.waitForExit(session).then(() => true),
          wait(this.killGraceMs).then(() => false),
        ]);
        // Why sweep unconditionally: a prompt root exit can still orphan
        // background children (sh -c 'sleep & wait'); SIGKILL only lands on
        // survivors since dead pids fail harmlessly through onError.
        this.processTreeKiller.signal({
          rootPid: session.pty.pid,
          signal: "SIGKILL",
          tree,
          onError: () => {},
        });
        if (!exited && session.isAlive) {
          session.pty.kill("SIGKILL");
          await Promise.race([this.waitForExit(session), wait(this.killGraceMs)]);
        }
      }
    } finally {
      this.killing.delete(sessionId);
      this.removeSession(sessionId);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.kill(sessionId)));
  }

  private handleData(session: HostSession, data: string): void {
    if (!session.isAlive) {
      return;
    }
    session.seq += 1;
    const output: TerminalHostOutput = {
      seq: session.seq,
      data,
      generation: session.generation,
    };
    for (const listener of session.outputListeners) {
      listener(output);
    }
    session.emulatorQueue = session.emulatorQueue.then(() => session.emulator.write(data));
  }

  private handleExit(session: HostSession, exitCode: number, signal: number | undefined): void {
    if (!session.isAlive) {
      return;
    }
    session.isAlive = false;
    session.exitCode = exitCode;
    const exit: TerminalHostExit = {
      exitCode,
      ...(signal !== undefined ? { signal } : {}),
      generation: session.generation,
    };
    for (const listener of session.exitListeners) {
      listener(exit);
    }
    // Why reap immediately: an exited terminal must not pin scrollback for the
    // host's life; late callers resolve through tombstones/not-found instead
    // (orca reapSession). The visible "exited" UI owns any final rendering.
    if (!this.killing.has(session.sessionId)) {
      this.removeSession(session.sessionId);
    }
  }

  private removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionId);
    session.emulator.dispose();
    session.outputListeners.clear();
    session.exitListeners.clear();
  }

  private waitForExit(session: HostSession): Promise<void> {
    if (!session.isAlive) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const unsubscribe = this.onExit(session.sessionId, () => {
        unsubscribe();
        resolve();
      });
    });
  }

  private async attachResult(
    session: HostSession,
    isNew: boolean,
  ): Promise<TerminalHostAttachResult> {
    await session.emulatorQueue;
    return {
      isNew,
      generation: session.generation,
      pid: session.pty.pid,
      snapshot: session.emulator.getSnapshot({ outputSequence: session.seq }),
    };
  }

  private getAliveSession(sessionId: string): HostSession {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isAlive) {
      throw new TerminalHostSessionNotFoundError(sessionId);
    }
    return session;
  }

  private assertGeneration(session: HostSession, generation?: TerminalHostGeneration): void {
    if (generation !== undefined && generation !== session.generation) {
      throw new TerminalHostStaleGenerationError(session.sessionId);
    }
  }
}
